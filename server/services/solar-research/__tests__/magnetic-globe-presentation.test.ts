import {describe,expect,it} from 'vitest';
import {MagneticGlobePresentationError,MagneticGlobePresentationService} from '../magnetic-globe-presentation';

const owner={tenantId:'desktop:one',accountProfileId:'one'};
const other={tenantId:'desktop:two',accountProfileId:'two'};
const view='11111111-1111-4111-8111-111111111111';
const identity={bundleId:`solar-magnetic-bundle:${'a'.repeat(64)}`,
  mapContentId:`solar-radial:${'b'.repeat(64)}`,pfssModelId:`solar-pfss:${'c'.repeat(64)}`,
  viewRecipeId:`solar-magnetic-view:${'d'.repeat(64)}`};

describe('owner-bound magnetic globe presentation',()=>{
  it('requires a live exact view and reports the exact observed bundle/map/model/view',()=>{
    let clock=1000;const service=new MagneticGlobePresentationService(()=>clock);
    expect(()=>service.request(owner,identity,view,0)).toThrowError('magnetic_globe_not_open');
    service.observe(owner,'session-one',view,0);
    const request=service.request(owner,identity,view,0);
    expect(service.pending(owner,'session-one',view)?.requestId).toBe(request.requestId);
    expect(service.pending(other,'session-one',view)).toBeNull();
    expect(()=>service.acknowledge(other,'session-one',request.requestId,identity))
      .toThrowError('magnetic_globe_request_stale');
    expect(()=>service.acknowledge(owner,'session-one',request.requestId,{...identity,viewRecipeId:`solar-magnetic-view:${'e'.repeat(64)}`}))
      .toThrowError('magnetic_globe_identity_mismatch');
    clock+=100;
    expect(service.acknowledge(owner,'session-one',request.requestId,identity)).toMatchObject({
      state:'displayed',observed:identity,requestId:request.requestId});
    expect(service.inspectView(owner)).toMatchObject({available:true,revision:1});
  });
  it('rejects stale view revisions, session switches, expiry and closed views',()=>{
    let clock=1000;const service=new MagneticGlobePresentationService(()=>clock);
    service.observe(owner,'session-one',view,2);
    expect(()=>service.request(owner,identity,view,1)).toThrowError('magnetic_globe_revision_changed');
    const changed=service.request(owner,identity,view,2);
    service.observe(owner,'session-two',view,2);
    expect(service.inspect(owner,changed.requestId)).toMatchObject({state:'rejected',reason:'view_changed'});
    const expiring=service.request(owner,identity,view,2);
    clock+=30000;
    expect(service.pending(owner,'session-two',view)).toBeNull();
    expect(service.inspect(owner,expiring.requestId)).toMatchObject({state:'rejected',reason:'expired'});
    clock+=16000;
    expect(service.inspectView(owner).available).toBe(false);
    expect(()=>service.request(owner,identity,view,2)).toThrowError('magnetic_globe_not_open');
    service.observe(owner,'session-two',view,3);
    const closing=service.request(owner,identity,view,3);
    service.clear(owner,'session-two',view);
    expect(service.inspect(owner,closing.requestId)).toMatchObject({state:'rejected',reason:'view_closed'});
  });
  it('does not confuse malformed identity with a missing view',()=>{
    const service=new MagneticGlobePresentationService();
    expect(()=>service.request(owner,{...identity,bundleId:'not-an-id'},view,0))
      .toThrowError(MagneticGlobePresentationError);
    expect(()=>service.observe(owner,'session','not-a-view',0)).toThrowError('magnetic_globe_presence_invalid');
  });
  it('records renderer-reported rejection without promoting it to an observed display',()=>{
    const service=new MagneticGlobePresentationService();
    service.observe(owner,'session-one',view,0);
    const request=service.request(owner,identity,view,0);
    expect(()=>service.reject(other,'session-one',view,request.requestId,'renderer_unavailable'))
      .toThrowError('magnetic_globe_request_stale');
    expect(service.reject(owner,'session-one',view,request.requestId,'renderer_unavailable'))
      .toMatchObject({state:'rejected',reason:'client_reported_renderer_unavailable',observed:null});
    expect(service.pending(owner,'session-one',view)).toBeNull();
  });
  it('requires the same live owner view and revision before retaining a user-selected bundle',()=>{
    let clock=1000;const service=new MagneticGlobePresentationService(()=>clock);
    expect(()=>service.requestImport(owner,view,0)).toThrowError('magnetic_globe_not_open');
    service.observe(owner,'session-one',view,4);
    expect(()=>service.requestImport(owner,view,3)).toThrowError('magnetic_globe_revision_changed');
    const request=service.requestImport(owner,view,4);
    expect(service.pendingImport(owner,'session-one',view)).toMatchObject({
      requestId:request.requestId,state:'pending',expectedRevision:4,
    });
    expect(service.pendingImport(other,'session-one',view)).toBeNull();
    expect(()=>service.acknowledgeImport(other,'session-one',request.requestId,view,4,identity))
      .toThrowError('magnetic_globe_import_stale');
    expect(()=>service.acknowledgeImport(owner,'session-two',request.requestId,view,4,identity))
      .toThrowError('magnetic_globe_import_stale');
    expect(()=>service.acknowledgeImport(owner,'session-one',request.requestId,view,4,
      {...identity,mapContentId:'forged'})).toThrowError('magnetic_globe_import_identity_invalid');
    clock+=100;
    expect(service.acknowledgeImport(owner,'session-one',request.requestId,view,4,identity)).toMatchObject({
      state:'retained',bundleId:identity.bundleId,mapContentId:identity.mapContentId,
      pfssModelId:identity.pfssModelId,viewRecipeId:identity.viewRecipeId,
    });
    expect(service.inspectImport(owner,request.requestId).state).toBe('retained');
    expect(service.inspectView(owner)).toMatchObject({available:true,revision:4});
    expect(()=>service.request(owner,identity,view,4)).not.toThrow();
  });
  it('rejects an import request after view changes, cancellation or expiry',()=>{
    let clock=1000;const service=new MagneticGlobePresentationService(()=>clock);
    service.observe(owner,'session-one',view,1);
    const changed=service.requestImport(owner,view,1);
    service.observe(owner,'session-one',view,2);
    expect(service.inspectImport(owner,changed.requestId)).toMatchObject({state:'rejected',reason:'view_changed'});
    const cancelled=service.requestImport(owner,view,2);
    expect(service.rejectImport(owner,'session-one',view,cancelled.requestId,'cancelled'))
      .toMatchObject({state:'rejected',reason:'cancelled'});
    const expiring=service.requestImport(owner,view,2);
    clock+=5*60_000;
    expect(service.pendingImport(owner,'session-one',view)).toBeNull();
    expect(service.inspectImport(owner,expiring.requestId)).toMatchObject({state:'rejected',reason:'expired'});
  });
});
