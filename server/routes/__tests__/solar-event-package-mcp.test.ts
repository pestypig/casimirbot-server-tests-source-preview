import express from 'express';
import request from 'supertest';
import {createHash,webcrypto} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {syntheticSolarPortablePackage} from '../../../tests/fixtures/solar-portable-package';
import {createSolarEventImageSelection} from '../../../shared/solar-event-image-selection';
import {prepareSolarResearchEvidencePackage} from '../../../shared/solar-research-evidence-package';
import {HELIX_DEVELOPER_ACCOUNT_POLICY} from '../../../shared/helix-account-session';
import {SOLAR_RESEARCH_READ_SCOPE} from '../../../shared/solar-research-mcp';
import type {HelixAgentApiPrincipal} from '../../services/helix-agent-api/types';
import {resetAccountSessionStore} from '../../services/helix-account/account-session-store';
import {accountSessionRouter} from '../account-session';
import {createHelixMcpRouter} from '../helix-mcp';

afterEach(async()=>{vi.unstubAllGlobals();await resetAccountSessionStore();});

it('retains one event/image selection and reads the exact owner package through MCP without scientific promotion',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  await resetAccountSessionStore();
  const original=JSON.parse(await syntheticSolarPortablePackage(true));
  const archive=structuredClone(original.observationArchive);
  delete archive.archive_identity;
  const acquired=archive.frames[0].obstime as string;
  archive.selected_event_context=createSolarEventImageSelection({id:'ivo://hek/FL-mcp',event_type:'FL',
    start_time:acquired,frm_name:'catalog reporter'},0,archive.frames.length);
  const {packageJson}=await prepareSolarResearchEvidencePackage(original.comparison,archive);
  const profileId='solar-event-mcp-developer';
  const owner={accountProfileId:profileId,
    tenantId:`desktop:${createHash('sha256').update(profileId).digest('hex').slice(0,24)}`};
  const principal:HelixAgentApiPrincipal={...owner,issuer:'test',subjectId:profileId,
    accountType:'developer',scopes:new Set([SOLAR_RESEARCH_READ_SCOPE]),tokenExpiresAt:null,
    accountContext:{session_id:'external-oauth:solar-event-package-test',profile_id:profileId,
      trusted_account_session:false,account_session:null,account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY}};
  const app=express();app.use(express.json({limit:'10mb'}));app.use('/api/account',accountSessionRouter);
  const developer=request.agent(app);
  await developer.post('/api/account/session/sign-in').send({profile_id:profileId,account_type:'developer'}).expect(200);
  const saved=await developer.post('/api/account/solar-research/packages')
    .send({expected_profile_id:profileId,packageJson}).expect(201);
  expect(saved.body.saved).toBe(true);
  const packageId=saved.body.packageId as string;
  const reopened=await developer.get('/api/account/solar-research/packages')
    .query({expected_profile_id:profileId,packageId}).expect(200);
  expect(reopened.body.packageJson).toBe(packageJson);
  app.use('/mcp',createHelixMcpRouter({authenticate:async()=>principal,rateLimit:false,enforceTransportSecurity:false}));
  const mcp=await request(app).post('/mcp').set('Accept','application/json, text/event-stream')
    .set('MCP-Protocol-Version','2025-06-18').send({jsonrpc:'2.0',id:'selected-event',
      method:'tools/call',params:{name:'helix_solar_research_package_get',
        arguments:{packageId,rowLimit:1,frameLimit:1}}}).expect(200);
  expect(mcp.body.result.isError).not.toBe(true);
  const view=mcp.body.result.structuredContent;
  expect(view.packageId).toBe(packageId);
  expect(view.archive.eventSelection).toMatchObject({eventId:'ivo://hek/FL-mcp',
    imageAcquiredAt:acquired,imageOffsetFromEventStartSeconds:0,
    sourceIdentityAuthenticated:false,scientificAdmission:false});
  expect(view).toMatchObject({quantitativeJoinAllowed:false,correlationScore:null,
    pixelsIncluded:false,scienceRunAllowed:false,terminal_eligible:false});
  expect(JSON.stringify(view)).not.toContain('map_b64');
},30_000);
