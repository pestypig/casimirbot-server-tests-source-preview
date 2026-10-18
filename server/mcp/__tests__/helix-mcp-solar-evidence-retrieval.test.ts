import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { HELIX_DEVELOPER_ACCOUNT_POLICY, HELIX_USER_ACCOUNT_POLICY } from '@shared/helix-account-session';
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from '@shared/contracts/helix-shared-live-room-agent.v1';
import { HELIX_MCP_EVIDENCE_AUTHORITY, type HelixMcpEvidenceObservation } from '@shared/contracts/helix-mcp-evidence-capability.v1';
import { getHelixMcpEvidenceCapabilityDescriptor } from '@shared/helix-mcp-evidence-capability-registry';
import { createHelixMcpServer, createHelixDeviceCheckMcpServer } from '../helix-mcp-server';
import type { HelixAgentApiPrincipal } from '../../services/helix-agent-api/types';
import { buildHelixMcpEvidenceObservation } from '../../services/mcp-evidence/observation';
import { SOLAR_RESEARCH_EVIDENCE_DESCRIPTOR } from '../../services/solar-research/evidence-observation';
import { SOLAR_RESEARCH_READ_SCOPE } from '../../services/solar-research/authorized-evidence-reader';
import { requireSolarResearchRetrievalPolicy } from '../../services/solar-research/retrieval-policy';
import { prepareSolarResearchExport } from '@shared/solar-research-export';
import { loadLocalPrimaryObservation } from '../../services/solar-research/primary-observation';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SolarResearchFileStore } from '../../services/solar-research/record-store';
import type { SolarResearchRecordReader } from '../../services/solar-research/authorized-evidence-reader';

function principal(): HelixAgentApiPrincipal {
  return {tenantId:'solar-test-tenant',issuer:'test',subjectId:'solar-test-subject',accountProfileId:'solar-test-profile',
    accountType:'developer',scopes:new Set([HELIX_SHARED_LIVE_ROOM_READ_SCOPE,SOLAR_RESEARCH_READ_SCOPE]),tokenExpiresAt:null,
    accountContext:{session_id:null,profile_id:'solar-test-profile',trusted_account_session:false,account_session:null,
      account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY}};
}
function typedFailure(result: {structuredContent?: unknown; content: unknown[]}) {
  expect(result.structuredContent).toBeUndefined();
  const text = result.content.find((item: any) => item.type === 'text') as {text:string};
  return JSON.parse(text.text);
}
function solar() {
  return buildHelixMcpEvidenceObservation({descriptor:SOLAR_RESEARCH_EVIDENCE_DESCRIPTOR,
    request:{recordId:`solar-primary:${'a'.repeat(64)}`,offset:0,limit:1},
    payload:{schemaVersion:'solar-research-evidence-view/1',fixtureOnly:true,marker:'UI_TEST_ONLY_RESTRICTED_CONTENT'},
    producerRef:'casimirbot-profile:solar-test-profile',summary:'UI test fixture, not scientific evidence.',payloadSchema:'solar-research-evidence-view/1'});
}
function wrap(observation:HelixMcpEvidenceObservation) {
  return buildHelixMcpEvidenceObservation({descriptor:getHelixMcpEvidenceCapabilityDescriptor('helix_evidence_observation_get')!,
    request:{observation_ref:observation.observation_ref},payload:{schema:'helix.mcp_evidence_retrieval.v1',observation},
    producerRef:'casimirbot-profile:solar-test-profile',summary:'Retained retrieval fixture.',payloadSchema:'helix.mcp_evidence_retrieval.v1'});
}
async function call(actor:HelixAgentApiPrincipal, observation:HelixMcpEvidenceObservation, deviceCheck=false,
  bundle?:Awaited<ReturnType<typeof prepareSolarResearchExport>>, readComparison=false, retainedReader?:SolarResearchRecordReader) {
  const put=vi.fn().mockResolvedValue(undefined);
  const store={put,get:vi.fn().mockResolvedValue(observation)};
  const read=vi.fn().mockResolvedValue({owner:{tenantId:actor.tenantId,accountProfileId:actor.accountProfileId},bundle});
  const input={principal:actor,mcpEvidenceObservationStore:store,...(bundle?{solarResearchRecordReader:retainedReader ?? {read}}:{})};
  const server=deviceCheck?createHelixDeviceCheckMcpServer(input):createHelixMcpServer(input);
  const client=new Client({name:'solar-retrieval-policy-test',version:'1'},{capabilities:{}});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);await client.connect(clientTransport);
  try {
    const catalog=await client.listTools();
    const result=await client.callTool(readComparison
      ?{name:'helix_solar_research_comparison_get',arguments:{recordId:bundle!.recordId,limit:10}}
      :{name:'helix_evidence_observation_get',arguments:{observation_ref:observation.observation_ref}});
    return {result,put,catalog,read};
  } finally {await client.close();await server.close();}
}
describe('original solar policy through actual MCP retrieval tool',()=>{
  const realPresent=existsSync('artifacts/research/g1-basu-author-intake-20260924/cdif.txt') && existsSync('artifacts/research/g1-basu-author-intake-20260924/avker.BP04_B4752dRF');
  it.each([
    ['absent', async()=>null],
    ['different owner', async()=>({owner:{tenantId:'another-tenant',accountProfileId:'solar-test-profile'},bundle:{}})],
    ['embedded owner mismatch', async()=>{throw new Error('SOLAR_RECORD_OWNER_MISMATCH');}],
  ])('reports %s comparison without a retryable internal error or evidence write',async(_caseName,read)=>{
    const recordId=`solar-primary:${'a'.repeat(64)}`;
    const {result,put}=await call(principal(),solar(),false,{recordId} as Awaited<ReturnType<typeof prepareSolarResearchExport>>,true,{read});
    expect(result.isError).toBe(true);
    expect(typedFailure(result)).toMatchObject({error:'not_found',retryable:false});
    expect(put).not.toHaveBeenCalled();
  });
  it('keeps a storage failure distinct from a missing comparison',async()=>{
    const recordId=`solar-primary:${'a'.repeat(64)}`;
    const read=async()=>{throw new Error('profile_storage_restore_unavailable');};
    const {result,put}=await call(principal(),solar(),false,{recordId} as Awaited<ReturnType<typeof prepareSolarResearchExport>>,true,{read});
    expect(result.isError).toBe(true);
    expect(typedFailure(result)).toMatchObject({error:'internal_error',retryable:true});
    expect(put).not.toHaveBeenCalled();
  });
  it.skipIf(!realPresent)('reopens a persisted real comparison and preserves its identity through MCP',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'solar-mcp-retained-'));
    try {
      const actor=principal();
      const owner={tenantId:actor.tenantId,accountProfileId:actor.accountProfileId};
      const bundle=await prepareSolarResearchExport(await loadLocalPrimaryObservation(process.cwd(),'2026-09-26T20:00:00Z'));
      await new SolarResearchFileStore(root).put(owner,bundle);
      // Reopen instead of relying on a mocked reader or process-local cache.
      const reopened=new SolarResearchFileStore(root);
      const {result,put}=await call(actor,solar(),false,bundle,true,reopened);
      expect(result.isError,JSON.stringify(result)).not.toBe(true);
      const output=result.structuredContent as Record<string,unknown>;
      expect(output.recordId).toBe(bundle.recordId);
      expect(output.rows).toHaveLength(10);
      expect(output.artifactIntegrityVerified).toBe(true);
      expect(output.sourceIdentityAuthenticated).toBe(false);
      expect(output.scienceRunAllowed).toBe(false);
      expect(put).toHaveBeenCalledOnce();
      expect(await reopened.read({...owner,tenantId:'another-tenant'},bundle.recordId)).toBeNull();
    } finally {
      if(path.dirname(root)!==path.resolve(os.tmpdir()) || !path.basename(root).startsWith('solar-mcp-retained-'))
        throw new Error('Unsafe test cleanup');
      await rm(root,{recursive:true,force:true});
    }
  });
  it.skipIf(!realPresent)('reads real retained data through the configured full MCP tool with exact numerical identity',async()=>{
    const bundle=await prepareSolarResearchExport(await loadLocalPrimaryObservation(process.cwd(),'2026-09-26T20:00:00Z'));
    const {result,put,catalog,read}=await call(principal(),solar(),false,bundle,true);
    expect(result.isError,JSON.stringify(result)).not.toBe(true);
    const content=result.structuredContent as Record<string,unknown>;
    expect(content.recordId).toBe(bundle.recordId);expect(content.totalRows).toBe(37);expect(content.rows).toHaveLength(10);
    expect(content.fixtureOnly).toBe(false);expect(content.admissionAllowed).toBe(false);expect(read).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();expect((content.mcp_evidence as HelixMcpEvidenceObservation).payload.recordId).toBe(bundle.recordId);
    const tool=catalog.tools.find(tool=>tool.name==='helix_solar_research_comparison_get');
    expect(tool?.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false,openWorldHint:false});
    expect(tool?._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:[SOLAR_RESEARCH_READ_SCOPE]}]);
  });
  it.skipIf(!realPresent)('requires research scope before the configured comparison reader sees storage',async()=>{
    const bundle=await prepareSolarResearchExport(await loadLocalPrimaryObservation(process.cwd(),'2026-09-26T20:00:00Z'));
    const actor=principal();actor.scopes=new Set([HELIX_SHARED_LIVE_ROOM_READ_SCOPE]);
    const {result,read,put}=await call(actor,solar(),false,bundle,true);
    expect(result.isError).toBe(true);expect(typedFailure(result)).toMatchObject({error:'insufficient_scope'});
    expect(read).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
  });
  it('does not advertise a research reader when no store is configured',async()=>{
    const {catalog}=await call(principal(),solar());
    expect(catalog.tools.some(tool=>tool.name==='helix_solar_research_comparison_get')).toBe(false);
  });
  it('does not restrict unrelated legitimate bounded arrays to a smaller solar row limit',()=>{
    const unrelated=wrap(solar());
    unrelated.payload={samples:Array.from({length:10},()=>Array.from({length:2000},(_,i)=>i))};
    const actor=principal();actor.scopes=new Set([HELIX_SHARED_LIVE_ROOM_READ_SCOPE]);
    expect(()=>requireSolarResearchRetrievalPolicy(actor,unrelated,false)).not.toThrow();
  });
  it('recognizes the research payload even if an enclosing capability label is unrelated',()=>{
    const evidence=solar();evidence.capability_id='helix.some_other.inspect';
    const actor=principal();actor.scopes=new Set([HELIX_SHARED_LIVE_ROOM_READ_SCOPE]);
    expect(()=>requireSolarResearchRetrievalPolicy(actor,evidence,true)).toThrow('required helix.solar_research.read scope');
  });
  it('fails closed for a solar family whose original policy has not been defined',()=>{
    const evidence=solar();evidence.capability_id='helix.solar_research.future_capability';
    expect(()=>requireSolarResearchRetrievalPolicy(principal(),evidence,true)).toThrow('not admitted');
  });
  it('allows an owner-admitted full-MCP developer and preserves original occurrence and authority',async()=>{
    const observation=solar();const {result,put}=await call(principal(),observation);
    expect(result.isError,JSON.stringify(result)).not.toBe(true);
    const content=result.structuredContent as Record<string,unknown>;
    expect(content.observation).toEqual(observation);expect(put).toHaveBeenCalledOnce();
    expect((content.mcp_evidence as HelixMcpEvidenceObservation).authority).toEqual(HELIX_MCP_EVIDENCE_AUTHORITY);
    expect((content.observation as HelixMcpEvidenceObservation).observed_at).toBe(observation.observed_at);
  });
  it.each([0,1,2])('requires research scope through %i saved retrieval wrappers',async depth=>{
    const actor=principal();actor.scopes=new Set([HELIX_SHARED_LIVE_ROOM_READ_SCOPE]);
    let observation=solar();for(let i=0;i<depth;i++) observation=wrap(observation);
    const {result,put}=await call(actor,observation);
    expect(result.isError).toBe(true);expect(typedFailure(result)).toMatchObject({error:'insufficient_scope'});
    const challenges=(result as {_meta?:Record<string,unknown>})._meta?.['mcp/www_authenticate'] as string[];
    expect(challenges).toHaveLength(1);expect(challenges[0]).toContain(`scope="${SOLAR_RESEARCH_READ_SCOPE}"`);
    expect(JSON.stringify(result)).not.toContain('UI_TEST_ONLY_RESTRICTED_CONTENT');expect(put).not.toHaveBeenCalled();
  });
  it.each(['public','attenuated'])('rejects %s account policy even with research scope',async mode=>{
    const actor=principal();actor.accountContext.account_policy=HELIX_USER_ACCOUNT_POLICY;
    if(mode==='public') actor.accountType='user';
    const {result,put}=await call(actor,wrap(solar()));
    expect(result.isError).toBe(true);expect(typedFailure(result)).toMatchObject({error:'account_policy_blocked'});
    expect(put).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('UI_TEST_ONLY_RESTRICTED_CONTENT');
  });
  it.each([0,1])('keeps Device Check narrow through %i retrieval wrappers even for a research-scoped developer',async depth=>{
    let observation=solar();if(depth) observation=wrap(observation);
    const {result,put}=await call(principal(),observation,true);
    expect(result.isError).toBe(true);expect(typedFailure(result)).toMatchObject({error:'account_policy_blocked'});
    expect(put).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('UI_TEST_ONLY_RESTRICTED_CONTENT');
  });
});
