import { describe, expect, it } from "vitest";
import {
  HELIX_ENVIRONMENT_ACTION_DIFFERENTIAL_TRACE_SCHEMA,
  helixEnvironmentActionDifferentialTraceSchema,
  type HelixEnvironmentActionDifferentialTrace,
} from "@shared/helix-environment-action";
import { minecraftPlayerCapabilityForActionKind } from "@shared/helix-minecraft-player-capabilities";
import { auditEnvironmentActionDifferentialTraces } from "../workflow-differential-audit";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const workflows = [
  "follow",
  "collect",
  "mine",
  "place",
  "craft",
  "inventory_transfer",
] as const;
const observationRef = "environment_action_observation:workflow-proof";

const trace = (input: {
  actionKind: (typeof workflows)[number];
  lane: "direct_codex" | "helix";
}): HelixEnvironmentActionDifferentialTrace =>
  helixEnvironmentActionDifferentialTraceSchema.parse({
    schema: HELIX_ENVIRONMENT_ACTION_DIFFERENTIAL_TRACE_SCHEMA,
    trace_id: `environment_action_differential_trace:${input.lane}:${input.actionKind}`,
    scenario_id: `minecraft_player_workflow:${input.actionKind}`,
    lane: input.lane,
    action_kind: input.actionKind,
    prompt_hash: hash("a"),
    starting_state_hash: hash("b"),
    capability_contract_hash: hash("c"),
    source_artifact_refs: [
      `${input.lane}_public_trace:${input.actionKind}`,
    ],
    public_capture_hash: hash(input.lane === "helix" ? "9" : "0"),
    selected_capability_id: minecraftPlayerCapabilityForActionKind(input.actionKind),
    normalized_arguments_hash: hash("d"),
    admission_status: input.lane === "helix" ? "admitted" : "not_applicable",
    execution_outcome: "succeeded",
    normalized_progress_hashes: [hash("e"), hash("f")],
    postcondition_status: "satisfied",
    observation_refs: [observationRef],
    observation_reentered: true,
    final_candidate_hash: hash("1"),
    final_candidate_support_refs: [observationRef],
    route_product_hash: input.lane === "helix" ? hash("1") : null,
    route_product_support_refs: input.lane === "helix" ? [observationRef] : [],
    terminal_outcome: "success",
    terminal_authority_status: input.lane === "helix" ? "passed" : "not_applicable",
    terminal_writer_hash: input.lane === "helix" ? hash("1") : null,
    terminal_writer_support_refs: input.lane === "helix" ? [observationRef] : [],
    visible_text_hash: input.lane === "helix" ? hash("1") : null,
    voice_projection_status: input.lane === "helix" ? "not_observed" : "not_applicable",
    voice_text_hash: null,
    created_at: "2026-08-05T18:00:00.000Z",
    hidden_reasoning_included: false,
    content_role: "environment_action_differential_trace_not_assistant_answer",
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  });

describe("Minecraft player workflow direct-Codex/Helix differential observer", () => {
  for (const actionKind of workflows) {
    it(`accepts a continuous public lifecycle for ${actionKind}`, () => {
      const audit = auditEnvironmentActionDifferentialTraces({
        reference: trace({ actionKind, lane: "direct_codex" }),
        helix: trace({ actionKind, lane: "helix" }),
        comparedAt: "2026-08-05T18:01:00.000Z",
      });
      expect(audit).toMatchObject({
        ok: true,
        action_kind: actionKind,
        first_divergence_stage: null,
        mismatches: [],
        observer_only: true,
        assistant_answer: false,
      });
    });
  }

  it("names evidence re-entry as the first divergence before a later terminal substitution", () => {
    const reference = trace({ actionKind: "place", lane: "direct_codex" });
    const helix = {
      ...trace({ actionKind: "place", lane: "helix" }),
      observation_reentered: false,
      final_candidate_hash: null,
      terminal_outcome: "typed_failure" as const,
      terminal_authority_status: "failed" as const,
      terminal_writer_hash: hash("4"),
      visible_text_hash: hash("4"),
    };
    const audit = auditEnvironmentActionDifferentialTraces({
      reference,
      helix,
      comparedAt: "2026-08-05T18:01:00.000Z",
    });
    expect(audit.first_divergence_stage).toBe("evidence_reentry");
    expect(audit.mismatches.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "reference_observation_not_reentered_by_helix",
        "post_observation_candidate_missing",
        "terminal_outcome_mismatch",
      ]),
    );
  });

  it("does not let a clean presentation hide failed action admission", () => {
    const reference = trace({ actionKind: "mine", lane: "direct_codex" });
    const helix = {
      ...trace({ actionKind: "mine", lane: "helix" }),
      admission_status: "rejected" as const,
      execution_outcome: "not_run" as const,
      normalized_progress_hashes: [],
      postcondition_status: "not_applicable" as const,
      observation_refs: [],
      observation_reentered: false,
      final_candidate_hash: null,
      final_candidate_support_refs: [],
      route_product_hash: null,
      route_product_support_refs: [],
      terminal_outcome: "blocked" as const,
      terminal_authority_status: "failed_closed" as const,
      terminal_writer_hash: null,
      terminal_writer_support_refs: [],
      visible_text_hash: null,
    };
    const audit = auditEnvironmentActionDifferentialTraces({
      reference,
      helix,
      comparedAt: "2026-08-05T18:01:00.000Z",
    });
    expect(audit.first_divergence_stage).toBe("tool_admission");
  });

  it("rejects a symmetric trace omission when execution never re-enters Helix", () => {
    const reference = {
      ...trace({ actionKind: "collect", lane: "direct_codex" }),
      observation_refs: [],
      observation_reentered: false,
      final_candidate_hash: null,
      final_candidate_support_refs: [],
    };
    const helix = {
      ...trace({ actionKind: "collect", lane: "helix" }),
      observation_refs: [],
      observation_reentered: false,
      final_candidate_hash: null,
      final_candidate_support_refs: [],
      route_product_hash: null,
      route_product_support_refs: [],
      terminal_writer_hash: null,
      terminal_writer_support_refs: [],
      visible_text_hash: null,
    };
    const audit = auditEnvironmentActionDifferentialTraces({
      reference,
      helix,
      comparedAt: "2026-08-05T18:01:00.000Z",
    });
    expect(audit.first_divergence_stage).toBe("evidence_reentry");
    expect(audit.mismatches.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "reference_execution_observation_refs_missing",
        "helix_execution_observation_refs_missing",
        "executed_action_observation_not_reentered_by_helix",
      ]),
    );
  });

  it("names route-product replacement as the first downstream divergence", () => {
    const helix = {
      ...trace({ actionKind: "craft", lane: "helix" }),
      route_product_hash: hash("7"),
      terminal_writer_hash: hash("7"),
      visible_text_hash: hash("7"),
    };
    const audit = auditEnvironmentActionDifferentialTraces({
      reference: trace({ actionKind: "craft", lane: "direct_codex" }),
      helix,
      comparedAt: "2026-08-05T18:01:00.000Z",
    });
    expect(audit.first_divergence_stage).toBe("route_product_materialization");
    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "final_candidate_route_product_text_mismatch",
    );
  });

  it("detects support refs dropped after a grounded candidate", () => {
    const helix = {
      ...trace({ actionKind: "inventory_transfer", lane: "helix" }),
      route_product_support_refs: [],
      terminal_writer_support_refs: [],
    };
    const audit = auditEnvironmentActionDifferentialTraces({
      reference: trace({ actionKind: "inventory_transfer", lane: "direct_codex" }),
      helix,
      comparedAt: "2026-08-05T18:01:00.000Z",
    });
    expect(audit.first_divergence_stage).toBe("route_product_materialization");
    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "provider_route_product_dropped_candidate_support",
    );
  });

  it("requires a consistent voice projection to hash the visible text", () => {
    const helix = {
      ...trace({ actionKind: "follow", lane: "helix" }),
      voice_projection_status: "consistent" as const,
      voice_text_hash: hash("8"),
    };
    const audit = auditEnvironmentActionDifferentialTraces({
      reference: trace({ actionKind: "follow", lane: "direct_codex" }),
      helix,
      comparedAt: "2026-08-05T18:01:00.000Z",
    });
    expect(audit.first_divergence_stage).toBe("presentation");
    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "text_voice_terminal_divergence",
    );
  });
});
