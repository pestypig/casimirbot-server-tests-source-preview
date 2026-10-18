import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {gzipSync} from 'node:zlib';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HELIX_DEVELOPER_ACCOUNT_POLICY, HELIX_USER_ACCOUNT_POLICY } from "@shared/helix-account-session";
import { SOLAR_RESEARCH_READ_SCOPE } from "@shared/solar-research-mcp";
import { HELIX_DESKTOP_MCP_ISSUER } from "../../auth/helix-desktop-mcp-identity";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { createHelixMcpServer } from "../helix-mcp-server";
import {acquireSolarMagneticArchiveProduct} from '../../services/solar-research/magnetic-archive-acquisition';

function principal(): HelixAgentApiPrincipal {
  const policy = HELIX_DEVELOPER_ACCOUNT_POLICY;
  const now = new Date().toISOString();
  const profile = { profile_id: "native-read-profile", display_name: "Fixture", email: null,
    auth_mode: "web_auth" as const, account_type: "developer" as const, provider: "external_oauth" as const,
    provider_alias: "test", provider_subject: "native-read-profile", picture_url: null, created_at: now, updated_at: now };
  return { issuer: HELIX_DESKTOP_MCP_ISSUER, subjectId: profile.profile_id, accountProfileId: profile.profile_id,
    tenantId: "native-read-tenant", accountType: "developer", trustedDeveloperProfile: true,
    mcpClientRef: `mcp_client:native_desktop:${"a".repeat(64)}`, oauthClientRef: null,
    scopes: new Set([SOLAR_RESEARCH_READ_SCOPE]), tokenExpiresAt: null,
    accountContext: { profile_id: profile.profile_id, session_id: "account_session:native-read-test", trusted_account_session: true,
      account_policy: policy, account_session: { schema: "helix.account_session.v1", session_id: "account_session:native-read-test",
        profile, account_policy: policy, status: "active", memory_scope: "profile", created_at: now, updated_at: now } } };
}
async function connect(actor = principal()) {
  const read = vi.fn(async () => null);
  const readCatalog = vi.fn(async (owner) => ({ owner, catalog: { schemaVersion: "solar-package-catalog/1",
    offset: 0, totalPackages: 0, nextOffset: null, order: "package_id_lexicographic",
    scientificAdmission: false, scienceRunAllowed: false, packages: [] } }));
  const put = vi.fn(async () => {});
  const server = createHelixMcpServer({ principal: actor, solarResearchRecordReader: {read},
    solarResearchPackageReader: {read, readCatalog},solarMagneticBundleReader:{read},
    mcpEvidenceObservationStore: {put, get: vi.fn()} });
  const client = new Client({name: "native-read-fixture", version: "1"});
  const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  return {client, read, readCatalog, put, close: async () => { await client.close(); await server.close(); }};
}
const names = ["helix_solar_research_comparison_get", "helix_solar_research_package_get", "helix_solar_research_package_list",
  "helix_solar_magnetic_bundle_get", "helix_solar_sphere_scene_get",
  "helix_solar_magnetic_globe_inspect",
  "helix_solar_magnetic_archive_search",
  "helix_solar_magnetic_acquisition_get",
  "helix_public_ui_catalog", "helix_evidence_observation_get"];
async function catalog(client: Client) {
  return (await client.request({method: "tools/list"}, z.object({tools: z.array(z.object({name:z.string(),
    securitySchemes:z.unknown().optional(), _meta:z.record(z.unknown()).optional()}).passthrough())}))).tools;
}
describe("native read-only tool authentication declarations", () => {
  it("publishes native schemes at both wire locations without changing other tools or executing reads", async () => {
    const s = await connect(); try {
      const tools = await catalog(s.client);
      for (const name of names) {
        const tool = tools.find(t => t.name === name)!;
        expect(tool.securitySchemes, name).toEqual([{type:"noauth"}]);
        expect(tool._meta?.securitySchemes, name).toEqual([{type:"noauth"}]);
      }
      expect(tools.find(t=>t.name === "helix_run_start")?.securitySchemes).toMatchObject([{type:"oauth2"}]);
      expect(tools.find(t=>t.name === "helix_solar_magnetic_globe_show")?.securitySchemes)
        .toMatchObject([{type:"oauth2"}]);
      expect(s.read).not.toHaveBeenCalled(); expect(s.readCatalog).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });
  it.each(["oauth", "untrusted", "signed-out", "no-native-client", "user-policy"])("does not declare native access for %s", async kind => {
    const actor = principal();
    if(kind === "oauth") actor.issuer = "https://issuer.example";
    if(kind === "untrusted") actor.accountContext.trusted_account_session = false;
    if(kind === "signed-out") actor.accountContext.account_session!.status = "signed_out";
    if(kind === "no-native-client") actor.mcpClientRef = null;
    if(kind === "user-policy") actor.accountContext.account_policy = HELIX_USER_ACCOUNT_POLICY;
    const s = await connect(actor); try {
      const tools = await catalog(s.client);
      for (const tool of tools.filter(t=>names.includes(t.name))) expect(tool.securitySchemes).toMatchObject([{type:"oauth2"}]);
    } finally { await s.close(); }
  });
  it("still rejects missing scope before any source read or evidence write", async () => {
    const actor = principal(); actor.scopes.clear(); const s = await connect(actor); try {
      const result = await s.client.callTool({name:"helix_solar_research_package_list", arguments:{}});
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain("insufficient_scope");
      expect(s.readCatalog).not.toHaveBeenCalled(); expect(s.put).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });
  it("returns an empty owner-scoped catalog without inventing data or scientific admission", async () => {
    const s = await connect(); try {
      const result = await s.client.callTool({name:"helix_solar_research_package_list", arguments:{}});
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({totalPackages:0, packages:[], scientificAdmission:false, scienceRunAllowed:false});
      expect(s.readCatalog.mock.calls[0][0]).toEqual({tenantId:"native-read-tenant",accountProfileId:"native-read-profile"});
      expect(s.put).toHaveBeenCalledOnce();
    } finally { await s.close(); }
  });
  it("searches fixed magnetic archive paths through MCP and retains a bounded catalog observation", async () => {
    const today = new Date().toISOString().slice(0,10);
    vi.stubGlobal("fetch",vi.fn(async (url:string) => url.startsWith("https://magmap.nso.edu/")
      ? new Response(`<a href="mrzqs${today.slice(2).replaceAll("-","")}t1200c2316_265.fits.gz">map</a>`,{status:200})
      : new Response(null,{status:404})));
    const s=await connect();try{
      const result=await s.client.callTool({name:"helix_solar_magnetic_archive_search",arguments:{dateUtc:today}});
      expect(result.isError,JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({dateUtc:today,scientificAdmission:false,
        products:[{provider:"nso_gong",qualityStatus:"not_inspected",acquisitionState:"not_downloaded"}],
        mcp_evidence:{capability_id:"helix.solar_research.magnetic_archive.search"}});
      expect(s.put).toHaveBeenCalledOnce();
      expect(s.put.mock.calls[0][0].owner).toEqual({tenantId:"native-read-tenant",accountProfileId:"native-read-profile"});
    }finally{await s.close();vi.unstubAllGlobals();}
  });
  it('reads the exact acquired-byte receipt through owner-scoped MCP without exposing FITS bytes',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'solar-mcp-acquisition-test-'));
    const previous=process.env.SUNPY_CACHE_ROOT;process.env.SUNPY_CACHE_ROOT=root;
    const day=new Date().toISOString().slice(0,10),name=`mrzqs${day.slice(2).replaceAll('-','')}t1200c2316_265.fits.gz`;
    const sourceUrl=`https://magmap.nso.edu/oQR/zqs/${day.slice(0,7).replace('-','')}/mrzqs${day.slice(2).replaceAll('-','')}/${name}`;
    const bytes=gzipSync(Buffer.from('SIMPLE  =                    T'.padEnd(128)));
    try{
      const receipt=await acquireSolarMagneticArchiveProduct({tenantId:'native-read-tenant',accountProfileId:'native-read-profile'},
        {dateUtc:day,provider:'nso_gong',providerRecordKey:name},{env:process.env,
          search:vi.fn(async()=>({providers:[{provider:'nso_gong',status:'available'}],products:[{
            provider:'nso_gong',providerRecordKey:name,kind:'derived_global_radial_map',sourceUrl,
          }]})) as any,
          fetcher:vi.fn(async()=>new Response(bytes,{status:200})) as typeof fetch});
      const s=await connect();try{
        const result=await s.client.callTool({name:'helix_solar_magnetic_acquisition_get',
          arguments:{acquisitionId:receipt.acquisitionId}});
        expect(result.isError,JSON.stringify(result)).not.toBe(true);
        expect(result.structuredContent).toMatchObject({acquisitionId:receipt.acquisitionId,
          sha256:receipt.sha256,scientificAdmission:false,
          mcp_evidence:{capability_id:'helix.solar_research.magnetic_acquisition.inspect'}});
        expect(JSON.stringify(result)).not.toContain(bytes.toString('base64'));
        expect(s.put).toHaveBeenCalledOnce();
      }finally{await s.close();}
    }finally{
      if(previous===undefined)delete process.env.SUNPY_CACHE_ROOT;else process.env.SUNPY_CACHE_ROOT=previous;
      if(path.isAbsolute(root)&&path.dirname(root)===os.tmpdir())await rm(root,{recursive:true,force:false});
    }
  });
  it('preserves the nonzero HMI header flag and claim ceiling in the owner-scoped MCP receipt',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'solar-mcp-hmi-test-'));
    const previous=process.env.SUNPY_CACHE_ROOT;process.env.SUNPY_CACHE_ROOT=root;
    const day=new Date().toISOString().slice(0,10);
    const key=`SunInTime/${day}/fblos.fits`;
    const hmiUrl=`https://suntoday.lmsal.com/sdomedia/SunInTime/${day.replaceAll('-','/')}/fblos.fits`;
    const bytes=Buffer.alloc(5760,0x20);
    const cards=(block:number,lines:string[])=>lines.forEach((line,index)=>bytes.write(line.padEnd(80,' '),block*2880+index*80,'ascii'));
    cards(0,['SIMPLE  = T','NAXIS   = 0','END']);
    cards(1,["XTENSION= 'BINTABLE'",'ZIMAGE  = T',"CONTENT = 'MAGNETOGRAM'",
      "TELESCOP= 'SDO/HMI'","INSTRUME= 'HMI_FRONT2'","BUNIT   = 'Gauss'",
      "CTYPE1  = 'HPLN-TAN'","CTYPE2  = 'HPLT-TAN'",
      `DATE-OBS= '${day}T12:00:00.000'`,'QUALITY = 1024',
      "DRMS_ID = 'lm_jps.m45s_nrt:11120854:magnetogram'",'END']);
    try{
      const receipt=await acquireSolarMagneticArchiveProduct(
        {tenantId:'native-read-tenant',accountProfileId:'native-read-profile'},
        {dateUtc:day,provider:'lmsal_sdo',providerRecordKey:key},{env:process.env,
          search:vi.fn(async()=>({providers:[{provider:'lmsal_sdo',status:'available'}],products:[{
            provider:'lmsal_sdo',providerRecordKey:key,kind:'measured_visible_disk_los',sourceUrl:hmiUrl,
          }]})) as any,
          fetcher:vi.fn(async()=>new Response(bytes,{status:200})) as typeof fetch});
      const s=await connect();try{
        const result=await s.client.callTool({name:'helix_solar_magnetic_acquisition_get',
          arguments:{acquisitionId:receipt.acquisitionId}});
        expect(result.isError,JSON.stringify(result)).not.toBe(true);
        expect(result.structuredContent).toMatchObject({acquisitionId:receipt.acquisitionId,
          provider:'lmsal_sdo',observedAtUtc:`${day}T12:00:00.000Z`,
          qualityStatus:'header_quality_nonzero',hmiHeader:{qualityFlag:1024,
            drmsId:'lm_jps.m45s_nrt:11120854:magnetogram'},
          claimCeiling:'downloaded_bytes_and_header_flag_only_not_validated_field',
          scientificAdmission:false,
          mcp_evidence:{capability_id:'helix.solar_research.magnetic_acquisition.inspect'}});
        expect(JSON.stringify(result)).not.toContain(bytes.toString('base64'));
        expect(s.put).toHaveBeenCalledOnce();
      }finally{await s.close();}
    }finally{
      if(previous===undefined)delete process.env.SUNPY_CACHE_ROOT;else process.env.SUNPY_CACHE_ROOT=previous;
      if(path.isAbsolute(root)&&path.dirname(root)===os.tmpdir())await rm(root,{recursive:true,force:false});
    }
  });
});
