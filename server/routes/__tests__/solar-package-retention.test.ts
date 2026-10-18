import express from 'express';
import request from 'supertest';
import {syntheticSolarPortablePackage} from '../../../tests/fixtures/solar-portable-package';
import {it,expect,vi} from 'vitest';
import * as accounts from '../../services/helix-account/account-session-store';
import {HELIX_USER_ACCOUNT_POLICY} from '../../../shared/helix-account-session';
import {accountSessionRouter} from '../account-session';
import {resetAccountSessionStore} from '../../services/helix-account/account-session-store';
it('binds explicit package saving and reopening to the signed-in developer profile',async()=>{
  await resetAccountSessionStore();
  const app=express();app.use(express.json({limit:'10mb'}));app.use('/api/account',accountSessionRouter);
  const path='/api/account/solar-research/packages';
  const packageJson=await syntheticSolarPortablePackage(true);
  await request(app).post(path).send({packageJson,expected_profile_id:'p'}).expect(401);
  const user=request.agent(app);
  await user.post('/api/account/session/sign-in').send({profile_id:'package-user',account_type:'user'}).expect(200);
  await user.post(path).send({packageJson,expected_profile_id:'package-user'}).expect(403);
  const developer=request.agent(app);const profileId='package-developer';
  await developer.post('/api/account/session/sign-in').send({profile_id:profileId,account_type:'developer'}).expect(200);
  await developer.post(path).send({packageJson,expected_profile_id:'other'}).expect(409);
  await developer.post(path).send({packageJson:'{}',expected_profile_id:profileId}).expect(400);
  const saved=await developer.post(path).send({packageJson,expected_profile_id:profileId}).expect(201);
  expect(saved.body).toMatchObject({ok:true,saved:true,profileId,scientificAdmission:false,scienceRunAllowed:false});
  await developer.post(path).send({packageJson,expected_profile_id:profileId}).expect(409);
  const query={packageId:saved.body.packageId,expected_profile_id:profileId};
  await request(app).get(path).query(query).expect(401);
  await user.get(path).query({...query,expected_profile_id:'package-user'}).expect(403);
  await developer.get(path).query({...query,expected_profile_id:'other'}).expect(409);
  await developer.get(path).query({...query,packageId:'../outside'}).expect(400);
  const reopened=await developer.get(path).query(query).expect(200);
  expect(reopened.body.packageJson).toBe(packageJson);expect(reopened.headers['cache-control']).toBe('no-store');
  const catalogQuery={expected_profile_id:profileId,offset:'0',limit:'1'};
  await request(app).get(path).query(catalogQuery).expect(401);
  await user.get(path).query({...catalogQuery,expected_profile_id:'package-user'}).expect(403);
  await developer.get(path).query({...catalogQuery,expected_profile_id:'other'}).expect(409);
  for(const extra of [{limit:'21'},{offset:'100'},{limit:''},{offset:'1e0'},{tenantId:'forged'}])
    await developer.get(path).query({...catalogQuery,...extra}).expect(400);
  const catalog=(await developer.get(path).query(catalogQuery).expect(200)).body;
  expect(catalog).toMatchObject({ok:true,totalPackages:1,scienceRunAllowed:false,packages:[{packageId:saved.body.packageId,comparisonRows:1}]});
  expect(JSON.stringify(catalog)).not.toContain('packageJson');expect(JSON.stringify(catalog)).not.toContain('map_b64');
  const before=(await developer.get('/api/account/session').expect(200)).body;
  for(const requestQuery of [query,catalogQuery]) {
    for(const mode of ['signed-out','public','profile','session']) {
      const after=mode==='signed-out'?{...before,session:null}:mode==='public'?{...before,account_policy:HELIX_USER_ACCOUNT_POLICY}:
        mode==='profile'?{...before,session:{...before.session,profile:{...before.session.profile,profile_id:'different-profile'}}}:
        {...before,session:{...before.session,session_id:'different-test-session'}};
      const lookup=vi.spyOn(accounts,'getAccountSessionStatus').mockResolvedValueOnce(before).mockResolvedValueOnce(after);
      try {
        const response=await developer.get(path).query(requestQuery).expect(mode==='signed-out'?401:mode==='public'?403:409);
        expect(response.body.packageJson).toBeUndefined();expect(response.body.packages).toBeUndefined();
        expect(response.headers['cache-control']).toBe('no-store');expect(lookup).toHaveBeenCalledTimes(2);
      }finally{lookup.mockRestore();}
    }
  }
  // Ordinary profile backup cannot overwrite or delete the server-retained chunks.
  await developer.post('/api/account/profile-storage/snapshot').send({expected_profile_id:profileId,entries:[],artifacts:[]}).expect(200);
  expect((await developer.get(path).query(query).expect(200)).body.packageJson).toBe(packageJson);
  const other=request.agent(app);
  await other.post('/api/account/session/sign-in').send({profile_id:'other-developer',account_type:'developer'}).expect(200);
  await other.get(path).query({...query,expected_profile_id:'other-developer'}).expect(404);
  expect((await other.get(path).query({...catalogQuery,expected_profile_id:'other-developer'}).expect(200)).body.packages).toEqual([]);
  await resetAccountSessionStore();
},60_000);
