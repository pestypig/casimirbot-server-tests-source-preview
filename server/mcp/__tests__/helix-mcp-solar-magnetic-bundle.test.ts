import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {webcrypto} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {HELIX_DEVELOPER_ACCOUNT_POLICY,HELIX_USER_ACCOUNT_POLICY} from '@shared/helix-account-session';
import {SOLAR_MAGNETIC_BUNDLE_EVIDENCE_DESCRIPTOR,SOLAR_RESEARCH_READ_SCOPE} from '@shared/solar-research-mcp';
import {solarGlobalRadialMapContentId,solarGlobalRadialMapSchema} from '@shared/solar-magnetic-dipole';
import {prepareSolarMagneticViewRecipe} from '@shared/solar-magnetic-view-recipe';
import {prepareSolarMagneticComparisonBundle} from '@shared/solar-magnetic-comparison-bundle';
import {buildSolarSphereScene} from '@shared/solar-sphere-scene';
import {HELIX_AGENT_RUN_WRITE_SCOPE} from '@shared/contracts/helix-agent-api.v1';
import {MagneticGlobePresentationService} from '../../services/solar-research/magnetic-globe-presentation';
import {getHelixMcpEvidenceCapabilityDescriptor} from '@shared/helix-mcp-evidence-capability-registry';
import {readAuthorizedSolarMagneticBundle,type SolarMagneticBundleReader} from '../../services/solar-research/authorized-magnetic-bundle-reader';
import type {HelixAgentApiPrincipal} from '../../services/helix-agent-api/types';
import {createHelixMcpServer,createHelixDeviceCheckMcpServer} from '../helix-mcp-server';

let bundleJson:string,bundleId:string;
const localBundlePath=resolve(process.cwd(),'.codex-build/solar-magnetic-source-20260928/gong-hmi-comparison-bundle-v1.json');
const localRegisteredBundlePath=resolve(process.cwd(),'.codex-build/solar-magnetic-source-20260928/gong-hmi-sphere-comparison-bundle-v2.json');
beforeAll(async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const map=solarGlobalRadialMapSchema.parse({schemaVersion:'solar-global-radial-map/1',
    source:{provider:'synthetic-test',productId:'mcp-fixture',sourceUrl:'https://example.org/map',sha256:'a'.repeat(64),
      kind:'synoptic_derived',inputStartUtc:null,inputEndUtc:'2026-09-28T17:04:00Z',retrievedAtUtc:'2026-09-28T18:00:00Z'},
    coordinateFrame:'Carrington',grid:'longitude_by_sine_latitude_cell_centers',units:'G',
    longitudeCells:12,sineLatitudeCells:6,radialGauss:Array.from({length:72},(_,i)=>i<36?-10:10),
    observedMaskStatus:'unavailable',observedCellMask:Array(72).fill(false),
    sourceIdentityAuthenticated:false,scientificAdmission:false});
  const view=await prepareSolarMagneticViewRecipe({schemaVersion:'solar-magnetic-view-recipe/1',
    mapContentId:await solarGlobalRadialMapContentId(map),pfssModelId:null,
    coordinateFrame:'Carrington_display_cartesian',projection:'perspective',cameraPosition:[0.45,0.9,3.4],
    cameraTarget:'solar_center',fieldColorScale:'asinh_p98_abs_radial_gauss/1',
    showIllustrativeAxialDipole:false,showMapEquivalentDipole:true,showPfssLines:false,
    sourceIdentityAuthenticated:false,scientificAdmission:false,quantitativeJoinAllowed:false});
  const bundle=await prepareSolarMagneticComparisonBundle({schemaVersion:'solar-magnetic-comparison-bundle/1',
    map,pfss:null,losDiagnostic:null,view,sourceIdentityAuthenticated:false,
    scientificAdmission:false,quantitativeValidationAllowed:false});
  bundleJson=JSON.stringify(bundle);bundleId=bundle.bundleId;
});
afterEach(()=>vi.unstubAllGlobals());
function principal():HelixAgentApiPrincipal{return {tenantId:'magnetic-tenant',accountProfileId:'magnetic-profile',issuer:'test',
  subjectId:'test',accountType:'developer',scopes:new Set([SOLAR_RESEARCH_READ_SCOPE]),tokenExpiresAt:null,
  accountContext:{session_id:null,profile_id:'magnetic-profile',trusted_account_session:false,account_session:null,
    account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY}};}
async function transport(actor:HelixAgentApiPrincipal,run:(client:Client)=>Promise<void>,options:{device?:boolean;omitReader?:boolean;failWrite?:boolean;reader?:SolarMagneticBundleReader;presentation?:MagneticGlobePresentationService}={}){
  const read=vi.fn(async(owner:any,id:string)=>options.reader?options.reader.read(owner,id):{owner,bundleId,bundleJson});
  const put=options.failWrite?vi.fn().mockRejectedValue(new Error('PRIVATE_STORAGE_FAILURE')):vi.fn().mockResolvedValue(undefined);
  const input={principal:actor,mcpEvidenceObservationStore:{put,get:vi.fn()},
    ...(!options.omitReader?{solarMagneticBundleReader:{read}}:{}),
    ...(options.presentation?{solarMagneticPresentationService:options.presentation}:{})};
  const server=options.device?createHelixDeviceCheckMcpServer(input):createHelixMcpServer(input);
  const client=new Client({name:'solar-magnetic-test',version:'1'},{capabilities:{}});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  try{await run(client);return {read,put};}finally{await client.close();await server.close();}
}
const call=(client:Client,args:Record<string,unknown>={bundleId})=>client.callTool({name:SOLAR_MAGNETIC_BUNDLE_EVIDENCE_DESCRIPTOR.mcp_tool_name,arguments:args});
it('publishes a bounded owner-checked view through the real MCP SDK transport',async()=>{
  vi.stubGlobal('crypto',webcrypto);const actor=principal();
  const direct=await readAuthorizedSolarMagneticBundle(actor,{read:async owner=>({owner,bundleId,bundleJson})},{bundleId});
  const {put}=await transport(actor,async client=>{
    const tool=(await client.listTools()).tools.find(item=>item.name===SOLAR_MAGNETIC_BUNDLE_EVIDENCE_DESCRIPTOR.mcp_tool_name);
    expect(tool?.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false,openWorldHint:false});
    expect(tool?._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:[SOLAR_RESEARCH_READ_SCOPE]}]);
    expect(getHelixMcpEvidenceCapabilityDescriptor(tool!.name)).toEqual(SOLAR_MAGNETIC_BUNDLE_EVIDENCE_DESCRIPTOR);
    const result=await call(client);expect(result.isError,JSON.stringify(result)).not.toBe(true);
    const {mcp_evidence,...payload}=result.structuredContent as any;
    expect(payload).toEqual(direct);expect(mcp_evidence.payload).toEqual(direct);
    expect(payload).toMatchObject({bundleId,sourceIdentityAuthenticated:false,scientificAdmission:false,
      coronalLinesMeasured:false,globalMomentMeasured:false,rawGridIncluded:false,fitsIncluded:false,
      catalogActiveRegionMarkersIncluded:false,catalogMarkersAssimilatedIntoMap:false});
    expect(mcp_evidence.authority.terminal_eligible).toBe(false);
    expect(JSON.stringify(result)).not.toContain('radialGauss');
    expect(JSON.stringify(result)).not.toContain('bundleJson');
  });expect(put).toHaveBeenCalledOnce();
});
it('reads an exact scene ID through the owner gate and rejects a stale or forged scene',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const bundle=JSON.parse(bundleJson),scene=await buildSolarSphereScene(bundle);
  expect(scene).toMatchObject({bundleId,registrationId:null,farSideObserved:false,
    independentModelValidation:false,scientificAdmission:false});
  expect(scene.layers).toHaveLength(1);
  const {read,put}=await transport(principal(),async client=>{
    const tool=(await client.listTools()).tools.find(item=>item.name==='helix_solar_sphere_scene_get');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const result=await client.callTool({name:'helix_solar_sphere_scene_get',
      arguments:{bundleId,expectedSceneId:scene.sceneId}});
    expect(result.isError,JSON.stringify(result)).not.toBe(true);
    const {mcp_evidence,...payload}=result.structuredContent as any;
    expect(payload).toEqual(scene);expect(mcp_evidence.payload).toEqual(scene);
    expect(JSON.stringify(result)).not.toContain('radialGauss');
    const stale=await client.callTool({name:'helix_solar_sphere_scene_get',
      arguments:{bundleId,expectedSceneId:`solar-sphere-scene:${'0'.repeat(64)}`}});
    expect(stale.isError).toBe(true);
    const forged=await client.callTool({name:'helix_solar_sphere_scene_get',
      arguments:{bundleId,expectedSceneId:scene.sceneId,tenantId:'other'}});
    expect(forged.isError).toBe(true);
  });
  expect(read).toHaveBeenCalledTimes(2);expect(put).toHaveBeenCalledOnce();
});
it('blocks scene reads before storage on missing scope and rejects wrong-owner storage',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const scene=await buildSolarSphereScene(JSON.parse(bundleJson));
  const actor=principal();actor.scopes.clear();
  const {read,put}=await transport(actor,async client=>{
    const result=await client.callTool({name:'helix_solar_sphere_scene_get',
      arguments:{bundleId,expectedSceneId:scene.sceneId}});
    expect(result.isError).toBe(true);
  });
  expect(read).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
  await transport(principal(),async client=>{
    const result=await client.callTool({name:'helix_solar_sphere_scene_get',
      arguments:{bundleId,expectedSceneId:scene.sceneId}});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(scene.sceneId);
  },{reader:{read:async owner=>({owner:{...owner,tenantId:'wrong'},bundleId,bundleJson})}});
});
it.skipIf(!existsSync(localRegisteredBundlePath))('reads the exact HMI geometry selection through owner-scoped MCP without FITS pixels',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const registeredJson=readFileSync(localRegisteredBundlePath,'utf8');
  const registeredId=JSON.parse(registeredJson).bundleId as string;
  const reader={read:vi.fn(async(owner:any)=>({owner,bundleId:registeredId,bundleJson:registeredJson}))};
  await transport(principal(),async client=>{
    const result=await call(client,{bundleId:registeredId});
    expect(result.isError,JSON.stringify(result)).not.toBe(true);
    const payload=result.structuredContent as any;
    expect(payload.registration).toMatchObject({
      registrationId:'solar-sphere-registration:3c5c22c498340621dc2bd23de128528d67d303e759d6ec618cc2c86097d2a7f7',
      sourceFitsSha256:'456498d96aebefce6aedc4891045f84c92b0ca1a5cf51050c430c3ae56770561',
      observedAtUtc:'2026-09-28T16:18:31.400Z',validOnDiskCount:29,offDiskCount:52,
      farSideObserved:false,magneticFitAllowed:false});
    expect(payload.registration.anchors.length).toBeLessThanOrEqual(25);
    expect(payload.registration.maxRoundTripErrorPixels).toBeLessThan(0.05);
    expect(JSON.stringify(result)).not.toContain('radialGauss');
    expect(JSON.stringify(result)).not.toContain('map_b64');
    const scene=await buildSolarSphereScene(JSON.parse(registeredJson));
    const sceneResult=await client.callTool({name:'helix_solar_sphere_scene_get',
      arguments:{bundleId:registeredId,expectedSceneId:scene.sceneId}});
    expect(sceneResult.isError,JSON.stringify(sceneResult)).not.toBe(true);
    expect(sceneResult.structuredContent).toMatchObject({sceneId:scene.sceneId,
      registrationId:scene.registrationId,farSideObserved:false,sameTimeFullSunObservation:false});
  },{reader});
  expect(reader.read).toHaveBeenCalledTimes(2);
});
it('requires scope before storage access',async()=>{
  const actor=principal();actor.scopes.clear();
  const {read,put}=await transport(actor,async client=>{
    const result=await call(client);expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();expect(JSON.stringify(result._meta)).toContain(SOLAR_RESEARCH_READ_SCOPE);
  });expect(read).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
});
it.each(['unconfigured','public','attenuated','device'])('does not advertise magnetic bundle on %s surface',async mode=>{
  const actor=principal();if(mode==='public')actor.accountType='user';
  if(mode==='public'||mode==='attenuated')actor.accountContext.account_policy=HELIX_USER_ACCOUNT_POLICY;
  const {read,put}=await transport(actor,async client=>{
    expect((await client.listTools()).tools.some(item=>item.name===SOLAR_MAGNETIC_BUNDLE_EVIDENCE_DESCRIPTOR.mcp_tool_name)).toBe(false);
  },{omitReader:mode==='unconfigured',device:mode==='device'});
  expect(read).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
});
it('rejects forged input and owner mismatch',async()=>{
  const actor=principal();
  const {read,put}=await transport(actor,async client=>{
    expect((await call(client,{bundleId,tenantId:'forged'})).isError).toBe(true);
  });expect(read).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
  await expect(readAuthorizedSolarMagneticBundle(actor,{read:async owner=>({owner:{...owner,tenantId:'other'},bundleId,bundleJson})},{bundleId}))
    .rejects.toThrow('SOLAR_MAGNETIC_OWNER_MISMATCH');
});
it('reports an unavailable exact owner bundle without disclosing another owner',async()=>{
  const actor=principal();actor.scopes.add(HELIX_AGENT_RUN_WRITE_SCOPE);
  const viewInstanceId='11111111-1111-4111-8111-111111111111';
  const presentation=new MagneticGlobePresentationService();
  presentation.observe({tenantId:actor.tenantId,accountProfileId:actor.accountProfileId},
    'renderer-session',viewInstanceId,0);
  const {read,put}=await transport(actor,async client=>{
    const evidence=await call(client);
    expect(evidence.isError).toBe(true);
    expect(JSON.stringify(evidence)).toContain('solar_magnetic_bundle_not_found');
    expect(JSON.stringify(evidence)).not.toContain('SOLAR_MAGNETIC_BUNDLE_NOT_FOUND');
    const show=await client.callTool({name:'helix_solar_magnetic_globe_show',
      arguments:{bundleId,viewInstanceId,expectedRevision:0}});
    expect(show.isError).toBe(true);
    expect(JSON.stringify(show)).toContain('solar_magnetic_bundle_not_found');
    const inspect=await client.callTool({name:'helix_solar_magnetic_globe_inspect',arguments:{}});
    expect(inspect.structuredContent).toMatchObject({request:null,revision:0});
  },{reader:{read:async()=>null},presentation});
  expect(read).toHaveBeenCalledTimes(2);
  expect(put).not.toHaveBeenCalled();
});
it('does not return a success envelope when durable observation persistence fails',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const {put}=await transport(principal(),async client=>{
    const result=await call(client);expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_STORAGE_FAILURE');
  },{failWrite:true});expect(put).toHaveBeenCalledOnce();
});

it('requests an exact retained bundle for a live owner view and inspects a separate display acknowledgement',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const actor=principal();actor.scopes.add(HELIX_AGENT_RUN_WRITE_SCOPE);
  const presentation=new MagneticGlobePresentationService();
  const owner={tenantId:actor.tenantId,accountProfileId:actor.accountProfileId};
  const viewInstanceId='11111111-1111-4111-8111-111111111111';
  presentation.observe(owner,'renderer-session',viewInstanceId,4);
  const verified=JSON.parse(bundleJson) as {map:unknown;view:{recipeId:string}};
  const scene=await buildSolarSphereScene(JSON.parse(bundleJson));
  await transport(actor,async client=>{
    const tools=(await client.listTools()).tools;
    for(const name of ['helix_solar_magnetic_globe_inspect','helix_solar_magnetic_globe_show']){
      const advertised=tools.find(tool=>tool.name===name);
      expect(advertised).toBeDefined();
      expect(JSON.stringify(advertised?.outputSchema)).toContain('viewRecipeId');
      expect(JSON.stringify(advertised?.outputSchema)).toContain('createdAtMs');
    }
    expect(tools.find(tool=>tool.name==='helix_solar_magnetic_globe_show')?._meta?.securitySchemes)
      .toEqual([{type:'oauth2',scopes:[HELIX_AGENT_RUN_WRITE_SCOPE,SOLAR_RESEARCH_READ_SCOPE]}]);
    const before=await client.callTool({name:'helix_solar_magnetic_globe_inspect',arguments:{}});
    expect(before.structuredContent).toMatchObject({available:true,viewInstanceId,revision:4,request:null});
    const stale=await client.callTool({name:'helix_solar_magnetic_globe_show',
      arguments:{bundleId,viewInstanceId,expectedRevision:3}});
    expect(stale.isError).toBe(true);
    const wrongScene=await client.callTool({name:'helix_solar_magnetic_globe_show',
      arguments:{bundleId,expectedSceneId:`solar-sphere-scene:${'0'.repeat(64)}`,
        viewInstanceId,expectedRevision:4}});
    expect(wrongScene.isError).toBe(true);
    const shown=await client.callTool({name:'helix_solar_magnetic_globe_show',
      arguments:{bundleId,expectedSceneId:scene.sceneId,viewInstanceId,expectedRevision:4}});
    expect(shown.isError,JSON.stringify(shown)).not.toBe(true);
    const request=(shown.structuredContent as any).request;
    expect(request).toMatchObject({bundleId,viewInstanceId,expectedRevision:4,state:'pending'});
    expect(JSON.stringify(shown)).not.toContain('radialGauss');
    expect(JSON.stringify(shown)).not.toContain('bundleJson');
    presentation.acknowledge(owner,'renderer-session',request.requestId,request.expected);
    const after=await client.callTool({name:'helix_solar_magnetic_globe_inspect',
      arguments:{requestId:request.requestId}});
    expect(after.structuredContent).toMatchObject({request:{state:'displayed',observed:{
      bundleId,viewRecipeId:verified.view.recipeId}},scientificAdmission:false,terminal_eligible:false});
  },{presentation});
});

it('does not queue a display without both read and workstation write scopes',async()=>{
  const actor=principal(),presentation=new MagneticGlobePresentationService();
  const viewInstanceId='11111111-1111-4111-8111-111111111111';
  presentation.observe({tenantId:actor.tenantId,accountProfileId:actor.accountProfileId},
    'renderer-session',viewInstanceId,0);
  const {read}=await transport(actor,async client=>{
    const result=await client.callTool({name:'helix_solar_magnetic_globe_show',
      arguments:{bundleId,viewInstanceId,expectedRevision:0}});
    expect(result.isError).toBe(true);
  },{presentation});
  expect(read).not.toHaveBeenCalled();
});

it('requests a human-selected local bundle import without exposing paths or bytes',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const actor=principal();actor.scopes.add(HELIX_AGENT_RUN_WRITE_SCOPE);
  const presentation=new MagneticGlobePresentationService();
  const owner={tenantId:actor.tenantId,accountProfileId:actor.accountProfileId};
  const viewInstanceId='11111111-1111-4111-8111-111111111111';
  presentation.observe(owner,'renderer-session',viewInstanceId,5);
  await transport(actor,async client=>{
    const tools=(await client.listTools()).tools;
    const importer=tools.find(tool=>tool.name==='helix_solar_magnetic_globe_import_request');
    expect(importer?._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:[HELIX_AGENT_RUN_WRITE_SCOPE,SOLAR_RESEARCH_READ_SCOPE]}]);
    const stale=await client.callTool({name:'helix_solar_magnetic_globe_import_request',
      arguments:{viewInstanceId,expectedRevision:4}});
    expect(stale.isError).toBe(true);
    const requested=await client.callTool({name:'helix_solar_magnetic_globe_import_request',
      arguments:{viewInstanceId,expectedRevision:5}});
    expect(requested.isError,JSON.stringify(requested)).not.toBe(true);
    const receipt=(requested.structuredContent as any).request;
    expect(receipt).toMatchObject({state:'pending',viewInstanceId,expectedRevision:5,bundleId:null});
    expect(JSON.stringify(requested)).not.toMatch(/bundleJson|radialGauss|[A-Z]:\\/);
    const duplicate=await client.callTool({name:'helix_solar_magnetic_globe_import_request',
      arguments:{viewInstanceId,expectedRevision:5}});
    expect(duplicate.isError).toBe(true);
    presentation.acknowledgeImport(owner,'renderer-session',receipt.requestId,viewInstanceId,5,
      {bundleId,mapContentId:'solar-radial:'+'b'.repeat(64),pfssModelId:null,
        viewRecipeId:'solar-magnetic-view:'+'d'.repeat(64)});
    const inspected=await client.callTool({name:'helix_solar_magnetic_globe_import_inspect',
      arguments:{requestId:receipt.requestId}});
    expect(inspected.structuredContent).toMatchObject({request:{state:'retained',bundleId},
      scientificAdmission:false,sourceIdentityAuthenticated:false,terminal_eligible:false});
  },{presentation});
});

it.runIf(existsSync(localBundlePath))('returns bounded real GONG/PFSS/HMI identities through MCP without the map grid',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const actualJson=readFileSync(localBundlePath,'utf8');
  const actual=JSON.parse(actualJson) as {bundleId:string};
  const reader:SolarMagneticBundleReader={read:async(owner,id)=>id===actual.bundleId?
    {owner,bundleId:actual.bundleId,bundleJson:actualJson}:null};
  const {read,put}=await transport(principal(),async client=>{
    const result=await call(client,{bundleId:actual.bundleId});
    expect(result.isError,JSON.stringify(result)).not.toBe(true);
    const payload=result.structuredContent as any;
    expect(payload.bundleId).toBe(actual.bundleId);
    expect(payload.map.contentId).toMatch(/^solar-radial:[a-f0-9]{64}$/);
    expect(payload.pfss.lineCount).toBe(48);
    expect(payload.measuredHmiLos.displaySampleCount).toBe(686);
    expect(payload.measuredHmiLos.mapProjectedLosRmsGauss).toBeCloseTo(67.494372,4);
    expect(payload.measuredHmiLos.radialL1ProjectedLosRmsGauss).toBeCloseTo(72.918971,4);
    expect(payload.mcp_evidence.authority.terminal_eligible).toBe(false);
    expect(JSON.stringify(result)).not.toContain('radialGauss');
    expect(JSON.stringify(result)).not.toContain('bundleJson');
  },{reader});
  expect(read).toHaveBeenCalledOnce();expect(put).toHaveBeenCalledOnce();
});
