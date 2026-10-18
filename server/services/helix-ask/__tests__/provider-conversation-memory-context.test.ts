import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HelixConversationMemoryPacket } from "@shared/helix-conversation-memory-packet";
import { resolveHelixAskConversationalReferent } from "../referent-resolution";
import {
  attachProviderConversationMemoryReferentContext,
  resolveProviderConversationMemoryEnvironmentEvidence,
} from "../provider-conversation-memory-context";
import { __resetHelixThreadLedgerStore } from "../../helix-thread/ledger";
import { persistHelixAskRuntimeTurnThreadCompletion } from
  "../runtime-turn-thread-persistence";

const packet = (
  overrides: Partial<HelixConversationMemoryPacket> = {},
): HelixConversationMemoryPacket => ({
  schema: "helix.conversation_memory_packet.v1",
  thread_id: "helix-ask:room:room:123",
  current_turn_id: "ask:turn-2",
  session_id: "helix-ask:room:room:123",
  memory_scope: "current_thread",
  selector_version: "v1",
  recent_user_goals: ["What is the player carrying?"],
  recent_assistant_answers: [
    "The player is carrying 3 minecraft:diamond and 5 minecraft:bread.",
  ],
  resolved_references: [
    {
      phrase: "previous answer",
      refers_to_turn_id: "ask:turn-1",
      refers_to_item_id: "ask:turn-1:runtime_terminal_answer",
      refers_to_artifact_ref: null,
      refers_to_kind: "prior_assistant_answer",
      confidence: "high",
      reason: "The follow-up binds to the latest prior thread answer.",
    },
  ],
  reusable_evidence_refs: [],
  forbidden_or_stale_refs: [],
  open_failures: [],
  pending_user_inputs: [],
  unresolved_task_frames: [],
  context_resume_frames: [],
  context_resume_frame_selection: null,
  latest_plan_summary: null,
  latest_answer_summary:
    "The player is carrying 3 minecraft:diamond and 5 minecraft:bread.",
  latest_failure_summary: null,
  continuity_summary: "latest answer: inventory",
  missing_or_uncertain: [],
  allowed_for_current_goal: true,
  allowed_reason: "The prompt explicitly references the previous answer.",
  allowed_use: "conversational_continuity",
  terminal_eligible: false,
  assistant_answer: false,
  raw_content_included: false,
  ...overrides,
});

describe("provider conversation memory referent context", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
  });

  it("projects the authoritative thread answer into bounded provider follow-up context", () => {
    const body = attachProviderConversationMemoryReferentContext({
      body: {
        question:
          "What did the immediately preceding answer say the player was carrying?",
        sessionId: "helix-ask:room:room:123",
      },
      packet: packet(),
    });
    const resolution = resolveHelixAskConversationalReferent(body);

    expect(resolution.resolvedText).toContain("3 minecraft:diamond");
    expect(resolution.resolvedText).toContain("5 minecraft:bread");
    expect(resolution.trace.resolution_confidence).toBe("high");
    expect(resolution.trace.resolved_source_ref).toBe(
      "helix.thread.answer:ask:turn-1",
    );
  });

  it("does not inject a blocked or unrelated memory packet", () => {
    const body = { question: "Start over with a different task." };
    expect(
      attachProviderConversationMemoryReferentContext({
        body,
        packet: packet({
          allowed_for_current_goal: false,
          allowed_use: "blocked",
          latest_answer_summary: null,
        }),
      }),
    ).toBe(body);
  });

  it("preserves a fresher client-provided chat referent", () => {
    const body = {
      question: "What did the previous answer say?",
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer: {
            text: "The visible client answer is newer.",
          },
        },
      },
    };
    expect(
      attachProviderConversationMemoryReferentContext({
        body,
        packet: packet(),
      }),
    ).toBe(body);
  });

  it("resolves an exact selected environment locator through the durable broker boundary", async () => {
    const threadId =
      "helix-ask:room:shared_realtime_room:environment-memory";
    const artifactRef = "ask:turn-1:environment:reachability";
    persistHelixAskRuntimeTurnThreadCompletion({
      threadId,
      turnId: "ask:turn-1",
      sessionId: threadId,
      promptText: "Check the route.",
      terminalText: "The route is visible but not traversable.",
      finalStatus: "final_answer",
      selectedObservationRefs: [artifactRef],
      selectedEnvironmentProbeLocators: [
        {
          artifactRef,
          probeRequestRef: "environment_probe_request:reachability",
          capabilityId: "com.casimirbot.minecraft.reachability.check",
        },
      ],
    });
    const readEvidence = vi.fn(async () => ({
      schema: "helix.environment_connector.prior_probe_evidence.v1" as const,
      probe_request_ref: "environment_probe_request:reachability",
      prior_turn_id: "ask:turn-1",
      room_id: "shared_realtime_room:environment-memory",
      source_id: "source:minecraft",
      world_id: "minecraft:world:test",
      environment_binding_ref: "environment_connector_binding:test",
      catalog_snapshot_ref: "environment_connector_catalog:test",
      adapter_profile_id: "minecraft.fabric_mod.v1",
      adapter_profile_version: 1,
      adapter_contract_hash: "sha256:adapter",
      manifest_hash: "sha256:manifest",
      producer_epoch_ref: "producer_epoch:test",
      capability_id: "com.casimirbot.minecraft.reachability.check",
      capability_version: 1,
      semantic_arguments: { target: "current_focus" },
      observation: {
        schema: "helix.environment_connector.probe_observation.v1",
        probe_request_ref: "environment_probe_request:reachability",
        capability_id: "com.casimirbot.minecraft.reachability.check",
        outcome: "succeeded",
        observed_at: new Date().toISOString(),
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
        summary: "The route is blocked by a one-block rise.",
        result: { reachable: false },
        failure: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      evidence_age_ms: 500,
      content_role:
        "prior_environment_probe_evidence_not_assistant_answer" as const,
      reentry_required: true as const,
      answer_authority: false as const,
      assistant_answer: false as const,
      terminal_eligible: false as const,
      raw_content_included: false as const,
    }));

    const resolution =
      await resolveProviderConversationMemoryEnvironmentEvidence({
        packet: packet({
          thread_id: threadId,
          current_turn_id: "ask:turn-2",
          session_id: threadId,
          reusable_evidence_refs: [artifactRef],
          allowed_use: "reuse_prior_evidence_refs",
        }),
        currentTurnId: "ask:turn-2",
        readEvidence,
      });

    expect(readEvidence).toHaveBeenCalledWith({
      requestId: "environment_probe_request:reachability",
      expectedPriorTurnId: "ask:turn-1",
      expectedRoomId: "shared_realtime_room:environment-memory",
      expectedCapabilityId:
        "com.casimirbot.minecraft.reachability.check",
      maxAgeMs: undefined,
    });
    expect(resolution.resolved).toHaveLength(1);
    expect(resolution.resolved[0]).toMatchObject({
      prior_artifact_ref: artifactRef,
      evidence: {
        room_id: "shared_realtime_room:environment-memory",
        capability_id:
          "com.casimirbot.minecraft.reachability.check",
      },
    });
  });

  it("does not call the broker for another room or an incomplete thread locator", async () => {
    const readEvidence = vi.fn();
    const resolution =
      await resolveProviderConversationMemoryEnvironmentEvidence({
        packet: packet({
          thread_id: "helix-ask:room:shared_realtime_room:other",
          current_turn_id: "ask:turn-2",
          reusable_evidence_refs: ["artifact:missing"],
          allowed_use: "reuse_prior_evidence_refs",
        }),
        currentTurnId: "ask:turn-2",
        readEvidence,
      });

    expect(readEvidence).not.toHaveBeenCalled();
    expect(resolution.resolved).toEqual([]);
    expect(resolution.rejected).toEqual([
      {
        artifact_ref: "artifact:missing",
        reason: "thread_locator_missing",
      },
    ]);
  });
});
