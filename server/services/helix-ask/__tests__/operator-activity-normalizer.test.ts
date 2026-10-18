import { describe, expect, it } from "vitest";
import type { HelixCapabilityLifecycleLedger } from "@shared/helix-capability-lifecycle-ledger";
import {
  HELIX_ENVIRONMENT_EVENT_SCHEMA,
  type HelixEnvironmentEvent,
} from "@shared/helix-environment-event-stream";
import {
  normalizeAgentRunEventActivity,
  normalizeCapabilityLifecycleActivity,
  normalizeEnvironmentEventActivity,
} from "../operator-activity-normalizer";

const scope = {
  profileRef: "profile:owner",
  nodeRef: "node:installed",
  oauthClientRef: "oauth_client:codex",
  clientSessionRef: "client_session:one",
  providerThreadRef: "provider_thread:principal",
  providerThreadEpoch: "provider_thread_epoch:one",
  runId: "run:one",
  environmentBindingRef: "environment_binding:minecraft",
};

const ledger: HelixCapabilityLifecycleLedger = {
  schema: "helix.capability_lifecycle_ledger.v1",
  turn_id: "turn:one",
  capability_plan_id: "capability_plan:one",
  capability_result_id: "capability_plan:one",
  stages: [
    { stage: "planned", status: "succeeded", refs: [], reason: "planned" },
    { stage: "admitted", status: "succeeded", refs: [], reason: "admitted" },
    { stage: "dispatched", status: "succeeded", refs: [], reason: "dispatched" },
    {
      stage: "adapter_acknowledged",
      status: "succeeded",
      refs: ["Bearer secret-value"],
      reason: "password=private-value",
    },
    { stage: "result_observed", status: "succeeded", refs: [], reason: "observed" },
    { stage: "result_validated", status: "succeeded", refs: [], reason: "validated" },
    { stage: "reentered_solver", status: "succeeded", refs: [], reason: "reentered" },
    { stage: "terminal_considered", status: "succeeded", refs: [], reason: "considered" },
  ],
  failure_codes: [],
  ok: true,
  assistant_answer: false,
  raw_content_included: false,
};

const environmentEvent = (eventType: string): HelixEnvironmentEvent => ({
  schema: HELIX_ENVIRONMENT_EVENT_SCHEMA,
  event_id: `environment_event:${eventType.replaceAll(".", "-")}`,
  sequence: 4,
  event_type: eventType,
  domain: "minecraft",
  domain_adapter: "minecraft.fabric",
  room_id: "room:one",
  source_id: "source:fabric",
  world_id: "world:one",
  producer_epoch_ref: "producer_epoch:one",
  producer_plane: "player_embodiment",
  subject_ref: "subject:player",
  workflow_ref: "workflow:one",
  summary: "password=must-not-project",
  attributes: { token: "must-not-project" },
  evidence_refs: ["evidence:environment"],
  occurred_at: "2026-09-01T20:00:00.000Z",
  observed_at: "2026-09-01T20:00:01.000Z",
  provenance: "measured",
  raw_event_included: false,
  content_role: "environment_event_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

describe("Helix operator activity normalizer", () => {
  it("normalizes every capability stage without projecting reasons or secret-shaped refs", () => {
    const events = normalizeCapabilityLifecycleActivity({
      ledger,
      scope,
      projectionSequenceStart: 10,
      occurredAt: "2026-09-01T20:00:00.000Z",
      observedAt: "2026-09-01T20:00:01.000Z",
    });
    expect(events).toHaveLength(8);
    expect(events.map((entry) => entry.projection_sequence)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(JSON.stringify(events)).not.toContain("secret-value");
    expect(JSON.stringify(events)).not.toContain("private-value");
    expect(events[3].evidence_refs[0]).toMatch(/^operator_activity_ref_hash:/);
  });

  it("does not turn terminal consideration into completion authority", () => {
    const events = normalizeCapabilityLifecycleActivity({
      ledger,
      scope,
      projectionSequenceStart: 0,
      occurredAt: "2026-09-01T20:00:00.000Z",
      observedAt: "2026-09-01T20:00:01.000Z",
    });
    const terminal = events.at(-1)!;
    expect(terminal.lifecycle_stage).toBe("terminal_considered");
    expect(terminal.event_kind).toBe("status");
    expect(terminal.terminal_eligible).toBe(false);
    expect(terminal.assistant_answer).toBe(false);
  });

  it("creates deterministic identities independent of page sequence", () => {
    const common = {
      ledger,
      scope,
      occurredAt: "2026-09-01T20:00:00.000Z",
      observedAt: "2026-09-01T20:00:01.000Z",
    };
    const first = normalizeCapabilityLifecycleActivity({
      ...common,
      projectionSequenceStart: 0,
    });
    const second = normalizeCapabilityLifecycleActivity({
      ...common,
      projectionSequenceStart: 40,
    });
    expect(second.map((entry) => entry.activity_event_id)).toEqual(
      first.map((entry) => entry.activity_event_id),
    );
  });

  it("normalizes admitted environment identity without raw summary or attributes", () => {
    const normalized = normalizeEnvironmentEventActivity({
      event: environmentEvent("workflow.succeeded"),
      scope,
      projectionSequence: 18,
    });
    expect(normalized.event_kind).toBe("completion");
    expect(normalized.outcome).toBe("succeeded");
    expect(normalized.room_ref).toBe("room:one");
    expect(normalized.world_ref).toBe("world:one");
    expect(JSON.stringify(normalized)).not.toContain("must-not-project");
    expect(normalized.answer_authority).toBe(false);
  });

  it("fails closed when provider thread identity lacks its epoch", () => {
    expect(() =>
      normalizeEnvironmentEventActivity({
        event: environmentEvent("workflow.progress"),
        scope: { ...scope, providerThreadEpoch: null },
        projectionSequence: 0,
      }),
    ).toThrow();
  });

  it("projects Agent API lifecycle without payload, prompt, or terminal authority", () => {
    const normalized = normalizeAgentRunEventActivity({
      event: {
        schema: "helix.agent_run.event.v1",
        event_id: "agent_event:one",
        run_id: "run:one",
        seq: 3,
        event_type: "run_completed",
        payload: {
          prompt: "must-not-project",
          provider_result: "hidden-provider-content",
        },
        created_at: "2026-09-01T20:00:00.000Z",
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      scope,
      projectionSequence: 22,
      observedAt: "2026-09-01T20:00:01.000Z",
    });
    expect(normalized.event_kind).toBe("completion");
    expect(normalized.outcome).toBe("succeeded");
    expect(normalized.lifecycle_stage).toBe("agent_run_observed");
    expect(normalized.provider_thread_ref).toBe(scope.providerThreadRef);
    expect(JSON.stringify(normalized)).not.toContain("must-not-project");
    expect(JSON.stringify(normalized)).not.toContain("hidden-provider-content");
    expect(normalized.answer_authority).toBe(false);
    expect(normalized.terminal_eligible).toBe(false);
  });
});
