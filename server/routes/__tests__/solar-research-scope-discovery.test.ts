import express from 'express';
import request from 'supertest';
import {it,expect} from 'vitest';
import {createHelixAgentProtectedResourceMetadataRouter} from '../helix-agent-api';
import {SOLAR_RESEARCH_READ_SCOPE} from '../../../shared/solar-research-mcp';

it('advertises research scope only for full MCP without issuing or verifying a token',async()=>{
  let verifications=0;
  const app=express();
  app.use(createHelixAgentProtectedResourceMetadataRouter({
    verifier:{verify:async()=>{verifications++;throw new Error('No token processing in discovery');},
      audience:()=> 'https://resource.example',authorizationServer:()=> 'https://issuer.example',providerAlias:()=> 'test'},
    resourcePaths:['/.well-known/oauth-protected-resource/mcp','/.well-known/oauth-protected-resource/mcp/device-check',
      '/.well-known/oauth-protected-resource/api/v1/agent-runs'],useLoopbackRequestResource:true,
  }));
  const full=await request(app).get('/.well-known/oauth-protected-resource/mcp').set('Host','127.0.0.1:1522').expect(200);
  expect(full.body.scopes_supported).toContain(SOLAR_RESEARCH_READ_SCOPE);
  expect(full.body.resource).toBe('http://127.0.0.1:1522/mcp');
  for(const path of ['mcp/device-check','api/v1/agent-runs']) {
    const narrow=await request(app).get(`/.well-known/oauth-protected-resource/${path}`).set('Host','127.0.0.1:1522').expect(200);
    expect(narrow.body.scopes_supported).not.toContain(SOLAR_RESEARCH_READ_SCOPE);
  }
  expect(verifications).toBe(0);
  const restricted=express();
  restricted.use(createHelixAgentProtectedResourceMetadataRouter({scopes:[],
    verifier:{verify:async()=>{throw new Error('No token processing');},audience:()=> 'https://resource.example',
      authorizationServer:()=> 'https://issuer.example',providerAlias:()=> 'test'}}));
  const explicit=await request(restricted).get('/.well-known/oauth-protected-resource/mcp').expect(200);
  expect(explicit.body.scopes_supported).not.toContain(SOLAR_RESEARCH_READ_SCOPE);
});
