import { expect, it } from "vitest";
import { temporalAdmissionRequestMetadataSchema as schema } from "../temporal-admission-request-schema";

const metadata = () => ({
  schema: "helix.environment_action.request.v1",
  ...Object.fromEntries([
    "action_request_id", "workflow_id", "action_authority_id", "environment_binding_id",
    "room_id", "source_id", "world_id", "subject_binding_id", "subject_native_id",
    "run_id", "turn_id", "provider_execution_id", "tool_call_id", "catalog_snapshot_id", "capability_id",
  ].map(key => [key, `test:${key}`])),
  capability_version: 1, action_kind: "execute_sequence", effect_class: "player_motion",
  workflow_mode: "long_running", requested_control_engine: "native_fabric",
  preconditions: [], postconditions: [{ condition_id: "test:stop", condition_kind: "stopped", required: true, parameters: {} }],
  idempotency_key: "test:unique", confirmation_state: "not_required", approval_ref: null,
  created_at: "2026-09-05T12:00:00Z", deadline_at: "2026-09-05T12:01:00Z",
  constraints: { max_duration_ms: 60000, max_distance_blocks: 10, max_block_mutations: 0,
    max_inventory_transfers: 0, manual_override_policy: "cancel", require_postcondition_verification: true,
    world_mutation_allowed: false, combat_allowed: false, host_access_allowed: false, automatic_replay_allowed: false },
  answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false,
});

it("accepts caller metadata without authenticated participant or executable content", () => {
  expect(schema.parse(metadata())).toEqual(metadata());
});

it.each(["participant_id", "profileId", "authenticatedMcpClientRef", "clientSessionRef", "arguments",
  "temporal_plan", "temporal_plan_canonical_json", "temporal_compilation_hash", "temporal_compilation_canonical_json"])(
  "rejects injected %s instead of silently stripping it", key => {
    const result = schema.safeParse({ ...metadata(), [key]: "injected" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ code: "unrecognized_keys", keys: [key] }));
  });

it.each(["answer_authority", "assistant_answer", "terminal_eligible", "raw_content_included"])(
  "does not promote %s", key => {
    expect(schema.safeParse({ ...metadata(), [key]: true }).success).toBe(false);
  });
