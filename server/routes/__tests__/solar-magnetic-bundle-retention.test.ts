import express from 'express';
import request from 'supertest';
import {webcrypto} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach,it,expect,vi} from 'vitest';
import {accountSessionRouter} from '../account-session';
import {resetAccountSessionStore} from '../../services/helix-account/account-session-store';
import {solarGlobalRadialMapContentId,solarGlobalRadialMapSchema} from '../../../shared/solar-magnetic-dipole';
import {prepareSolarMagneticViewRecipe} from '../../../shared/solar-magnetic-view-recipe';
import {prepareSolarMagneticComparisonBundle} from '../../../shared/solar-magnetic-comparison-bundle';

const localBundlePath=resolve(process.cwd(),'.codex-build/solar-magnetic-source-20260928/gong-hmi-comparison-bundle-v1.json');

afterEach(()=>vi.unstubAllGlobals());
async function example(){
  vi.stubGlobal('crypto',webcrypto);
  const map=solarGlobalRadialMapSchema.parse({schemaVersion:'solar-global-radial-map/1',
    source:{provider:'test',productId:'retention-fixture',sourceUrl:'https://example.org/map',sha256:'a'.repeat(64),
      kind:'synoptic_derived',inputStartUtc:null,inputEndUtc:'2026-09-28T17:04:00Z',retrievedAtUtc:'2026-09-28T18:00:00Z'},
    coordinateFrame:'Carrington',grid:'longitude_by_sine_latitude_cell_centers',units:'G',
    longitudeCells:12,sineLatitudeCells:6,radialGauss:Array.from({length:72},(_,i)=>i<36?-10:10),
    observedMaskStatus:'unavailable',observedCellMask:Array(72).fill(false),
    sourceIdentityAuthenticated:false,scientificAdmission:false});
  const view=await prepareSolarMagneticViewRecipe({schemaVersion:'solar-magnetic-view-recipe/1',
    mapContentId:await solarGlobalRadialMapContentId(map),pfssModelId:null,
    coordinateFrame:'Carrington_display_cartesian',projection:'perspective',cameraPosition:[0.45,0.9,3.4],
    cameraTarget:'solar_center',fieldColorScale:'asinh_p98_abs_radial_gauss/1',
    showIllustrativeAxialDipole:false,showMapEquivalentDipole:true,showPfssLines:false,
    sourceIdentityAuthenticated:false,scientificAdmission:false,quantitativeJoinAllowed:false});
  return JSON.stringify(await prepareSolarMagneticComparisonBundle({schemaVersion:'solar-magnetic-comparison-bundle/1',
    map,pfss:null,losDiagnostic:null,view,sourceIdentityAuthenticated:false,
    scientificAdmission:false,quantitativeValidationAllowed:false}));
}

it('retains only a content-checked magnetic bundle under the signed-in developer and preserves it from backup replacement',async()=>{
  await resetAccountSessionStore();
  const app=express();app.use(express.json({limit:'3mb'}));app.use('/api/account',accountSessionRouter);
  const path='/api/account/solar-research/magnetic-bundles',bundleJson=await example();
  await request(app).post(path).send({expected_profile_id:'x',bundleJson}).expect(401);
  const publicUser=request.agent(app);
  await publicUser.post('/api/account/session/sign-in').send({profile_id:'magnetic-public',account_type:'user'}).expect(200);
  await publicUser.post(path).send({expected_profile_id:'magnetic-public',bundleJson}).expect(403);
  const developer=request.agent(app),profileId='magnetic-owner';
  await developer.post('/api/account/session/sign-in').send({profile_id:profileId,account_type:'developer'}).expect(200);
  await developer.post(path).send({expected_profile_id:'other',bundleJson}).expect(409);
  await developer.post(path).send({expected_profile_id:profileId,bundleJson:'{}'}).expect(400);
  const saved=(await developer.post(path).send({expected_profile_id:profileId,bundleJson}).expect(201)).body;
  expect(saved).toMatchObject({ok:true,saved:true,scientificAdmission:false,scienceRunAllowed:false});
  await developer.post(path).send({expected_profile_id:profileId,bundleJson}).expect(409);
  const query={expected_profile_id:profileId,bundleId:saved.bundleId};
  await request(app).get(path).query(query).expect(401);
  await developer.get(path).query({...query,expected_profile_id:'other'}).expect(409);
  await developer.get(path).query({...query,bundleId:'../outside'}).expect(400);
  const reopened=await developer.get(path).query(query).expect(200);
  expect(reopened.body.bundleJson).toBe(bundleJson);
  expect(reopened.body.scientificAdmission).toBe(false);
  expect(reopened.headers['cache-control']).toBe('no-store');
  await developer.post('/api/account/profile-storage/snapshot').send({expected_profile_id:profileId,entries:[],artifacts:[]}).expect(200);
  expect((await developer.get(path).query(query).expect(200)).body.bundleJson).toBe(bundleJson);
  const other=request.agent(app);
  await other.post('/api/account/session/sign-in').send({profile_id:'magnetic-other',account_type:'developer'}).expect(200);
  await other.get(path).query({...query,expected_profile_id:'magnetic-other'}).expect(404);
  await resetAccountSessionStore();
},60_000);

it.runIf(existsSync(localBundlePath))('retains and reopens the actual local GONG/PFSS/HMI bundle without changing its identity',async()=>{
  await resetAccountSessionStore();
  const app=express();app.use(express.json({limit:'6mb'}));app.use('/api/account',accountSessionRouter);
  const developer=request.agent(app),profileId='magnetic-real-bundle-local-fixture';
  const bundleJson=readFileSync(localBundlePath,'utf8');
  const bundle=JSON.parse(bundleJson) as {bundleId:string};
  try{
    await developer.post('/api/account/session/sign-in').send({profile_id:profileId,account_type:'developer'}).expect(200);
    const saved=(await developer.post('/api/account/solar-research/magnetic-bundles')
      .send({expected_profile_id:profileId,bundleJson}).expect(201)).body;
    expect(saved).toMatchObject({ok:true,saved:true,bundleId:bundle.bundleId,
      scientificAdmission:false,scienceRunAllowed:false});
    const reopened=(await developer.get('/api/account/solar-research/magnetic-bundles')
      .query({expected_profile_id:profileId,bundleId:bundle.bundleId}).expect(200)).body;
    expect(reopened.bundleJson).toBe(bundleJson);
    expect(reopened).toMatchObject({bundleId:bundle.bundleId,scientificAdmission:false,scienceRunAllowed:false});
    const other=request.agent(app);
    await other.post('/api/account/session/sign-in').send({profile_id:'magnetic-real-other',account_type:'developer'}).expect(200);
    await other.get('/api/account/solar-research/magnetic-bundles')
      .query({expected_profile_id:'magnetic-real-other',bundleId:bundle.bundleId}).expect(404);
  }finally{await resetAccountSessionStore();}
},60_000);
