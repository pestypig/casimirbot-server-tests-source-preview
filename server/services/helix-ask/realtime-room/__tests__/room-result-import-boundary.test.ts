import { describe, expect, it, vi } from 'vitest';

// The manifest needs protocol identifiers only. Loading it must not import
// account/room services, which can cycle back through the provider registry.
vi.mock('../mission-result-ask', () => {
  throw new Error('gateway_manifest_loaded_room_service');
});

describe('room-result gateway import boundary', () => {
  it('loads its manifest without evaluating the room service and preserves denial', async () => {
    const { roomMissionResultManifest, executeRoomMissionResultRead } = await import('../../workstation-tool-gateway/room-mission-result');
    expect(roomMissionResultManifest).toMatchObject({
      capability_id: 'room.mission_result.read_selected',
      output_observation_schema: 'helix.room_mission_result_observation.v1',
      mutating: false, terminal_eligible: false,
    });
    await expect(executeRoomMissionResultRead({ args: {}, turnId: 'unadmitted' })).resolves.toMatchObject({
      ok: false, status: 'blocked', error: 'room_result_source_not_admitted',
      observation: { assistant_answer: false, terminal_eligible: false },
    });
  });
});
