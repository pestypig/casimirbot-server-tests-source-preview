import {createHash,webcrypto} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach,expect,it,vi} from 'vitest';
import {HELIX_DEVELOPER_ACCOUNT_POLICY} from '@shared/helix-account-session';
import {SOLAR_RESEARCH_READ_SCOPE} from '@shared/solar-research-mcp';
import {HELIX_AGENT_RUN_WRITE_SCOPE} from '@shared/contracts/helix-agent-api.v1';
import {solarGlobalRadialMapContentId,solarGlobalRadialMapSchema} from '@shared/solar-magnetic-dipole';
import {prepareSolarMagneticViewRecipe} from '@shared/solar-magnetic-view-recipe';
import {prepareSolarMagneticComparisonBundle} from '@shared/solar-magnetic-comparison-bundle';
import {createHelixMcpServer} from '../../mcp/helix-mcp-server';
import {MagneticGlobePresentationService} from '../../services/solar-research/magnetic-globe-presentation';
import {createSolarMagneticPresentationRouter} from '../solar-magnetic-presentation';

afterEach(()=>vi.unstubAllGlobals());

it('carries one owner exact-ID request from MCP through the signed renderer route and back to MCP inspection',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const profileId='profile-one',sessionId='session-one';
  const owner={tenantId:'desktop:'+createHash('sha256').update(profileId).digest('hex').slice(0,24),
    accountProfileId:profileId};
  const map=solarGlobalRadialMapSchema.parse({schemaVersion:'solar-global-radial-map/1',
    source:{provider:'fixture',productId:'vertical-loop',sourceUrl:'https://example.org/map',
      sha256:'a'.repeat(64),kind:'synoptic_derived',inputStartUtc:null,inputEndUtc:'2026-09-28T17:04:00Z',
      retrievedAtUtc:'2026-09-28T18:00:00Z'},coordinateFrame:'Carrington',
    grid:'longitude_by_sine_latitude_cell_centers',units:'G',longitudeCells:12,sineLatitudeCells:6,
    radialGauss:Array.from({length:72},(_,i)=>i<36?-10:10),observedMaskStatus:'unavailable',
    observedCellMask:Array(72).fill(false),sourceIdentityAuthenticated:false,scientificAdmission:false});
  const mapContentId=await solarGlobalRadialMapContentId(map);
  const view=await prepareSolarMagneticViewRecipe({schemaVersion:'solar-magnetic-view-recipe/1',
    mapContentId,pfssModelId:null,coordinateFrame:'Carrington_display_cartesian',projection:'perspective',
    cameraPosition:[0.45,0.9,3.4],cameraTarget:'solar_center',
    fieldColorScale:'asinh_p98_abs_radial_gauss/1',showIllustrativeAxialDipole:false,
    showMapEquivalentDipole:true,showPfssLines:false,sourceIdentityAuthenticated:false,
    scientificAdmission:false,quantitativeJoinAllowed:false});
  const bundle=await prepareSolarMagneticComparisonBundle({schemaVersion:'solar-magnetic-comparison-bundle/1',
    map,pfss:null,losDiagnostic:null,view,sourceIdentityAuthenticated:false,
    scientificAdmission:false,quantitativeValidationAllowed:false});
  const presentation=new MagneticGlobePresentationService();
  const app=express();app.use(express.json());
  app.use('/presentation',createSolarMagneticPresentationRouter({service:presentation,
    getSession:async()=>({session_id:sessionId,profile:{profile_id:profileId},
      account_policy:{account_type:'developer'}}) as any,
    readRetainedBundle:async(readOwner,id)=>id===bundle.bundleId&&readOwner.tenantId===owner.tenantId?
      {owner:readOwner,bundleId:bundle.bundleId,bundleJson:JSON.stringify(bundle),bundle}:null}));
  const sameOrigin={Host:'localhost',Origin:'http://localhost','Sec-Fetch-Site':'same-origin'};
  const viewInstanceId='11111111-1111-4111-8111-111111111111';
  expect((await request(app).post('/presentation/presence').set(sameOrigin)
    .send({viewInstanceId,revision:7})).status).toBe(200);
  const read=vi.fn(async(readOwner,id:string)=>id===bundle.bundleId&&
    readOwner.tenantId===owner.tenantId&&readOwner.accountProfileId===owner.accountProfileId?
    {owner,bundleId:bundle.bundleId,bundleJson:JSON.stringify(bundle)}:null);
  const principal={tenantId:owner.tenantId,accountProfileId:profileId,issuer:'test',subjectId:profileId,
    accountType:'developer' as const,scopes:new Set([SOLAR_RESEARCH_READ_SCOPE,HELIX_AGENT_RUN_WRITE_SCOPE]),
    tokenExpiresAt:null,accountContext:{session_id:sessionId,profile_id:profileId,trusted_account_session:true,
      account_session:null,account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY}};
  const server=createHelixMcpServer({principal,solarMagneticBundleReader:{read},
    solarMagneticPresentationService:presentation,mcpEvidenceObservationStore:{put:vi.fn(),get:vi.fn()}});
  const client=new Client({name:'vertical-loop-test',version:'1'},{capabilities:{}});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  try{
    const inspected=await client.callTool({name:'helix_solar_magnetic_globe_inspect',arguments:{}});
    expect(inspected.structuredContent).toMatchObject({available:true,viewInstanceId,revision:7});
    const imported=await client.callTool({name:'helix_solar_magnetic_globe_import_request',
      arguments:{viewInstanceId,expectedRevision:7}});
    expect(imported.isError,JSON.stringify(imported)).not.toBe(true);
    const importRequest=(imported.structuredContent as any).request;
    const importPending=await request(app).get('/presentation/import/pending?viewInstanceId='+viewInstanceId);
    expect(importPending.body.request.requestId).toBe(importRequest.requestId);
    const retained=await request(app).post('/presentation/import/ack').set(sameOrigin)
      .send({viewInstanceId,requestId:importRequest.requestId,expectedRevision:7,observed:{
        bundleId:bundle.bundleId,mapContentId:bundle.view.mapContentId,pfssModelId:null,viewRecipeId:view.recipeId}});
    expect(retained.status).toBe(200);
    expect(retained.body.request).toMatchObject({state:'retained',bundleId:bundle.bundleId});
    const importReceipt=await client.callTool({name:'helix_solar_magnetic_globe_import_inspect',
      arguments:{requestId:importRequest.requestId}});
    expect(importReceipt.structuredContent).toMatchObject({request:{state:'retained',bundleId:bundle.bundleId},
      scientificAdmission:false,sourceIdentityAuthenticated:false,terminal_eligible:false});
    const shown=await client.callTool({name:'helix_solar_magnetic_globe_show',
      arguments:{bundleId:bundle.bundleId,viewInstanceId,expectedRevision:7}});
    expect(shown.isError,JSON.stringify(shown)).not.toBe(true);
    const queued=(shown.structuredContent as any).request;
    expect(queued).toMatchObject({state:'pending',bundleId:bundle.bundleId,
      expected:{mapContentId,pfssModelId:null,viewRecipeId:view.recipeId}});
    const pending=await request(app).get('/presentation/pending?viewInstanceId='+viewInstanceId);
    expect(pending.body.request.requestId).toBe(queued.requestId);
    const acknowledged=await request(app).post('/presentation/ack').set(sameOrigin)
      .send({viewInstanceId,requestId:queued.requestId,observed:queued.expected});
    expect(acknowledged.body.request).toMatchObject({state:'displayed',observed:queued.expected});
    const result=await client.callTool({name:'helix_solar_magnetic_globe_inspect',
      arguments:{requestId:queued.requestId}});
    expect(result.structuredContent).toMatchObject({request:{state:'displayed',
      observed:{bundleId:bundle.bundleId,mapContentId,pfssModelId:null,viewRecipeId:view.recipeId}},
      scientificAdmission:false,assistant_answer:false,terminal_eligible:false});
    expect(JSON.stringify(result)).not.toContain('radialGauss');
    expect(read).toHaveBeenCalledOnce();
  }finally{await client.close();await server.close();}
});
