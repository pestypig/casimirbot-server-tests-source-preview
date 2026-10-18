import { describe, expect, it } from "vitest";
import {
  buildHelixEnvironmentReasoningRoleEvent,
  buildHelixEnvironmentReasoningRoleOutput,
  evaluateHelixEnvironmentReasoningRoleCurrentness,
  helixEnvironmentReasoningRoleSha256,
  reduceHelixEnvironmentReasoningRoleEvents,
  type HelixEnvironmentReasoningRoleEvent,
  type HelixEnvironmentReasoningRoleIdentity,
} from "@shared/helix-environment-reasoning-role";

const identity = (): HelixEnvironmentReasoningRoleIdentity => ({
  owner_profile_id: "profile:owner",
  room_id: "room:g6",
  participant_id: "participant:owner",
  environment_binding_id: "environment:g6",
  room_source_binding_id: "source-binding:g6",
  source_id: "source:g6",
  world_id: "minecraft:overworld",
  producer_epoch_ref: "epoch:g6",
  subject_binding_id: "subject:g6",
  subject_native_id: "player:g6",
  action_authority_id: "authority:g6",
  authority_policy_version: 7,
  authority_expires_at: "2026-08-24T00:00:00.000Z",
  goal_id: "goal:g6",
  goal_revision: 12,
  observation_revision: 42,
  principal_turn_id: "turn:g6",
});

const output = (id = "output:g6") =>
  buildHelixEnvironmentReasoningRoleOutput({
    roleOutputId: id,
    identity: identity(),
    producer: {
      selected_runtime_provider_id: "codex",
      supporting_provider_id: "terra",
      role_profile_id: "environment.prospective.shadow.v1",
      role_artifact_version: "v1",
    },
    inputEvidenceRefs: ["evidence:g6:42"],
    payload: {
      role_kind: "prospective_planning",
      proposal_id: `proposal:${id}`,
      objective_summary: "Prepare one bounded observation request.",
      capability_id: "com.casimirbot.minecraft.actor.status.read",
      capability_arguments: { target: "current_actor" },
      predicted_postconditions: [],
      assumptions: [],
      resource_keys: ["minecraft.player.observation"],
      confidence: 0.9,
      abstain: false,
    },
    createdAt: "2026-08-23T20:00:00.000Z",
    expiresAt: "2026-08-23T20:05:00.000Z",
  });

const event = (input: {
  id: string;
  sequence: number;
  previous: string | null;
  payload: Parameters<typeof buildHelixEnvironmentReasoningRoleEvent>[0]["payload"];
}) =>
  buildHelixEnvironmentReasoningRoleEvent({
    eventId: input.id,
    goalId: "goal:g6",
    sequence: input.sequence,
    previousEventHash: input.previous,
    payload: input.payload,
    occurredAt: "2026-08-23T20:00:00.000Z",
  });

describe("G6 environment reasoning role contract", () => {
  it.each([
    ["goal revision stale", { goal_revision: 13 }, "goal_revision_stale", ["goal_revision"]],
    ["goal revision future", { goal_revision: 11 }, "goal_revision_future", ["goal_revision"]],
    ["observation revision stale", { observation_revision: 43 }, "observation_revision_stale", ["observation_revision"]],
    ["observation revision future", { observation_revision: 41 }, "observation_revision_future", ["observation_revision"]],
    ["room identity drift", { room_id: "room:other" }, "identity_mismatch", ["room_id"]],
    ["world identity drift", { world_id: "minecraft:the_end" }, "identity_mismatch", ["world_id"]],
    ["connector epoch drift", { producer_epoch_ref: "epoch:rotated" }, "identity_mismatch", ["producer_epoch_ref"]],
    ["principal turn drift", { principal_turn_id: "turn:other" }, "identity_mismatch", ["principal_turn_id"]],
    ["authority identity drift", { action_authority_id: "authority:rotated" }, "authority_mismatch", ["action_authority_id"]],
    ["authority policy drift", { authority_policy_version: 8 }, "authority_mismatch", ["authority_policy_version"]],
  ] as const)(
    "rejects %s",
    (_name, currentPatch, reason, fields) => {
      const current = { ...identity(), ...currentPatch };
      expect(
        evaluateHelixEnvironmentReasoningRoleCurrentness({
          output: output(),
          currentIdentity: current,
          now: "2026-08-23T20:01:00.000Z",
        }),
      ).toEqual({ current: false, reason, mismatch_fields: fields });
    },
  );

  it("rejects delayed output and expired authority independently", () => {
    expect(
      evaluateHelixEnvironmentReasoningRoleCurrentness({
        output: output(),
        currentIdentity: identity(),
        now: "2026-08-23T20:06:00.000Z",
      }),
    ).toMatchObject({ current: false, reason: "role_output_expired" });

    expect(
      evaluateHelixEnvironmentReasoningRoleCurrentness({
        output: output(),
        currentIdentity: {
          ...identity(),
          authority_expires_at: "2026-08-23T20:00:30.000Z",
        },
        now: "2026-08-23T20:01:00.000Z",
      }),
    ).toMatchObject({ current: false, reason: "authority_expired" });
  });

  it("rejects a poisoned append-only event instead of repairing its hash", () => {
    const recorded = event({
      id: "event:g6:1",
      sequence: 1,
      previous: null,
      payload: { kind: "role_output_recorded", output: output() },
    });
    const poisoned = {
      ...recorded,
      event_hash: `sha256:${"f".repeat(64)}`,
    } as HelixEnvironmentReasoningRoleEvent;

    expect(() => reduceHelixEnvironmentReasoningRoleEvents([poisoned])).toThrowError(
      expect.objectContaining({ code: "reasoning_role_event_hash_invalid" }),
    );
    expect(poisoned.event_hash).toBe(`sha256:${"f".repeat(64)}`);
  });

  it("keeps contradictory adopted proposals non-executable after conflict rejection", () => {
    const left = output("output:g6:left");
    const right = output("output:g6:right");
    const events: HelixEnvironmentReasoningRoleEvent[] = [];
    const append = (payload: Parameters<typeof event>[0]["payload"]) => {
      const next = event({
        id: `event:g6:${events.length + 1}`,
        sequence: events.length + 1,
        previous: events.at(-1)?.event_hash ?? null,
        payload,
      });
      events.push(next);
      return next;
    };
    append({ kind: "role_output_recorded", output: left });
    append({ kind: "role_output_recorded", output: right });
    for (const candidate of [left, right]) {
      append({
        kind: "principal_disposition_recorded",
        role_output_id: candidate.role_output_id,
        disposition: "adopted",
        principal_turn_id: "turn:g6",
        adopted_capability_id: "com.casimirbot.minecraft.actor.status.read",
        adopted_capability_arguments_hash: helixEnvironmentReasoningRoleSha256({
          target: "current_actor",
        }),
        rationale_summary: "Candidate remains bounded but conflicts for one resource.",
      });
    }
    append({
      kind: "proposal_arbitrated",
      arbitration_id: "arbitration:g6:conflict",
      considered_role_output_ids: [left.role_output_id, right.role_output_id],
      selected_role_output_id: null,
      status: "conflict_rejected",
      reason: "Two current proposals compete for the same execution resource.",
    });

    const projection = reduceHelixEnvironmentReasoningRoleEvents(events);
    expect(projection.arbitrations).toEqual([
      expect.objectContaining({ status: "conflict_rejected", selected_role_output_id: null }),
    ]);
    expect(projection.execution_links).toEqual([]);
    expect(projection).toMatchObject({
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("does not allow an invalidated proposal to regain execution eligibility", () => {
    const candidate = output();
    const recorded = event({
      id: "event:g6:1",
      sequence: 1,
      previous: null,
      payload: { kind: "role_output_recorded", output: candidate },
    });
    const invalidated = event({
      id: "event:g6:2",
      sequence: 2,
      previous: recorded.event_hash,
      payload: {
        kind: "role_output_invalidated",
        role_output_id: candidate.role_output_id,
        reason: "observation_revision_advanced",
        superseding_goal_revision: 12,
        superseding_observation_revision: 43,
        evidence_refs: ["evidence:g6:43"],
      },
    });
    const adopted = event({
      id: "event:g6:3",
      sequence: 3,
      previous: invalidated.event_hash,
      payload: {
        kind: "principal_disposition_recorded",
        role_output_id: candidate.role_output_id,
        disposition: "adopted",
        principal_turn_id: "turn:g6",
        adopted_capability_id: "com.casimirbot.minecraft.actor.status.read",
        adopted_capability_arguments_hash: helixEnvironmentReasoningRoleSha256({
          target: "current_actor",
        }),
        rationale_summary: "A poisoned projection attempted to revive stale work.",
      },
    });
    const arbitration = event({
      id: "event:g6:4",
      sequence: 4,
      previous: adopted.event_hash,
      payload: {
        kind: "proposal_arbitrated",
        arbitration_id: "arbitration:g6:invalid",
        considered_role_output_ids: [candidate.role_output_id],
        selected_role_output_id: candidate.role_output_id,
        status: "selected_one",
        reason: "Poisoned projection attempted selection.",
      },
    });

    expect(() =>
      reduceHelixEnvironmentReasoningRoleEvents([
        recorded,
        invalidated,
        adopted,
        arbitration,
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "reasoning_role_arbitration_selection_invalid" }),
    );
  });
});
