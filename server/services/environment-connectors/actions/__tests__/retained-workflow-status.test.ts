import { describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { readRetainedEnvironmentWorkflowResult } from '../retained-workflow-status';

const input = {roomId:'room',profileId:'profile',workflowId:'workflow',requestingParticipantId:'participant'};
const context = {...input,participantId:'participant',actionAuthorityId:'authority',environmentBindingId:'environment'};
async function fixture() {
  const db = newDb().adapters.createPg();
  const pool = new db.Pool();
  await pool.query(`CREATE TABLE helix_environment_action_requests (
    action_request_id text, status text, room_id text, workflow_id text, participant_id text,
    action_authority_id text, environment_binding_id text, created_at timestamptz)`);
  const insert = (id:string,status:string,participant='participant') => pool.query(
    `INSERT INTO helix_environment_action_requests VALUES ($1,$2,'room','workflow',$3,'authority','environment',now())`,[id,status,participant]);
  await insert('request:1','succeeded');
  const observation = {action_request_ref:'request:1',workflow_ref:'workflow',outcome:'succeeded',
    observed_at:'2026-09-08T10:00:00.000Z',provenance_valid:true,eligible_for_current_turn_reentry:true,
    result:{controls_released:true}} as never;
  const deps = {resolveContext:vi.fn(async()=>context),readDatabase:vi.fn(async()=>pool),
    readObservation:vi.fn(async()=>observation)};
  return {pool,insert,observation,deps};
}
describe('retained workflow status',()=>{
  it.each([
    ['canceled','manual_override'], ['canceled','request_canceled'],
    ['timed_out','workflow_timeout'], ['failed','postcondition_failed'],
    ['failed','precondition_failed'], ['emergency_stopped','emergency_stopped'],
    ['connector_offline','connector_offline'], ['authority_stale','permission_revoked'],
    ['authority_stale','authority_stale'],
  ])('preserves canonical %s lifecycle outcome %s',async(status,outcome)=>{
    const f=await fixture();
    await f.pool.query(`UPDATE helix_environment_action_requests SET status=$1`,[status]);
    const retained={...f.observation as object,outcome} as never;
    f.deps.readObservation.mockResolvedValueOnce(retained);
    expect(await readRetainedEnvironmentWorkflowResult(input,f.deps)).toBe(retained);
    await f.pool.end();
  });
  it('preserves historical evidence and isolates another participant',async()=>{
    const f=await fixture(); await f.insert('request:2','running','other');
    expect(await readRetainedEnvironmentWorkflowResult(input,f.deps)).toBe(f.observation);
    expect(f.deps.resolveContext).toHaveBeenCalledTimes(2);
  });
  it('returns a verified terminal receipt after its same-turn reentry window closes',async()=>{
    const f=await fixture();
    const historical={...f.observation as object,eligible_for_current_turn_reentry:false} as never;
    f.deps.readObservation.mockResolvedValueOnce(historical);
    expect(await readRetainedEnvironmentWorkflowResult(input,f.deps)).toBe(historical);
  });
  it('does not substitute a completed root for its queued successor',async()=>{
    const f=await fixture(); await f.insert('request:2','admitted');
    expect(await readRetainedEnvironmentWorkflowResult(input,f.deps)).toBeNull();
    expect(f.deps.readObservation).not.toHaveBeenCalled();
  });
  it('rejects revocation during the result read',async()=>{
    const f=await fixture(); f.deps.resolveContext.mockResolvedValueOnce(context).mockRejectedValueOnce(new Error('authority revoked'));
    await expect(readRetainedEnvironmentWorkflowResult(input,f.deps)).rejects.toThrow('authority revoked');
  });
  it('does not infer rolling-chain order from caller timestamps',async()=>{
    const f=await fixture(); await f.insert('request:0','succeeded');
    await f.pool.query(`UPDATE helix_environment_action_requests SET created_at='2020-01-01' WHERE action_request_id='request:0'`);
    expect(await readRetainedEnvironmentWorkflowResult(input,f.deps)).toBeNull();
  });
  it('rejects a newer request arriving during the result read',async()=>{
    const f=await fixture(); f.deps.readObservation.mockImplementationOnce(async()=>{
      await f.insert('request:2','admitted'); return f.observation;
    });
    expect(await readRetainedEnvironmentWorkflowResult(input,f.deps)).toBeNull();
  });
  it.each([{provenance_valid:false},{workflow_ref:'foreign'},
    {action_request_ref:'foreign'},{outcome:'failed'}])('rejects invalid result %j',async patch=>{
    const f=await fixture(); f.deps.readObservation.mockResolvedValueOnce({...f.observation as object,...patch} as never);
    expect(await readRetainedEnvironmentWorkflowResult(input,f.deps)).toBeNull();
  });
});
