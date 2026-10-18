import express from 'express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { accountSessionRouter } from '../account-session';
import { resetAccountSessionStore } from '../../services/helix-account/account-session-store';
import { verifySolarResearchExport } from '../../../shared/solar-research-export';
import { solarLocalProductInventorySchema } from '../../../shared/solar-local-product-inventory';
import { createHelixMcpRouter } from '../helix-mcp';
import { HELIX_DEVELOPER_ACCOUNT_POLICY } from '../../../shared/helix-account-session';
import { SOLAR_RESEARCH_READ_SCOPE } from '../../../shared/solar-research-mcp';
import type { HelixAgentApiPrincipal } from '../../services/helix-agent-api/types';
import { createHash } from 'node:crypto';

it('restricts local source inspection to a signed-in developer and returns an observation-only replay', async () => {
  await resetAccountSessionStore();
  try {
    const app = express(); app.use(express.json()); app.use('/api/account', accountSessionRouter);
    const inventory = '/api/account/solar-research/local-products';
    const observation = '/api/account/solar-research/local-primary-observation';
    await request(app).get(inventory).query({ expected_profile_id: 'local-workbench-dev' }).expect(401);
    const publicAccount = request.agent(app);
    await publicAccount.post('/api/account/session/sign-in').send({ profile_id: 'local-workbench-user', account_type: 'user' }).expect(200);
    await publicAccount.get(inventory).query({ expected_profile_id: 'local-workbench-user' }).expect(403);
    const developer = request.agent(app);
    const profileId = 'local-workbench-dev';
    await developer.post('/api/account/session/sign-in').send({ profile_id: profileId, account_type: 'developer' }).expect(200);
    await developer.get(inventory).query({ expected_profile_id: 'other' }).expect(409);
    const found = await developer.get(inventory).query({ expected_profile_id: profileId }).expect(200);
    const { ok, profileId: returnedProfileId, ...inventoryBody } = found.body;
    expect(ok).toBe(true);
    expect(returnedProfileId).toBe(profileId);
    const parsed = solarLocalProductInventorySchema.parse(inventoryBody);
    expect(found.body.profileId).toBe(profileId);
    expect(parsed.workspaceRootLocated).toBe(true);
    expect(parsed.products.find(item => item.id === 'g1.author.cdif')?.state).toBe('frozen_hash_matched');
    expect(parsed.products.find(item => item.id === 'mesa.solar_reference.parser_fixture')?.maturity).toBe('test_fixture');
    await developer.get(observation).query({ expected_profile_id: profileId, product_id: '../cdif' }).expect(400);
    const opened = await developer.get(observation).query({ expected_profile_id: profileId, product_id: 'g1.author.cdif' }).expect(200);
    const verified = await verifySolarResearchExport(opened.body.bundle);
    expect(opened.body).toMatchObject({ ok: true, profileId, productId: 'g1.author.cdif', recordId: verified.recordId,
      sourceIdentityAuthenticated: false, admissionAllowed: false, scienceRunAllowed: false });
    expect(verified.record.rows).toHaveLength(37);
    expect(verified.record.modelDifference).toBeNull();
    expect(verified.record.fixtureOnly).toBe(false);
    const retained = await developer.post('/api/account/solar-research/records')
      .send({ expected_profile_id: profileId, bundle: opened.body.bundle }).expect(201);
    expect(retained.body.recordId).toBe(verified.recordId);
    const owner = { accountProfileId: profileId,
      tenantId: `desktop:${createHash('sha256').update(profileId).digest('hex').slice(0,24)}` };
    const principal: HelixAgentApiPrincipal = { ...owner, issuer: 'test', subjectId: profileId,
      accountType: 'developer', scopes: new Set([SOLAR_RESEARCH_READ_SCOPE]), tokenExpiresAt: null,
      accountContext: { session_id: 'external-oauth:solar-local-workbench-test', profile_id: profileId,
        trusted_account_session: false, account_session: null, account_policy: HELIX_DEVELOPER_ACCOUNT_POLICY } };
    app.use('/mcp', createHelixMcpRouter({ authenticate: async () => principal, rateLimit: false, enforceTransportSecurity: false }));
    const mcp = await request(app).post('/mcp').set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-06-18').send({ jsonrpc: '2.0', id: 'solar-local-record',
        method: 'tools/call', params: { name: 'helix_solar_research_comparison_get',
          arguments: { recordId: verified.recordId, limit: 3 } } }).expect(200);
    expect(mcp.body.result.isError).not.toBe(true);
    expect(mcp.body.result.structuredContent).toMatchObject({ recordId: verified.recordId,
      totalRows: 37, scienceRunAllowed: false, admissionAllowed: false, modelDifference: null });
  } finally { await resetAccountSessionStore(); }
}, 30_000);
