import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {syntheticSolarPortablePackage} from '../../../tests/fixtures/solar-portable-package';
import {createHash,webcrypto} from 'node:crypto';
import {beforeAll,afterEach,it,expect,vi} from 'vitest';
import {createHelixMcpServer,createHelixDeviceCheckMcpServer} from '../helix-mcp-server';
import {HELIX_DEVELOPER_ACCOUNT_POLICY,HELIX_USER_ACCOUNT_POLICY} from '@shared/helix-account-session';
import {SOLAR_RESEARCH_READ_SCOPE,SOLAR_PACKAGE_EVIDENCE_DESCRIPTOR,SOLAR_PACKAGE_CATALOG_DESCRIPTOR} from '@shared/solar-research-mcp';
import {solarPackageCatalogSchema} from '@shared/solar-package-catalog';
import {produceSolarPackageCatalogObservation} from '../../services/solar-research/package-catalog-observation';
import {getHelixMcpEvidenceCapabilityDescriptor} from '@shared/helix-mcp-evidence-capability-registry';
import {readAuthorizedSolarPackage,type SolarResearchPackageReader} from '../../services/solar-research/authorized-package-reader';
import {prepareSolarResearchEvidencePackage} from '@shared/solar-research-evidence-package';
import {createSolarEventImageSelection} from '@shared/solar-event-image-selection';
import {createSolarGoesFrameWindow} from '@shared/solar-goes-frame-window';
import type {HelixAgentApiPrincipal} from '../../services/helix-agent-api/types';
let packageJson:string,packageId:string;
let page:ReturnType<typeof solarPackageCatalogSchema.parse>;
beforeAll(async()=>{
  vi.stubGlobal('crypto',webcrypto);
  packageJson=await syntheticSolarPortablePackage(true);
  packageId='solar-package:'+createHash('sha256').update(packageJson).digest('hex');
  const raw=JSON.parse(packageJson);
  page=solarPackageCatalogSchema.parse({schemaVersion:'solar-package-catalog/1',offset:0,totalPackages:1,nextOffset:null,
    order:'package_id_lexicographic',scientificAdmission:false,scienceRunAllowed:false,
    packages:[{packageId,indexId:raw.index.indexId,totalBytes:Buffer.byteLength(packageJson),comparisonRecordId:raw.comparison.recordId,
      comparisonRows:1,archiveId:raw.observationArchive.archive_identity.snapshotId,literatureId:null,benchmarkId:null,
      artifactIntegrityVerified:true,sourceIdentityAuthenticated:false,scientificAdmission:false,scienceRunAllowed:false}]});
});
function principal():HelixAgentApiPrincipal {return {tenantId:'package-mcp-tenant',accountProfileId:'package-mcp-profile',issuer:'test',
  subjectId:'test',accountType:'developer',scopes:new Set([SOLAR_RESEARCH_READ_SCOPE]),tokenExpiresAt:null,
  accountContext:{session_id:null,profile_id:'package-mcp-profile',trusted_account_session:false,account_session:null,account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY}};}
afterEach(()=>vi.unstubAllGlobals());
async function transport(actor:HelixAgentApiPrincipal,run:(client:Client)=>Promise<void>,options:{reader?:SolarResearchPackageReader;omitReader?:boolean;device?:boolean;failWrite?:boolean}={}) {
  const read=vi.fn(async(owner:any)=>({owner,packageId,packageJson}));
  const put=options.failWrite?vi.fn().mockRejectedValue(new Error('PRIVATE_STORAGE_FAILURE')):vi.fn().mockResolvedValue(undefined);
  const input={principal:actor,mcpEvidenceObservationStore:{put,get:vi.fn()},
    ...(!options.omitReader?{solarResearchPackageReader:options.reader??{read}}:{})};
  const server=options.device?createHelixDeviceCheckMcpServer(input):createHelixMcpServer(input);
  const client=new Client({name:'solar-package-parity-test',version:'1'},{capabilities:{}});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  try{await run(client);return {read,put};}finally{await client.close();await server.close();}
}
const call=(client:Client,args:Record<string,unknown>={packageId,rowLimit:2,frameLimit:1})=>client.callTool({name:SOLAR_PACKAGE_EVIDENCE_DESCRIPTOR.mcp_tool_name,arguments:args});
it('preserves exact direct-handler synthetic payload through MCP and publishes only after durable write',async()=>{
  vi.stubGlobal('crypto',webcrypto);const actor=principal();
  const reader={read:async(owner:any)=>({owner,packageId,packageJson})};
  const direct=await readAuthorizedSolarPackage(actor,reader,{packageId,rowLimit:2,frameLimit:1});
  const {put}=await transport(actor,async client=>{
    const catalog=await client.listTools(),tool=catalog.tools.find(t=>t.name===SOLAR_PACKAGE_EVIDENCE_DESCRIPTOR.mcp_tool_name);
    expect(tool?.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false,openWorldHint:false});
    expect(tool?._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:[SOLAR_RESEARCH_READ_SCOPE]}]);
    expect(getHelixMcpEvidenceCapabilityDescriptor(tool!.name)).toEqual(SOLAR_PACKAGE_EVIDENCE_DESCRIPTOR);
    const result=await call(client);expect(result.isError,JSON.stringify(result)).not.toBe(true);
    const {mcp_evidence,...payload}=result.structuredContent as any;expect(payload).toEqual(direct);expect(mcp_evidence.payload).toEqual(direct);
    expect(mcp_evidence.authority.terminal_eligible).toBe(false);expect(payload.comparison.totalRows).toBe(1);
    expect(payload.diskViewRecipe).toMatchObject({packageId,fieldLines:'off',scientificAdmission:false,
      quantitativeJoinAllowed:false});
    expect(JSON.stringify(result)).not.toContain('map_b64');expect(JSON.stringify(result)).not.toContain('packageJson');
  },{reader});expect(put).toHaveBeenCalledOnce();
});
it('returns the same bounded event and GOES selection through the owner-scoped MCP package read',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const original=JSON.parse(packageJson);
  const archive=structuredClone(original.observationArchive);
  delete archive.archive_identity;
  const acquired=archive.frames[0].obstime as string;
  archive.selected_event_context=createSolarEventImageSelection({id:'ivo://hek/FL_mcp_context',
    event_type:'FL',start_time:acquired},0,archive.frames.length);
  archive.selected_goes_window=createSolarGoesFrameWindow({frames:archive.frames,selectedFrameIndex:0,
    bins:[{start:'2026-09-26T23:55:00Z',end:acquired,mean_long:1e-7}]});
  const selected=await prepareSolarResearchEvidencePackage(original.comparison,archive);
  const selectedId='solar-package:'+createHash('sha256').update(selected.packageJson).digest('hex');
  const reader={read:vi.fn(async(owner:any)=>({owner,packageId:selectedId,packageJson:selected.packageJson}))};
  await transport(principal(),async client=>{
    const result=await client.callTool({name:SOLAR_PACKAGE_EVIDENCE_DESCRIPTOR.mcp_tool_name,
      arguments:{packageId:selectedId,rowLimit:1,frameLimit:1}});
    expect(result.isError,JSON.stringify(result)).not.toBe(true);
    const payload=result.structuredContent as any;
    expect(payload.archive.eventSelection).toMatchObject({eventId:'ivo://hek/FL_mcp_context',
      imageAcquiredAt:acquired,relationship:'contextual_co_occurrence_only',scientificAdmission:false});
    expect(payload.archive.graphSelection).toMatchObject({frameAcquiredAt:acquired,
      relationship:'temporal_context_only',bins:[{meanLongWm2:1e-7}],sourceFilesAuthenticated:false,
      scientificAdmission:false});
    expect(payload.archive.snapshotId).toBe(JSON.parse(selected.packageJson).observationArchive.archive_identity.snapshotId);
    expect(JSON.stringify(result)).not.toContain('map_b64');
  },{reader});
  expect(reader.read).toHaveBeenCalledOnce();
});
it('returns an OAuth scope challenge before the package reader can access storage',async()=>{
  const actor=principal();actor.scopes.clear();const {read,put}=await transport(actor,async client=>{
    const result=await call(client);expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).toContain('insufficient_scope');expect(JSON.stringify(result._meta)).toContain(SOLAR_RESEARCH_READ_SCOPE);
  });expect(read).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
});
it.each(['unconfigured','public','attenuated','device'])('does not advertise package reads on %s surfaces',async mode=>{
  const actor=principal();if(mode==='public')actor.accountType='user';
  if(mode==='public'||mode==='attenuated')actor.accountContext.account_policy=HELIX_USER_ACCOUNT_POLICY;
  const {read,put}=await transport(actor,async client=>{
    expect((await client.listTools()).tools.some(t=>t.name===SOLAR_PACKAGE_EVIDENCE_DESCRIPTOR.mcp_tool_name)).toBe(false);
  },{omitReader:mode==='unconfigured',device:mode==='device'});
  expect(read).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
});
it.each([{rowLimit:21},{frameLimit:21},{tenantId:'forged'}])('rejects invalid input before reading',async args=>{
  const {read,put}=await transport(principal(),async client=>{
    const result=await call(client,{packageId,...args});expect(result.isError).toBe(true);
  });expect(read).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
});
it('returns no success envelope when durable persistence fails',async()=>{
  vi.stubGlobal('crypto',webcrypto);const {put}=await transport(principal(),async client=>{
    const result=await call(client);expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_STORAGE_FAILURE');expect(JSON.stringify(result)).not.toContain('solar-package-evidence-view/1');
  },{failWrite:true});expect(put).toHaveBeenCalledOnce();
});
const catalogReader=()=>({read:vi.fn(),readCatalog:vi.fn(async(owner:any)=>({owner,catalog:page}))});
it('preserves exact catalog handler parity and descriptor identity through the actual SDK transport',async()=>{
  const actor=principal(),reader=catalogReader();
  const direct=await produceSolarPackageCatalogObservation(actor,reader,{put:vi.fn()},{});
  const {put}=await transport(actor,async client=>{
    const tool=(await client.listTools()).tools.find(t=>t.name==='helix_solar_research_package_list');
    expect(tool?._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:[SOLAR_RESEARCH_READ_SCOPE]}]);
    expect(getHelixMcpEvidenceCapabilityDescriptor(tool!.name)).toEqual(SOLAR_PACKAGE_CATALOG_DESCRIPTOR);
    const result=await client.callTool({name:tool!.name,arguments:{}});expect(result.isError,JSON.stringify(result)).not.toBe(true);
    const {mcp_evidence,...payload}=result.structuredContent as any;const {mcp_evidence:_,...expected}=direct;
    expect(payload).toEqual(expected);expect(mcp_evidence.payload).toEqual(page);expect(mcp_evidence.authority.terminal_eligible).toBe(false);
    expect(JSON.stringify(result)).not.toContain('packageJson');expect(reader.read).not.toHaveBeenCalled();
  },{reader});expect(put).toHaveBeenCalledOnce();
});
it('requires catalog scope before storage access and returns a typed challenge',async()=>{
  const actor=principal(),reader=catalogReader();actor.scopes.clear();const {put}=await transport(actor,async client=>{
    const result=await client.callTool({name:'helix_solar_research_package_list',arguments:{}});
    expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();expect(JSON.stringify(result._meta)).toContain(SOLAR_RESEARCH_READ_SCOPE);
  },{reader});expect(reader.readCatalog).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
});
it.each(['read-only-source','public','attenuated','device'])('omits package catalog on %s surfaces',async mode=>{
  const actor=principal(),reader=catalogReader();if(mode==='public')actor.accountType='user';
  if(mode==='public'||mode==='attenuated')actor.accountContext.account_policy=HELIX_USER_ACCOUNT_POLICY;
  await transport(actor,async client=>expect((await client.listTools()).tools.some(t=>t.name==='helix_solar_research_package_list')).toBe(false),
    {reader:mode==='read-only-source'?{read:reader.read}:reader,device:mode==='device'});
  expect(reader.readCatalog).not.toHaveBeenCalled();
});
it.each([{limit:21},{tenantId:'forged'}])('rejects unbounded/forged catalog input before source access',async args=>{
  const reader=catalogReader();const {put}=await transport(principal(),async client=>{
    const result=await client.callTool({name:'helix_solar_research_package_list',arguments:args});expect(result.isError).toBe(true);
  },{reader});expect(reader.readCatalog).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
});
it('does not return a catalog after durable write failure',async()=>{
  await transport(principal(),async client=>{
    const result=await client.callTool({name:'helix_solar_research_package_list',arguments:{}});expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();expect(JSON.stringify(result)).not.toContain('PRIVATE_STORAGE_FAILURE');
  },{reader:catalogReader(),failWrite:true});
});
