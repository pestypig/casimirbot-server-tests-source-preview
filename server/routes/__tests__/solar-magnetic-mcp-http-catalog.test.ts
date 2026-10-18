import express from 'express';
import request from 'supertest';
import {expect,it} from 'vitest';
import {HELIX_DEVELOPER_ACCOUNT_POLICY,HELIX_USER_ACCOUNT_POLICY} from '@shared/helix-account-session';
import {SOLAR_RESEARCH_READ_SCOPE} from '@shared/solar-research-mcp';
import {HELIX_AGENT_RUN_WRITE_SCOPE} from '@shared/contracts/helix-agent-api.v1';
import {HELIX_DESKTOP_MCP_ISSUER} from '../../auth/helix-desktop-mcp-identity';
import type {HelixAgentApiPrincipal} from '../../services/helix-agent-api/types';
import {createHelixMcpRouter} from '../helix-mcp';

const listTools=async(principal:HelixAgentApiPrincipal)=>{
  const app=express();app.use(express.json());
  app.use('/mcp',createHelixMcpRouter({authenticate:async()=>principal,
    rateLimit:false,enforceTransportSecurity:false}));
  const response=await request(app).post('/mcp')
    .set('Accept','application/json, text/event-stream')
    .set('MCP-Protocol-Version','2025-06-18')
    .send({jsonrpc:'2.0',id:'solar-magnetic-catalog',method:'tools/list',params:{}})
    .expect(200);
  expect(response.body.error).toBeUndefined();
  return response.body.result.tools as Array<{name:string;inputSchema:unknown;outputSchema:unknown;
    securitySchemes?:unknown;_meta?:{securitySchemes?:unknown}}>;
};

const principal=(accountType:'developer'|'user'):HelixAgentApiPrincipal=>({
  tenantId:'solar-magnetic-catalog-tenant',accountProfileId:'solar-magnetic-catalog-profile',
  issuer:'test',subjectId:'solar-magnetic-catalog-profile',accountType,
  scopes:new Set([SOLAR_RESEARCH_READ_SCOPE,HELIX_AGENT_RUN_WRITE_SCOPE]),tokenExpiresAt:null,
  accountContext:{session_id:null,profile_id:'solar-magnetic-catalog-profile',
    trusted_account_session:false,account_session:null,
    account_policy:accountType==='developer'?HELIX_DEVELOPER_ACCOUNT_POLICY:HELIX_USER_ACCOUNT_POLICY},
});

it('publishes both magnetic globe tools over the stateless HTTP MCP catalog for a developer',async()=>{
  const tools=await listTools(principal('developer'));
  expect(new Set(tools.map(tool=>tool.name)).size).toBe(tools.length);
  const inspect=tools.find(tool=>tool.name==='helix_solar_magnetic_globe_inspect');
  const show=tools.find(tool=>tool.name==='helix_solar_magnetic_globe_show');
  expect(inspect).toBeDefined();expect(show).toBeDefined();
  expect(inspect?.securitySchemes).toEqual([{type:'oauth2',scopes:[SOLAR_RESEARCH_READ_SCOPE]}]);
  expect(show?.securitySchemes).toEqual([{type:'oauth2',
    scopes:[HELIX_AGENT_RUN_WRITE_SCOPE,SOLAR_RESEARCH_READ_SCOPE]}]);
  expect(inspect?._meta?.securitySchemes).toEqual(inspect?.securitySchemes);
  expect(show?._meta?.securitySchemes).toEqual(show?.securitySchemes);
  expect(JSON.stringify(inspect?.inputSchema)).toContain('requestId');
  expect(JSON.stringify(show?.inputSchema)).toContain('expectedRevision');
  expect(JSON.stringify(show?.outputSchema)).toContain('viewRecipeId');
});

it('does not publish owner magnetic tools to a user account',async()=>{
  const tools=await listTools(principal('user'));
  expect(tools.some(tool=>tool.name.startsWith('helix_solar_magnetic_'))).toBe(false);
});

it('keeps inspect discoverable through authenticated native delegation without granting noauth show',async()=>{
  const actor=principal('developer');
  actor.issuer=HELIX_DESKTOP_MCP_ISSUER;
  actor.trustedDeveloperProfile=true;
  actor.mcpClientRef=`mcp_client:native_desktop:${'a'.repeat(64)}`;
  actor.oauthClientRef=null;
  actor.accountContext.trusted_account_session=true;
  actor.accountContext.session_id='account_session:solar-magnetic-catalog';
  actor.accountContext.account_session={schema:'helix.account_session.v1',
    session_id:'account_session:solar-magnetic-catalog',
    profile:{profile_id:actor.accountProfileId,display_name:'Solar catalog fixture',email:null,
      auth_mode:'web_auth',account_type:'developer',provider:'external_oauth',provider_alias:'test',
      provider_subject:actor.accountProfileId,picture_url:null,created_at:new Date(0).toISOString(),
      updated_at:new Date(0).toISOString()},account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY,
    status:'active',memory_scope:'profile',created_at:new Date(0).toISOString(),
    updated_at:new Date(0).toISOString()};
  const tools=await listTools(actor);
  expect(tools.find(tool=>tool.name==='helix_solar_magnetic_globe_inspect')?.securitySchemes)
    .toEqual([{type:'noauth'}]);
  expect(tools.find(tool=>tool.name==='helix_solar_magnetic_globe_show')?.securitySchemes)
    .toEqual([{type:'oauth2',scopes:[HELIX_AGENT_RUN_WRITE_SCOPE,SOLAR_RESEARCH_READ_SCOPE]}]);
});
