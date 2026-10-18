import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  ingestWorkstationLiveSourceEvent,
  resetWorkstationLiveSources,
} from "../services/situation-room/workstation-live-source-ingest";
import {
  listLiveCommentaryCandidates,
  listLiveCommentaryDeliveries,
  listLiveCommentaryProposals,
  resetLiveCommentary,
  upsertLiveCommentarySession,
} from "../services/situation-room/live-commentary";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import {
  resetCompanionPolicies,
  upsertCompanionPolicy,
} from "../services/situation-room/companion-policy-engine";

describe("live commentary for live answer environments", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetWorkstationLiveSources();
    resetLiveCommentary();
    resetCompanionPolicies();
    __resetHelixThreadLedgerStore();
  });

  it("surfaces prime milestones as validation/tool observations, not answer items", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:commentary",
      created_turn_id: "turn:prime",
      objective: "Set up a live prime number generator.",
      source_ids: ["source:calculator-prime-stream"],
      preset: "calculator_prime_stream",
      mode: "text_only",
      now: "2026-05-12T12:00:00.000Z",
    });

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-prime-stream",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "prime_found",
      seq: 5,
      ts: "2026-05-12T12:00:05.000Z",
      payload: {
        candidate: 11,
        is_prime: true,
        latest_prime: 11,
        prime_count: 5,
        gap: 4,
      },
      evidence_refs: ["calculator:prime:11"],
      trace: {
        deterministic: true,
        algorithm: "trial_division",
      },
    });

    expect(result.live_commentary?.proposal).toMatchObject({
      schema: "helix.live_commentary_proposal.v1",
      reason: "prime_found",
      decision: "show_text",
      model_invoked: false,
      deterministic: true,
      raw_logs_included: false,
    });
    expect(result.live_commentary?.proposal.trace_steps.map((step) => step.kind)).toEqual([
      "goal_frame",
      "subgoal_assigned",
      "source_observed",
      "line_updated",
      "evaluation_question",
      "evaluation_result",
      "commentary_proposed",
      "delivery_decided",
    ]);
    expect(result.live_commentary?.proposal.trace_steps.every((step) => {
      return step.model_invoked === false &&
        step.deterministic === true &&
        step.raw_logs_included === false &&
        step.context_policy === "compact_context_pack_only";
    })).toBe(true);
    expect(result.live_commentary?.delivery).toMatchObject({
      schema: "helix.live_commentary_delivery_receipt.v1",
      delivered: true,
      channel: "ui_text",
      reason: "delivered",
    });
    expect(listLiveCommentaryProposals(environment.environment_id)).toHaveLength(1);
    expect(listLiveCommentaryCandidates(environment.environment_id)[0]).toMatchObject({
      schema: "helix.live_commentary_candidate.v1",
      decision: "show_text",
      model_invoked: false,
      deterministic: true,
      context_policy: "compact_context_pack_only",
      raw_logs_included: false,
    });
    expect(listLiveCommentaryDeliveries(environment.environment_id)).toHaveLength(1);

    const ledgerEvents = getHelixThreadLedgerEvents({ threadId: "helix-ask:commentary" });
    expect(ledgerEvents.some((event) => event.item_type === "answer")).toBe(false);
    expect(ledgerEvents.some((event) => event.item_type === "validation" && event.meta?.kind === "live_commentary_proposal")).toBe(true);
    expect(ledgerEvents.every((event) => !event.assistant_text)).toBe(true);
  });

  it("keeps routine candidate checks silent under milestone cadence", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:commentary-silent",
      created_turn_id: "turn:prime",
      objective: "Set up a live prime number generator.",
      source_ids: ["source:calculator-prime-stream"],
      preset: "calculator_prime_stream",
      mode: "text_only",
      now: "2026-05-12T12:00:00.000Z",
    });

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-prime-stream",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "prime_candidate_checked",
      seq: 6,
      ts: "2026-05-12T12:00:06.000Z",
      payload: {
        candidate: 12,
        is_prime: false,
        latest_prime: 11,
        prime_count: 5,
        next_candidate: 13,
      },
      evidence_refs: ["calculator:prime:12"],
    });

    expect(result.live_commentary?.proposal).toMatchObject({
      reason: "suppressed_routine",
      decision: "silent_keep_in_context",
      user_visible: false,
    });
    expect(result.live_commentary?.proposal.trace_steps.find((step) => step.kind === "evaluation_result")).toMatchObject({
      status: "skipped",
    });
    expect(result.live_commentary?.proposal.trace_steps.find((step) => step.kind === "delivery_decided")).toMatchObject({
      status: "skipped",
    });
    expect(getHelixThreadLedgerEvents({ threadId: "helix-ask:commentary-silent" })).toHaveLength(0);
  });

  it("emits equation commentary as a bounded candidate and validation, not an answer", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:equation-commentary",
      created_turn_id: "turn:equation",
      objective: "Make this equation live and explain each new value in context.",
      source_ids: ["source:calculator-equation-live"],
      preset: "calculator_equation_interpreter",
      mode: "text_only",
      now: "2026-05-12T12:00:00.000Z",
    });

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-equation-live",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "equation_evaluated",
      seq: 1,
      ts: "2026-05-12T12:00:01.000Z",
      payload: {
        expression: "x^2 - 4 = 0",
        result: "2, -2",
        variables_summary: "x solved from a quadratic equilibrium equation",
        equation_context: "equilibrium points",
        next_check: "Watch variable changes.",
      },
      evidence_refs: ["calculator:equation:x2-minus-4"],
      trace: {
        deterministic: true,
      },
    });

    expect(result.live_commentary?.proposal).toMatchObject({
      reason: "milestone",
      decision: "show_text",
      model_invoked: false,
      deterministic: true,
      raw_logs_included: false,
    });
    expect(listLiveCommentaryCandidates(environment.environment_id)[0]).toMatchObject({
      schema: "helix.live_commentary_candidate.v1",
      trigger: "line_update",
      text: expect.stringContaining("equilibrium points"),
      model_invoked: false,
      deterministic: true,
    });
    const ledgerEvents = getHelixThreadLedgerEvents({ threadId: "helix-ask:equation-commentary" });
    expect(ledgerEvents.some((event) => event.item_type === "answer")).toBe(false);
    expect(ledgerEvents.some((event) => event.item_type === "validation" && event.meta?.kind === "live_commentary_proposal")).toBe(true);
    expect(ledgerEvents.every((event) => !event.assistant_text)).toBe(true);
  });

  it("downgrades voice confirmation commentary to text when speak authority is missing", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:commentary-voice",
      created_turn_id: "turn:prime",
      objective: "Set up a live prime number generator.",
      source_ids: ["source:calculator-prime-stream"],
      preset: "calculator_prime_stream",
      mode: "voice_on_confirm",
      now: "2026-05-12T12:00:00.000Z",
    });
    upsertLiveCommentarySession({ environment, cadence: "milestones_only", status: "active" });
    upsertCompanionPolicy({
      thread_id: "helix-ask:commentary-voice",
      voice_output_enabled: true,
      companion_mode: "active_companion",
    });

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-prime-stream",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "prime_found",
      seq: 7,
      ts: "2026-05-12T12:00:07.000Z",
      payload: {
        candidate: 13,
        is_prime: true,
        latest_prime: 13,
        prime_count: 6,
        gap: 2,
      },
      evidence_refs: ["calculator:prime:13"],
    });

    expect(result.live_commentary?.proposal).toMatchObject({
      decision: "show_text",
      speak_authority: null,
    });
    expect(result.live_commentary?.delivery).toMatchObject({
      delivered: true,
      channel: "ui_text",
      reason: "delivered",
      speak_authority: null,
    });
  });

  it("uses voice confirmation receipts only when speak authority is present", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:commentary-voice-authorized",
      created_turn_id: "turn:prime",
      objective: "Set up a live prime number generator.",
      source_ids: ["source:calculator-prime-stream"],
      preset: "calculator_prime_stream",
      mode: "voice_on_confirm",
      now: "2026-05-12T12:00:00.000Z",
    });
    upsertLiveCommentarySession({ environment, cadence: "milestones_only", status: "active" });
    upsertCompanionPolicy({
      thread_id: "helix-ask:commentary-voice-authorized",
      voice_output_enabled: true,
      companion_mode: "active_companion",
    });
    const speakAuthority = {
      kind: "operator_callout_v1" as const,
      artifact_ref: "operator_callout:prime-13",
      evidence_refs: ["calculator:prime:13"],
    };

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-prime-stream",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "prime_found",
      seq: 7,
      ts: "2026-05-12T12:00:07.000Z",
      payload: {
        candidate: 13,
        is_prime: true,
        latest_prime: 13,
        prime_count: 6,
        gap: 2,
      },
      evidence_refs: ["calculator:prime:13"],
      liveCommentary: {
        speakAuthority,
      },
    });

    expect(result.live_commentary?.proposal).toMatchObject({
      decision: "voice_on_confirm",
      speak_authority: speakAuthority,
    });
    expect(result.live_commentary?.delivery).toMatchObject({
      delivered: false,
      channel: "voice_on_confirm",
      reason: "awaiting_confirmation",
      speak_authority: speakAuthority,
    });
  });

  it("downgrades voice confirmation commentary to text when voice output is disabled", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:commentary-voice-off",
      created_turn_id: "turn:prime",
      objective: "Set up a live prime number generator.",
      source_ids: ["source:calculator-prime-stream"],
      preset: "calculator_prime_stream",
      mode: "voice_on_confirm",
      now: "2026-05-12T12:00:00.000Z",
    });
    upsertLiveCommentarySession({ environment, cadence: "milestones_only", status: "active" });
    upsertCompanionPolicy({
      thread_id: "helix-ask:commentary-voice-off",
      voice_output_enabled: false,
      companion_mode: "active_companion",
    });
    const speakAuthority = {
      kind: "operator_callout_v1" as const,
      artifact_ref: "operator_callout:prime-17",
      evidence_refs: ["calculator:prime:17"],
    };

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-prime-stream",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "prime_found",
      seq: 17,
      ts: "2026-05-12T12:00:17.000Z",
      payload: {
        candidate: 17,
        is_prime: true,
        latest_prime: 17,
        prime_count: 7,
        gap: 4,
      },
      evidence_refs: ["calculator:prime:17"],
      liveCommentary: {
        speakAuthority,
      },
    });

    expect(result.live_commentary?.proposal.decision).toBe("voice_on_confirm");
    expect(result.live_commentary?.delivery).toMatchObject({
      delivered: true,
      channel: "ui_text",
      reason: "delivered",
      speak_authority: speakAuthority,
    });
  });
});
