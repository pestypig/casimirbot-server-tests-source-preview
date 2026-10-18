import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {describe,expect,it,vi} from 'vitest';
import {HELIX_DEVELOPER_ACCOUNT_POLICY,HELIX_USER_ACCOUNT_POLICY} from '@shared/helix-account-session';
import {SOLAR_RESEARCH_READ_SCOPE} from '@shared/solar-research-mcp';
import type {HelixAgentApiPrincipal} from '../../services/helix-agent-api/types';
import type {RegisteredSolarRegionsReceipt} from '../../services/solar-research/registered-active-regions';
import {createHelixDeviceCheckMcpServer,createHelixMcpServer} from '../helix-mcp-server';

const TOOL='helix_solar_registered_regions_current';
const imageId='192879714';
const sha='a'.repeat(64);
const receipt:RegisteredSolarRegionsReceipt={
  schemaVersion:'solar-registered-active-regions/1',
  image:{schemaVersion:'solar-live-preview/2',source:'Helioviewer / NASA SDO HMI',
    sourceId:'helioviewer-hmi',selectionReason:'explicit_source',productKind:'browse_image',
    channel:'hmiContinuum',label:'HMI continuum intensitygram (Helioviewer)',
    instrument:'HMI',wavelength_A:null,
    sourceUrl:`https://api.helioviewer.org/v2/downloadImage/?id=${imageId}&width=512&type=jpg`,
    retrievedAt:'2026-10-10T16:00:00.000Z',upstreamLastModifiedAt:null,
    observationAt:'2026-10-10T16:00:00.000Z',upstreamImageId:imageId,sha256:sha,
    imageUrl:`/api/star-watcher/live-preview/image?channel=hmiContinuum&source=helioviewer-hmi&sha256=${sha}`,
    stale:false,scienceRunAllowed:false,quantitativeComparisonAllowed:false,
    widthPx:512,heightPx:512},
  report:{sourceUrl:'https://services.swpc.noaa.gov/text/srs.txt',
    sourceSha256:'b'.repeat(64),issuedAt:'2026-10-10T00:30:00.000Z',
    validAt:'2026-10-10T00:00:00.000Z',fetchedAt:'2026-10-10T16:00:00.000Z'},
  wcs:{headerUrl:`https://api.helioviewer.org/v2/getJP2Header/?id=${imageId}`,
    headerSha256:'c'.repeat(64),headerObservationAt:'2026-10-10T16:00:00.000Z',
    nativeWidthPx:4096,nativeHeightPx:4096,qualityFlag:1024,
    qualityInterpretation:'numeric_flag_only_not_science_admission'},
  registration:{method:'noaa_srs_carrington_hpc_tan',rotationAssumption:'fixed_carrington_longitude',
    timeDeltaSeconds:57600,maxAbsTimeDeltaSeconds:129600,
    positionSemantics:'approximate_report_location_not_spot_centroid',pixelOrigin:'top_left',
    scienceRunAllowed:false,quantitativeComparisonAllowed:false},
  regions:[{noaaNumber:4549,location:'N10W41',latitudeDeg:10,
    centralMeridianDistanceDeg:41,carringtonLongitudeDeg:216,category:'sunspot',
    areaMillionths:40,spotClass:'Dao',spotCount:8,magneticClass:'Beta',
    visible:true,xPx:400,yPx:200,omissionReason:null}],
};

function principal():HelixAgentApiPrincipal{return {tenantId:'solar-registered-test-tenant',
  accountProfileId:'solar-registered-test-profile',issuer:'test',subjectId:'test',accountType:'developer',
  scopes:new Set([SOLAR_RESEARCH_READ_SCOPE]),tokenExpiresAt:null,
  accountContext:{session_id:null,profile_id:'solar-registered-test-profile',trusted_account_session:false,
    account_session:null,account_policy:HELIX_DEVELOPER_ACCOUNT_POLICY}};}

async function withMcp(actor:HelixAgentApiPrincipal,
  current:(channel:'hmiContinuum'|'hmiMag')=>Promise<RegisteredSolarRegionsReceipt>,
  run:(client:Client)=>Promise<void>,device=false){
  const input={principal:actor,solarRegisteredRegionsService:{current},
    mcpEvidenceObservationStore:{put:vi.fn(),get:vi.fn()}};
  const server=device?createHelixDeviceCheckMcpServer(input):createHelixMcpServer(input);
  const client=new Client({name:'solar-registered-regions-parity-test',version:'1'},{capabilities:{}});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  try{await run(client);}finally{await client.close();await server.close();}
}

describe('exact-image NOAA region projection through developer MCP',()=>{
  it('returns the same bounded source-linked receipt as the UI route, without image bytes',async()=>{
    const current=vi.fn(async()=>receipt);
    await withMcp(principal(),current,async client=>{
      const tool=(await client.listTools()).tools.find(item=>item.name===TOOL);
      expect(tool?.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false,openWorldHint:true});
      expect(tool?._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:[SOLAR_RESEARCH_READ_SCOPE]}]);
      const result=await client.callTool({name:TOOL,arguments:{channel:'hmiContinuum'}});
      expect(result.isError,JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toEqual(receipt);
      expect(JSON.stringify(result.structuredContent)).not.toContain('base64');
    });
    expect(current).toHaveBeenCalledWith('hmiContinuum');
  });

  it('rejects missing scope and omits the tool on public, attenuated and device catalogs',async()=>{
    const current=vi.fn(async()=>receipt);
    const withoutScope=principal();withoutScope.scopes.clear();
    await withMcp(withoutScope,current,async client=>{
      expect((await client.callTool({name:TOOL,arguments:{channel:'hmiContinuum'}})).isError).toBe(true);
    });
    for(const mode of ['public','attenuated','device'] as const){
      const actor=principal();
      if(mode==='public')actor.accountType='user';
      if(mode!=='device')actor.accountContext.account_policy=HELIX_USER_ACCOUNT_POLICY;
      await withMcp(actor,current,async client=>{
        expect((await client.listTools()).tools.some(item=>item.name===TOOL)).toBe(false);
      },mode==='device');
    }
    expect(current).not.toHaveBeenCalled();
  });

  it('rejects arbitrary URLs, mismatched header IDs and an unregistered source',async()=>{
    const current=vi.fn(async()=>receipt);
    await withMcp(principal(),current,async client=>{
      for(const args of [{channel:'aia193'},
        {channel:'hmiContinuum',url:'https://example.com/image'}]){
        expect((await client.callTool({name:TOOL,arguments:args})).isError).toBe(true);
      }
    });
    expect(current).not.toHaveBeenCalled();
    const wrong={...receipt,wcs:{...receipt.wcs,headerUrl:'https://api.helioviewer.org/v2/getJP2Header/?id=9'}};
    await withMcp(principal(),async()=>wrong,async client=>{
      const result=await client.callTool({name:TOOL,arguments:{channel:'hmiContinuum'}});
      expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();
    });
    const staticImage={...receipt,image:{...receipt.image,sourceId:'sdo' as const}};
    await withMcp(principal(),async()=>staticImage,async client=>{
      const result=await client.callTool({name:TOOL,arguments:{channel:'hmiContinuum'}});
      expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();
    });
  });
});
