import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as Array<{ sequence: number; hash: string }>,
  transactions: 0,
  failSave: false,
  requestStatus: "running",
  statusUpdates: 0,
  options: undefined as unknown,
}));
vi.mock("../../../helix-ask/realtime-room/room-store/database", () => ({
  readSharedRealtimeRoomDatabase: vi.fn(),
  withSharedRealtimeRoomTransaction: async (run: (db: unknown) => Promise<unknown>, options: unknown) => {
    state.transactions++;
    state.options = options;
    const result = await run({ query: async (sql: string, args: unknown[]) => {
      if (sql.includes("FROM helix_environment_action_requests")) return { rows: args[1] === "authority:test"
        ? [{ workflow_id: "workflow:test", status: state.requestStatus, connector_manifest_id: "manifest:test" }] : [] };
      if (sql.includes("SELECT event_hash")) return { rows: state.events.filter(e => e.sequence === args[1]).map(e => ({ event_hash: e.hash })) };
      if (sql.includes("SELECT sequence")) return { rows: state.events.length ? [{ sequence: state.events.at(-1)!.sequence }] : [] };
      if (sql.includes("FROM helix_environment_action_connector_manifests")) return { rows: [{ manifest_id: "manifest:test", producer_epoch_ref: "epoch:test" }] };
      if (sql.includes("INSERT INTO helix_environment_action_workflow_events")) {
        state.events.push({ sequence: args[3] as number, hash: args[7] as string });
        return { rows: [] };
      }
      if (sql.includes("UPDATE helix_environment_action_requests")) {
        state.statusUpdates++;
        return { rows: [] };
      }
      throw new Error(`Unexpected fixture query: ${sql.slice(0, 90)}`);
    } });
    // Model commit-before-snapshot failure: a retry must verify exact hashes.
    if (state.failSave) throw new Error("snapshot unavailable");
    return result;
  },
}));
import { submitEnvironmentActionWorkflowEvent, submitEnvironmentActionWorkflowEvents } from "../action-broker";

const event = (sequence: number) => ({
  schema: "helix.environment_action.workflow_event.v1", event_id: `event:${sequence}`,
  action_request_id: "request:test", workflow_id: "workflow:test", sequence,
  event_type: sequence ? "workflow.progress" : "workflow.started", workflow_state: "running",
  progress_fraction: null, summary: "Fixture progress", control_engine: "native_fabric",
  measurements: {}, evidence_refs: [], manual_override_detected: false, controls_released: false,
  created_at: "2026-09-07T21:00:00Z", content_role: "environment_action_event_not_assistant_answer",
  answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false,
});
const claim = { authorityId: "authority:test" } as never;
beforeEach(() => { state.events = []; state.transactions = 0; state.failSave = false; state.requestStatus = "running"; state.statusUpdates = 0; });

it("retains every ordered event with one strict durability boundary", async () => {
  const result = await submitEnvironmentActionWorkflowEvents({ claim, events: [event(0), event(1), event(2)] });
  expect(result.map(r => r.event.sequence)).toEqual([0, 1, 2]);
  expect(state.transactions).toBe(1);
  expect(state.options).toMatchObject({ requireLocalSnapshot: true });
  expect(state.events).toHaveLength(3);
});

it("keeps the single-event API and exact replay behavior", async () => {
  expect((await submitEnvironmentActionWorkflowEvent({ claim, event: event(0) })).replayed).toBe(false);
  const result = await submitEnvironmentActionWorkflowEvents({ claim, events: [event(0), event(1)] });
  expect(result.map(r => r.replayed)).toEqual([true, false]);
});

it("does not acknowledge snapshot failure and safely retries its committed prefix", async () => {
  state.failSave = true;
  await expect(submitEnvironmentActionWorkflowEvents({ claim, events: [event(0), event(1)] })).rejects.toThrow("snapshot unavailable");
  state.failSave = false;
  expect((await submitEnvironmentActionWorkflowEvents({ claim, events: [event(0), event(1)] })).every(r => r.replayed)).toBe(true);
  expect(state.events).toHaveLength(2);
});

it("rejects conflicting replay rather than rewriting evidence", async () => {
  await submitEnvironmentActionWorkflowEvents({ claim, events: [event(0)] });
  await expect(submitEnvironmentActionWorkflowEvents({ claim, events: [{ ...event(0), summary: "Changed" }, event(1)] })).rejects.toMatchObject({ code: "action_event_conflict" });
  expect(state.events).toHaveLength(1);
});

it.each([[], Array.from({ length: 33 }, (_, i) => event(i)), [event(0), event(2)],
  [event(0), { ...event(1), workflow_id: "workflow:other" }],
  [event(0), { ...event(1), answer_authority: true }],
].map(events => ({ events })))("rejects malformed, mixed or unbounded batches before mutation", async ({ events }) => {
  await expect(submitEnvironmentActionWorkflowEvents({ claim, events })).rejects.toMatchObject({ code: "action_event_invalid" });
  expect(state.transactions).toBe(0);
});

it("retains exact authority ownership checks", async () => {
  await expect(submitEnvironmentActionWorkflowEvents({ claim: { authorityId: "authority:other" } as never, events: [event(0)] })).rejects.toMatchObject({ code: "action_request_not_found" });
  expect(state.events).toHaveLength(0);
});

it("retains late evidence after timeout without reviving the request", async () => {
  state.requestStatus = "timed_out";
  const result = await submitEnvironmentActionWorkflowEvents({ claim, events: [event(0), event(1)] });
  expect(result.map(r => r.replayed)).toEqual([false, false]);
  expect(state.events).toHaveLength(2);
  expect(state.statusUpdates).toBe(0);
  expect((await submitEnvironmentActionWorkflowEvents({ claim, events: [event(0), event(1)] })).every(r => r.replayed)).toBe(true);
  expect(state.statusUpdates).toBe(0);
});
