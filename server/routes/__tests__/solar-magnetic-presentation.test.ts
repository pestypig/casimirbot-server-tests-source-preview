import {createHash} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {describe,expect,it} from 'vitest';
import {createSolarMagneticPresentationRouter} from '../solar-magnetic-presentation';
import {MagneticGlobePresentationService} from '../../services/solar-research/magnetic-globe-presentation';

const sameOrigin={Host:'localhost',Origin:'http://localhost','Sec-Fetch-Site':'same-origin'};
const viewInstanceId='11111111-1111-4111-8111-111111111111';
const identity={bundleId:'solar-magnetic-bundle:'+'a'.repeat(64),
  mapContentId:'solar-radial:'+'b'.repeat(64),pfssModelId:null,
  viewRecipeId:'solar-magnetic-view:'+'d'.repeat(64)};
const owner=(profileId:string)=>({accountProfileId:profileId,
  tenantId:'desktop:'+createHash('sha256').update(profileId).digest('hex').slice(0,24)});
function setup(accountType:'developer'|'user'='developer',profileId='profile-one',sessionId='session-one',
  readRetainedBundle?:(owner:ReturnType<typeof owner>,bundleId:string)=>Promise<any>){
  const service=new MagneticGlobePresentationService();
  const app=express();app.use(express.json());
  app.use('/presentation',createSolarMagneticPresentationRouter({service,getSession:async()=>({
    session_id:sessionId,profile:{profile_id:profileId},account_policy:{account_type:accountType},
  }) as any,...(readRetainedBundle?{readRetainedBundle}:{})}));
  return {app,service};
}
describe('signed renderer magnetic presentation bridge',()=>{
  it('limits presence, pending and acknowledgement to the active developer session',async()=>{
    const {app,service}=setup();
    const presence=await request(app).post('/presentation/presence').set(sameOrigin)
      .send({viewInstanceId,revision:2});
    expect(presence.status).toBe(200);
    const queued=service.request(owner('profile-one'),identity,viewInstanceId,2);
    const pending=await request(app).get('/presentation/pending?viewInstanceId='+viewInstanceId);
    expect(pending.body.request).toMatchObject({requestId:queued.requestId,state:'pending'});
    const wrong=await request(app).post('/presentation/ack').set(sameOrigin)
      .send({viewInstanceId,requestId:queued.requestId,observed:{...identity,mapContentId:'solar-radial:'+'c'.repeat(64)}});
    expect(wrong.status).toBe(409);
    expect(service.inspect(owner('profile-one'),queued.requestId).state).toBe('pending');
    const ack=await request(app).post('/presentation/ack').set(sameOrigin)
      .send({viewInstanceId,requestId:queued.requestId,observed:identity});
    expect(ack.status).toBe(200);
    expect(ack.body.request).toMatchObject({state:'displayed',observed:identity});
    expect((await request(app).get('/presentation/pending?viewInstanceId='+viewInstanceId)).body.request).toBeNull();
    const next=service.request(owner('profile-one'),identity,viewInstanceId,3);
    const rejected=await request(app).post('/presentation/reject').set(sameOrigin)
      .send({viewInstanceId,requestId:next.requestId,reason:'renderer_unavailable'});
    expect(rejected.status).toBe(200);
    expect(rejected.body.request).toMatchObject({state:'rejected',
      reason:'client_reported_renderer_unavailable',observed:null});
  });
  it('rejects user accounts and cross-origin writes before presence can be registered',async()=>{
    const user=setup('user');
    expect((await request(user.app).post('/presentation/presence').set(sameOrigin)
      .send({viewInstanceId,revision:0})).status).toBe(403);
    const developer=setup();
    const outside=await request(developer.app).post('/presentation/presence')
      .set({Host:'localhost',Origin:'https://outside.example','Sec-Fetch-Site':'cross-site'})
      .send({viewInstanceId,revision:0});
    expect(outside.status).toBe(403);
    expect(developer.service.inspectView(owner('profile-one')).available).toBe(false);
  });
  it('acknowledges only an exact bundle retained for the active developer view',async()=>{
    const readRetainedBundle=async(_owner:ReturnType<typeof owner>,bundleId:string)=>bundleId===identity.bundleId?{
      bundle:{bundleId,pfss:null,view:{mapContentId:identity.mapContentId,recipeId:identity.viewRecipeId}},
    }:null;
    const {app,service}=setup('developer','profile-one','session-one',readRetainedBundle);
    await request(app).post('/presentation/presence').set(sameOrigin).send({viewInstanceId,revision:9}).expect(200);
    const queued=service.requestImport(owner('profile-one'),viewInstanceId,9);
    const crossOrigin=await request(app).post('/presentation/import/ack')
      .set({Host:'localhost',Origin:'https://outside.example','Sec-Fetch-Site':'cross-site'})
      .send({viewInstanceId,requestId:queued.requestId,expectedRevision:9,observed:identity});
    expect(crossOrigin.status).toBe(403);
    const mismatch=await request(app).post('/presentation/import/ack').set(sameOrigin)
      .send({viewInstanceId,requestId:queued.requestId,expectedRevision:9,
        observed:{...identity,mapContentId:'solar-radial:'+'c'.repeat(64)}});
    expect(mismatch.status).toBe(409);
    const ack=await request(app).post('/presentation/import/ack').set(sameOrigin)
      .send({viewInstanceId,requestId:queued.requestId,expectedRevision:9,observed:identity});
    expect(ack.status).toBe(200);
    expect(ack.body.request).toMatchObject({state:'retained',bundleId:identity.bundleId,
      mapContentId:identity.mapContentId,pfssModelId:null,viewRecipeId:identity.viewRecipeId});
    expect(ack.body).toMatchObject({scientificAdmission:false,sourceIdentityAuthenticated:false});
  });
});
