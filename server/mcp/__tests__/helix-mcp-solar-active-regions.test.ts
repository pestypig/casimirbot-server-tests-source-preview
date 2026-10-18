import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {describe,expect,it,vi} from 'vitest';
import {HELIX_DEVELOPER_ACCOUNT_POLICY,HELIX_USER_ACCOUNT_POLICY} from '@shared/helix-account-session';
import {SOLAR_RESEARCH_READ_SCOPE} from '@shared/solar-research-mcp';
import type {HelixAgentApiPrincipal} from '../../services/helix-agent-api/types';
import {NOAA_SRS_SOURCE_URL,type NoaaSrsReceipt} from '../../services/solar-research/noaa-srs';
import {createHelixDeviceCheckMcpServer,createHelixMcpServer} from '../helix-mcp-server';

const TOOL='helix_solar_active_regions_current';
const RECEIPT:NoaaSrsReceipt={
  schemaVersion:'solar-active-regions-current/1',sourceUrl:NOAA_SRS_SOURCE_URL,
  sourceSha256:'a'.repeat(64),issuedAt:'2026-10-10T00:30:00.000Z',
  validAt:'2026-10-10T00:00:00.000Z',fetchedAt:'2026-10-10T18:00:00.000Z',
  complete:true,regions:[{noaaNumber:4545,location:'N18W46',latitudeDeg:18,
    centralMeridianDistanceDeg:46,carringtonLongitudeDeg:222,
    category:'sunspot',areaMillionths:40,
    spotClass:'Dao',spotCount:8,magneticClass:'Beta'}],
};

function principal():HelixAgentApiPrincipal{return {tenantId:'solar-regions-test-tenant',
  accountProfileId:'solar-regions-test-profile',issuer:'test',subjectId:'test',accountType:'developer',
  scopes:new Set([SOLAR_RESEARCH_READ_SCOPE]),tokenExpiresAt:null,
  accountContext:{session_id:null,profile_id:'solar-regions-test-profile',trusted_account_session:false,
    account_session:null,account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY}};}

async function withMcp(actor:HelixAgentApiPrincipal,current:()=>Promise<NoaaSrsReceipt>,
  run:(client:Client)=>Promise<void>,device=false){
  const input={principal:actor,solarActiveRegionsService:{current},
    mcpEvidenceObservationStore:{put:vi.fn(),get:vi.fn()}};
  const server=device?createHelixDeviceCheckMcpServer(input):createHelixMcpServer(input);
  const client=new Client({name:'solar-active-regions-parity-test',version:'1'},{capabilities:{}});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  try{await run(client);}finally{await client.close();await server.close();}
}

describe('NOAA daily regions through developer MCP',()=>{
  it('publishes a read-only scoped tool and returns the same verified receipt as HTTP',async()=>{
    const current=vi.fn(async()=>RECEIPT);
    await withMcp(principal(),current,async client=>{
      const tool=(await client.listTools()).tools.find(item=>item.name===TOOL);
      expect(tool?.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false,openWorldHint:true});
      expect(tool?._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:[SOLAR_RESEARCH_READ_SCOPE]}]);
      const result=await client.callTool({name:TOOL,arguments:{}});
      expect(result.isError,JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toEqual(RECEIPT);
    });
    expect(current).toHaveBeenCalledOnce();
  });

  it('requires solar read scope before source access',async()=>{
    const actor=principal();actor.scopes.clear();const current=vi.fn(async()=>RECEIPT);
    await withMcp(actor,current,async client=>{
      const result=await client.callTool({name:TOOL,arguments:{}});
      expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result._meta)).toContain(SOLAR_RESEARCH_READ_SCOPE);
    });
    expect(current).not.toHaveBeenCalled();
  });

  it.each(['public','attenuated','device'])('omits the tool on %s surfaces',async mode=>{
    const actor=principal();
    if(mode==='public')actor.accountType='user';
    if(mode==='public'||mode==='attenuated')actor.accountContext.account_policy=HELIX_USER_ACCOUNT_POLICY;
    const current=vi.fn(async()=>RECEIPT);
    await withMcp(actor,current,async client=>{
      expect((await client.listTools()).tools.some(item=>item.name===TOOL)).toBe(false);
    },mode==='device');
    expect(current).not.toHaveBeenCalled();
  });

  it('does not publish partial output when source acquisition fails',async()=>{
    const current=vi.fn(async():Promise<NoaaSrsReceipt>=>{throw new Error('UPSTREAM_PRIVATE_DETAIL');});
    await withMcp(principal(),current,async client=>{
      const result=await client.callTool({name:TOOL,arguments:{}});
      expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('UPSTREAM_PRIVATE_DETAIL');
      expect(JSON.stringify(result)).not.toContain('solar-active-regions-current/1');
    });
    expect(current).toHaveBeenCalledOnce();
  });
});
