import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {describe,expect,it,vi} from 'vitest';
import {HELIX_DEVELOPER_ACCOUNT_POLICY,HELIX_USER_ACCOUNT_POLICY} from '@shared/helix-account-session';
import {SOLAR_RESEARCH_READ_SCOPE} from '@shared/solar-research-mcp';
import type {HelixAgentApiPrincipal} from '../../services/helix-agent-api/types';
import {createHelixDeviceCheckMcpServer,createHelixMcpServer} from '../helix-mcp-server';

const TOOL='helix_solar_live_preview_current';
const sha='a'.repeat(64);
type Channel='hmiContinuum'|'hmiMag';
const sdoContinuum={
  schemaVersion:'solar-live-preview/2',source:'NASA/SDO',sourceId:'sdo',
  selectionReason:'preferred_fresh',productKind:'browse_image',channel:'hmiContinuum',
  label:'HMI continuum intensitygram (gray)',instrument:'HMI',wavelength_A:null,
  sourceUrl:'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMII.jpg',
  retrievedAt:'2026-10-10T18:00:00.000Z',upstreamLastModifiedAt:'2026-10-10T17:59:00.000Z',
  observationAt:null,upstreamImageId:null,sha256:sha,
  imageUrl:`/api/star-watcher/live-preview/image?channel=hmiContinuum&source=sdo&sha256=${sha}`,
  stale:false,scienceRunAllowed:false,quantitativeComparisonAllowed:false,
} as const;
const hmiMag={
  schemaVersion:'solar-live-preview/2',source:'Helioviewer / NASA SDO HMI',
  sourceId:'helioviewer-hmi-mag',selectionReason:'preferred_stale',
  productKind:'browse_image',channel:'hmiMag',label:'HMI magnetogram (Helioviewer)',
  instrument:'HMI',wavelength_A:null,
  sourceUrl:'https://api.helioviewer.org/v2/downloadImage/?id=192879726&width=512&type=jpg',
  retrievedAt:'2026-10-10T18:00:00.000Z',upstreamLastModifiedAt:null,
  observationAt:'2026-10-10T16:02:45.000Z',upstreamImageId:'192879726',sha256:sha,
  imageUrl:`/api/star-watcher/live-preview/image?channel=hmiMag&source=helioviewer-hmi-mag&sha256=${sha}`,
  stale:false,scienceRunAllowed:false,quantitativeComparisonAllowed:false,
} as const;
const helioviewerContinuum={...hmiMag,
  channel:'hmiContinuum',sourceId:'helioviewer-hmi',
  label:'HMI continuum intensitygram (Helioviewer)',
  imageUrl:`/api/star-watcher/live-preview/image?channel=hmiContinuum&source=helioviewer-hmi&sha256=${sha}`,
} as const;
const sdoMag={...sdoContinuum,
  channel:'hmiMag',label:'HMI magnetogram',
  sourceUrl:'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIB.jpg',
  imageUrl:`/api/star-watcher/live-preview/image?channel=hmiMag&source=sdo&sha256=${sha}`,
} as const;

function principal():HelixAgentApiPrincipal{return {tenantId:'solar-preview-test-tenant',
  accountProfileId:'solar-preview-test-profile',issuer:'test',subjectId:'test',accountType:'developer',
  scopes:new Set([SOLAR_RESEARCH_READ_SCOPE]),tokenExpiresAt:null,
  accountContext:{session_id:null,profile_id:'solar-preview-test-profile',trusted_account_session:false,
    account_session:null,account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY}};}

async function withMcp(actor:HelixAgentApiPrincipal,latest:(channel:Channel)=>Promise<unknown>,
  run:(client:Client)=>Promise<void>,device=false){
  const input={principal:actor,solarLivePreviewService:{latest},
    mcpEvidenceObservationStore:{put:vi.fn(),get:vi.fn()}};
  const server=device?createHelixDeviceCheckMcpServer(input):createHelixMcpServer(input);
  const client=new Client({name:'solar-live-preview-parity-test',version:'1'},{capabilities:{}});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  try{await run(client);}finally{await client.close();await server.close();}
}

describe('HMI live browse receipt through developer MCP',()=>{
  it.each([
    ['hmiContinuum',sdoContinuum],['hmiContinuum',helioviewerContinuum],
    ['hmiMag',sdoMag],['hmiMag',hmiMag],
  ] as const)('publishes a scoped read-only tool and returns the exact %s UI receipt without bytes',
    async(channel,receipt)=>{
      const latest=vi.fn(async()=>receipt);
      await withMcp(principal(),latest,async client=>{
        const tool=(await client.listTools()).tools.find(item=>item.name===TOOL);
        expect(tool?.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false,openWorldHint:true});
        expect(tool?._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:[SOLAR_RESEARCH_READ_SCOPE]}]);
        const result=await client.callTool({name:TOOL,arguments:{channel}});
        expect(result.isError,JSON.stringify(result)).not.toBe(true);
        expect(result.structuredContent).toEqual(receipt);
        expect(JSON.stringify(result.structuredContent)).not.toContain('base64');
      });
      expect(latest).toHaveBeenCalledTimes(1);
      expect(latest).toHaveBeenCalledWith(channel);
    });

  it('requires solar read scope before source access',async()=>{
    const actor=principal();actor.scopes.clear();const latest=vi.fn(async()=>sdoContinuum);
    await withMcp(actor,latest,async client=>{
      const result=await client.callTool({name:TOOL,arguments:{channel:'hmiContinuum'}});
      expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();
    });
    expect(latest).not.toHaveBeenCalled();
  });

  it.each(['public','attenuated','device'])('omits the tool on %s surfaces',async mode=>{
    const actor=principal();
    if(mode==='public')actor.accountType='user';
    if(mode==='public'||mode==='attenuated')actor.accountContext.account_policy=HELIX_USER_ACCOUNT_POLICY;
    const latest=vi.fn(async()=>sdoContinuum);
    await withMcp(actor,latest,async client=>{
      expect((await client.listTools()).tools.some(item=>item.name===TOOL)).toBe(false);
    },mode==='device');
    expect(latest).not.toHaveBeenCalled();
  });

  it('rejects non-HMI channels and extra arguments without source access',async()=>{
    const latest=vi.fn(async()=>sdoContinuum);
    await withMcp(principal(),latest,async client=>{
      for(const args of [{channel:'aia193'},{channel:'hmiContinuum',arbitrary:'x'}]){
        const result=await client.callTool({name:TOOL,arguments:args});
        expect(result.isError).toBe(true);
      }
    });
    expect(latest).not.toHaveBeenCalled();
  });

  it('does not publish a mismatched source or unvalidated image URL',async()=>{
    const bad={...hmiMag,sourceUrl:'https://example.com/unrelated.jpg'};
    const latest=vi.fn(async()=>bad);
    await withMcp(principal(),latest,async client=>{
      const result=await client.callTool({name:TOOL,arguments:{channel:'hmiMag'}});
      expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('example.com');
    });
    expect(latest).toHaveBeenCalledOnce();
  });
});
