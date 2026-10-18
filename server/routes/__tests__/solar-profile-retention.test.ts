import express from 'express';
import request from 'supertest';
import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {accountSessionRouter} from '../account-session';
import {resetAccountSessionStore} from '../../services/helix-account/account-session-store';
import {loadLocalPrimaryObservation} from '../../services/solar-research/primary-observation';
import {prepareSolarResearchExport} from '../../../shared/solar-research-export';
import {SolarResearchProfileRecordReader} from '../../services/solar-research/profile-record-reader';
import {createHelixMcpRouter} from '../helix-mcp';
import {HELIX_DEVELOPER_ACCOUNT_POLICY} from '../../../shared/helix-account-session';
import {SOLAR_RESEARCH_READ_SCOPE} from '../../../shared/solar-research-mcp';
import {HELIX_SHARED_LIVE_ROOM_READ_SCOPE} from '../../../shared/contracts/helix-shared-live-room-agent.v1';
import type {HelixAgentApiPrincipal} from '../../services/helix-agent-api/types';
const present=existsSync('artifacts/research/g1-basu-author-intake-20260924/cdif.txt')&&existsSync('artifacts/research/g1-basu-author-intake-20260924/avker.BP04_B4752dRF');
it.skipIf(!present)('authenticates retention, binds native ownership and preserves real record identity',async()=>{
  await resetAccountSessionStore();
  try {
    const app=express();app.use(express.json({limit:'300kb'}));app.use('/api/account',accountSessionRouter);
    const endpoint='/api/account/solar-research/records';
    const bundle=await prepareSolarResearchExport(await loadLocalPrimaryObservation(process.cwd(),'2026-09-26T20:00:00Z'));
    await request(app).post(endpoint).send({bundle,expected_profile_id:'solar-retention-developer'}).expect(401);
    const user=request.agent(app);
    await user.post('/api/account/session/sign-in').send({profile_id:'solar-retention-user',account_type:'user'}).expect(200);
    await user.post(endpoint).send({bundle,expected_profile_id:'solar-retention-user'}).expect(403);
    const developer=request.agent(app);const profileId='solar-retention-developer';
    await developer.post('/api/account/session/sign-in').send({profile_id:profileId,account_type:'developer'}).expect(200);
    await developer.post(endpoint).send({bundle,expected_profile_id:'other'}).expect(409);
    await developer.post(endpoint).send({bundle:{...bundle,tableCsv:'tampered'},expected_profile_id:profileId}).expect(400);
    const result=await developer.post(endpoint).send({bundle,expected_profile_id:profileId}).expect(201);
    expect(result.body).toMatchObject({ok:true,recordId:bundle.recordId,admissionAllowed:false,scienceRunAllowed:false});
    const owner={accountProfileId:profileId,tenantId:`desktop:${createHash('sha256').update(profileId).digest('hex').slice(0,24)}`};
    expect((await new SolarResearchProfileRecordReader().read(owner,bundle.recordId))?.bundle).toEqual(bundle);
    await request(app).get(endpoint).query({expected_profile_id:profileId}).expect(401);
    await user.get(endpoint).query({expected_profile_id:'solar-retention-user'}).expect(403);
    const catalogued=await developer.get(endpoint).query({expected_profile_id:profileId}).expect(200);
    expect(catalogued.body).toMatchObject({profileId,totalRecords:1,rejectedCount:0,records:[{recordId:bundle.recordId,rowCount:37}]});
    const reopened=await developer.get(endpoint).query({expected_profile_id:profileId,recordId:bundle.recordId}).expect(200);
    expect(reopened.body.bundle).toEqual(bundle);
    await developer.get(endpoint).query({expected_profile_id:'other'}).expect(409);
    await developer.get(endpoint).query({expected_profile_id:profileId,recordId:'../outside'}).expect(400);
    await developer.get(endpoint).query({expected_profile_id:profileId,limit:21}).expect(400);
    // Authentication is injected, but the default production router/server,
    // real profile reader and durable observation store are exercised below.
    const principal:HelixAgentApiPrincipal={...owner,issuer:'test',subjectId:profileId,accountType:'developer',
      scopes:new Set([SOLAR_RESEARCH_READ_SCOPE,HELIX_SHARED_LIVE_ROOM_READ_SCOPE]),tokenExpiresAt:null,
      accountContext:{session_id:'external-oauth:solar-retention-test',profile_id:profileId,trusted_account_session:false,account_session:null,
        account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY}};
    app.use('/mcp',createHelixMcpRouter({authenticate:async()=>principal,rateLimit:false,enforceTransportSecurity:false}));
    const mcp=(method:string,params:unknown)=>request(app).post('/mcp').set('Accept','application/json, text/event-stream')
      .set('MCP-Protocol-Version','2025-06-18').send({jsonrpc:'2.0',id:'solar-retention-http',method,params});
    const catalog=await mcp('tools/list',{}).expect(200);
    expect(catalog.body.result.tools.some((tool:any)=>tool.name==='helix_solar_research_comparison_get')).toBe(true);
    const comparison=await mcp('tools/call',{name:'helix_solar_research_comparison_get',arguments:{recordId:bundle.recordId,limit:10}}).expect(200);
    expect(comparison.body.result.isError).not.toBe(true);
    expect(comparison.body.result.structuredContent).toMatchObject({recordId:bundle.recordId,totalRows:37,scienceRunAllowed:false});
    const occurrence=comparison.body.result.structuredContent.mcp_evidence;
    const retrieved=await mcp('tools/call',{name:'helix_evidence_observation_get',arguments:{observation_ref:occurrence.observation_ref}}).expect(200);
    expect(retrieved.body.result.structuredContent.observation).toEqual(occurrence);
    principal.scopes.delete(SOLAR_RESEARCH_READ_SCOPE);
    const denied=await mcp('tools/call',{name:'helix_solar_research_comparison_get',arguments:{recordId:bundle.recordId}}).expect(200);
    expect(denied.body.result.isError).toBe(true);
    expect(denied.body.result.structuredContent).toBeUndefined();
    expect(JSON.parse(denied.body.result.content[0].text).error).toBe('insufficient_scope');
    await developer.post(endpoint).send({bundle,expected_profile_id:profileId}).expect(409);
  } finally {await resetAccountSessionStore();}
},30_000);
