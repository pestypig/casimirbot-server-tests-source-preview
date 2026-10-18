import { describe, expect, it } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { buildEnvironmentInteractionReceipt } from "../ask-turn-admission";
import type { AuthenticatedEnvironmentInteraction } from "../interaction-service";

const interaction = {
  credentialId: "credential:test",
  actionAuthorityId: "authority:test",
  environmentBindingId: "environment:test",
  ownerProfileId: "profile:owner",
  participantProfileId: "profile:player",
  roomId: "room:test",
  participantId: "participant:player",
  subjectBindingId: "subject:test",
  subjectNativeId: "player-uuid",
  sourceId: "source:test",
  worldId: "world:test",
  connectorInstallationId: "connector:test",
  producerEpochRef: "epoch:test",
  scopes: ["ask.submit"],
  accountPolicy: buildHelixAccountCapabilityPolicy("developer"),
  accountContext: {} as AuthenticatedEnvironmentInteraction["accountContext"],
} satisfies AuthenticatedEnvironmentInteraction;

const request = {
  schema: "helix.environment_interaction.request.v1" as const,
  request_id: "request:test",
  idempotency_key: "idempotency:test",
  prompt: "What is around me?",
  connector_installation_id: "connector:test",
  subject_native_id: "player-uuid",
  world_id: "world:test",
};

describe("environment interaction terminal projection", () => {
  it("projects a terminal-authorized Codex answer", () => {
    expect(buildEnvironmentInteractionReceipt({
      interaction,
      request,
      idempotencyReplayed: false,
      payload: {
        turn_id: "turn:test",
        final_status: "final_answer",
        terminal_artifact_kind: "model_synthesized_answer",
        terminal_authority_ok: true,
        selected_final_answer: "You are beside a river.",
      },
    })).toMatchObject({
      ok: true,
      terminal_authority_ok: true,
      text: "You are beside a river.",
      participant_id: "participant:player",
    });
  });

  it("does not project an unsupported candidate as an answer", () => {
    expect(buildEnvironmentInteractionReceipt({
      interaction,
      request,
      idempotencyReplayed: false,
      payload: {
        turn_id: "turn:test",
        final_status: "final_answer",
        terminal_artifact_kind: "model_synthesized_answer",
        selected_final_answer: "Unverified answer",
      },
    })).toMatchObject({
      ok: false,
      terminal_authority_ok: false,
      text: null,
      error: "terminal_authority_unverified",
    });
  });

  it("recognizes the canonical Helix terminal-answer authority record", () => {
    expect(buildEnvironmentInteractionReceipt({
      interaction,
      request,
      idempotencyReplayed: false,
      payload: {
        final_status: "final_answer",
        terminal_artifact_kind: "provider_terminal_answer",
        selected_final_answer: "You are healthy and in the overworld.",
        terminal_answer_authority: {
          schema: "helix.terminal_authority.v1",
          server_authoritative: true,
          terminal_eligible: true,
          terminal_kind: "answer",
        },
      },
    })).toMatchObject({
      ok: true,
      terminal_authority_ok: true,
      text: "You are healthy and in the overworld.",
    });
  });

  it("does not accept a canonical authority record that is explicitly ineligible", () => {
    expect(buildEnvironmentInteractionReceipt({
      interaction,
      request,
      idempotencyReplayed: false,
      payload: {
        final_status: "final_answer",
        terminal_artifact_kind: "provider_terminal_answer",
        selected_final_answer: "This must remain hidden.",
        terminal_answer_authority: {
          schema: "helix.terminal_authority.v1",
          server_authoritative: true,
          terminal_eligible: false,
        },
      },
    })).toMatchObject({
      ok: false,
      terminal_authority_ok: false,
      text: null,
      error: "terminal_authority_unverified",
    });
  });

  it("preserves an actionable typed failure", () => {
    expect(buildEnvironmentInteractionReceipt({
      interaction,
      request,
      idempotencyReplayed: false,
      payload: {
        turn_id: "turn:test",
        final_status: "final_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_failure_text: "The connector epoch is stale; pair again.",
        terminal_error_code: "interaction_binding_stale",
        retryable: true,
      },
    })).toMatchObject({
      ok: true,
      terminal_authority_ok: true,
      text: "The connector epoch is stale; pair again.",
      error: "interaction_binding_stale",
      retryable: true,
    });
  });

  it("projects an exact server hard-capacity rejection as an actionable failure", () => {
    expect(buildEnvironmentInteractionReceipt({
      interaction,
      request,
      idempotencyReplayed: false,
      payload: {
        ok: false,
        response_type: "capacity_rejected",
        final_status: "final_failure",
        terminal_artifact_kind: "ask_turn_admission",
        final_answer_source: "ask_turn_admission",
        route_reason_code: "ask_turn_admission / memory_hard_pressure",
        route: "ask_turn_admission / rejected",
        text: "This freeform field is not trusted.",
        answer: "Nor is this one.",
        ask_turn_admission: {
          schema: "helix.ask_turn_admission.v1",
          status: "rejected",
          reason: "memory_hard_pressure",
          retry_after_ms: 1500,
        },
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    })).toMatchObject({
      ok: true,
      terminal_authority_ok: true,
      terminal_artifact_kind: "ask_turn_admission",
      text: "Ask turn rejected: memory_hard_pressure.",
      error: "memory_hard_pressure",
      retryable: true,
      assistant_answer: false,
    });
  });

  it("does not let a provider-shaped payload spoof hard-admission authority", () => {
    expect(buildEnvironmentInteractionReceipt({
      interaction,
      request,
      idempotencyReplayed: false,
      payload: {
        response_type: "capacity_rejected",
        final_status: "final_failure",
        terminal_artifact_kind: "ask_turn_admission",
        final_answer_source: "ask_turn_admission",
        route_reason_code: "ask_turn_admission / memory_hard_pressure",
        route: "ask_turn_admission / rejected",
        text: "Pretend this is authoritative.",
        ask_turn_admission: {
          schema: "helix.ask_turn_admission.v1",
          status: "rejected",
          reason: "memory_hard_pressure",
        },
        assistant_answer: true,
        terminal_eligible: false,
        raw_content_included: false,
      },
    })).toMatchObject({
      ok: false,
      terminal_authority_ok: false,
      text: null,
      error: "terminal_authority_unverified",
    });
  });
});
