import {
  unsafeSealCasimirSpecScientificClaimIrV1,
  type CasimirSpecScientificClaimIrV1,
} from "@shared/contracts/casimir-spec-scientific-claim-ir.v1";
import semanticFixtureJson from "../../../shared/contracts/__tests__/fixtures/casimir-spec/advection-diffusion.open-world.valid.v1.json";
import { buildCodexNormalizedObservationArtifacts } from "../../services/helix-ask/agent-providers/codex-provider";
import { callWorkstationGatewayCapability } from "../../services/helix-ask/workstation-tool-gateway/registry";
import type { HelixWorkstationGatewayCallResult } from "../../services/helix-ask/workstation-tool-gateway/types";
import { admitCasimirSpecScientificClaimIrV1 } from "../../services/theory/casimir-spec-semantic-admission";

const BADGE_ID = "study.casimir_dp.evidence_map_stage3";
const GRAPH_SNAPSHOT_SHA256 = "d".repeat(64);
const SOURCE_PACKET_SHA256 = "a".repeat(64);
const semanticFixture =
  semanticFixtureJson as unknown as CasimirSpecScientificClaimIrV1;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const buildSemanticAdmissionResult = async (input: {
  turnId: string;
  graphId: string;
}): Promise<HelixWorkstationGatewayCallResult> => {
  const claimIrDraft = structuredClone(semanticFixture);
  claimIrDraft.world.graphId = input.graphId;
  claimIrDraft.world.badgeIds = [BADGE_ID];
  const claimIr = await unsafeSealCasimirSpecScientificClaimIrV1(claimIrDraft);
  const receipt = await admitCasimirSpecScientificClaimIrV1({
    claimIr,
    generatedAt: "2026-07-26T12:00:00.000Z",
    receiptId: `${input.turnId}:semantic-admission`,
    catalogSnapshots: [],
    registeredIdentityBindings: [],
    graphSnapshot: {
      graphId: input.graphId,
      snapshotSha256: GRAPH_SNAPSHOT_SHA256,
      badgeIds: [BADGE_ID],
      edges: [],
    },
  });
  if (receipt.disposition === "rejected") {
    throw new Error(
      `semantic admission fixture rejected: ${receipt.issues
        .map((issue) => issue.code)
        .join(",")}`,
    );
  }
  const capability = "theory-semantic-admitter.normalize";
  return {
    schema: "helix.workstation_tool_gateway.call_result.v1",
    manifest_version: "test",
    ok: true,
    agent_runtime: "codex",
    capability_id: capability,
    mode: "read",
    gateway_admission: {
      schema: "helix.workstation_tool_gateway.admission.v1",
      requested_capability: capability,
      selected_agent_provider: "codex",
      permission_profile: "read",
      admission_status: "admitted",
      admission_reason: "test_admitted",
      assistant_answer: false,
      raw_content_included: false,
    },
    observation_packet: {
      schema: "helix.agent_step_observation_packet.v1",
      turn_id: input.turnId,
      iteration: 1,
      call_id: `${input.turnId}:${capability}:call`,
      decision_id: `${input.turnId}:${capability}:decision`,
      capability_key: capability,
      panel_id: "theory-badge-graph",
      action: "normalize",
      status: "succeeded",
      produced_artifact_refs: [`${input.turnId}:${capability}:observation`],
      observation_summary: "Typed semantic admission observation.",
      receipts: [],
      missing_requirements: [],
      state_delta: {},
      suggested_next_steps: ["use_another_tool"],
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    tool_lifecycle_trace: {} as never,
    tool_followup_decision: {} as never,
    observation: {
      schema: "casimir.theory_semantic_admitter.observation.v1",
      status: "succeeded",
      source_packet_sha256: SOURCE_PACKET_SHA256,
      claim_ir: claimIr,
      semantic_admission_receipt: receipt,
      output_role: "evidence_for_synthesis",
      next_affordances: [],
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    artifact_refs: [`${input.turnId}:${capability}:observation`],
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
  };
};

export async function buildTheoryExecutionClosureTerminalFixture(input: {
  turnId: string;
  semanticReady: boolean;
}): Promise<{
  artifacts: Record<string, unknown>[];
  closureArtifact: Record<string, unknown>;
  closure: Record<string, unknown>;
  semanticSupportRef: string | null;
}> {
  const baseArguments = {
    prompt: input.semanticReady
      ? "Explain the admitted Stage 3 evidence-map theory badge."
      : "Compare the Stage 3 evidence-map theory badge before semantic admission.",
    operation: input.semanticReady ? "explain" : "compare",
    target: "Stage 3 evidence map",
    selected_badge_ids: [BADGE_ID],
    ...(input.semanticReady
      ? {
          formal_system: "Lean 4",
          lanyon_requested: true,
          lanyon_case_id: "advection_diffusion_full_1d",
          target_observable: "observable:concentration-lab",
          coordinate_frame: "laboratory",
          initial_boundary_conditions: [
            "periodic domain",
            "sinusoidal initial concentration",
          ],
          requested_precision: "1e-3",
        }
      : {}),
  };
  const preliminary = await callWorkstationGatewayCapability({
    agentRuntime: "codex",
    mode: "read",
    accountType: "developer",
    capabilityId: "theory-experiment-procedure.prepare",
    turnId: input.turnId,
    iteration: 1,
    arguments: baseArguments,
  });
  if (!preliminary.ok) {
    throw new Error(`preliminary procedure failed: ${preliminary.error}`);
  }

  let prepared = preliminary;
  let semanticArtifacts: Record<string, unknown>[] = [];
  if (input.semanticReady) {
    const preliminaryProcedure = record(
      record(preliminary.observation).procedure,
    );
    const semanticResult = await buildSemanticAdmissionResult({
      turnId: input.turnId,
      graphId: String(preliminaryProcedure.graphId),
    });
    const normalizedSemantic = buildCodexNormalizedObservationArtifacts({
      turnId: input.turnId,
      gatewayCallResults: [semanticResult],
    });
    if (
      normalizedSemantic.missingNormalizationFailures.length > 0 ||
      normalizedSemantic.artifacts.length !== 1
    ) {
      throw new Error(
        `semantic normalization failed: ${normalizedSemantic.missingNormalizationFailures.join(",")}`,
      );
    }
    semanticArtifacts = normalizedSemantic.artifacts;
    const semanticArtifact = semanticArtifacts[0];
    prepared = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId: "theory-experiment-procedure.prepare",
      turnId: input.turnId,
      iteration: 2,
      arguments: {
        ...baseArguments,
        evidence_artifacts: [
          {
            artifact_ref: semanticArtifact.artifact_id,
            source_turn_id: semanticArtifact.turn_id,
            kind: "semantic_admission",
            artifact: semanticArtifact.payload,
          },
        ],
      },
      authoritativeEvidenceArtifacts: semanticArtifacts,
    });
    if (!prepared.ok) {
      throw new Error(`bound procedure failed: ${prepared.error}`);
    }
  }

  const procedure = record(record(prepared.observation).procedure);
  const normalizedProcedure = buildCodexNormalizedObservationArtifacts({
    turnId: input.turnId,
    gatewayCallResults: [prepared],
  });
  if (
    normalizedProcedure.missingNormalizationFailures.length > 0 ||
    normalizedProcedure.artifacts.length !== 1
  ) {
    throw new Error(
      `procedure normalization failed: ${normalizedProcedure.missingNormalizationFailures.join(",")}`,
    );
  }
  const authoritativeEvidenceArtifacts = [
    ...normalizedProcedure.artifacts,
    ...semanticArtifacts,
  ];
  const evaluated = await callWorkstationGatewayCapability({
    agentRuntime: "codex",
    mode: "read",
    accountType: "developer",
    capabilityId: "theory-experiment-procedure.evaluate_closure",
    turnId: input.turnId,
    iteration: input.semanticReady ? 3 : 2,
    arguments: {
      prompt: "Evaluate the exact current-turn execution closure.",
      procedure_artifact_ref: normalizedProcedure.artifacts[0].artifact_id,
      procedure_id: procedure.procedureId,
      procedure_sha256: procedure.procedureSha256,
    },
    authoritativeEvidenceArtifacts,
  });
  if (!evaluated.ok) {
    throw new Error(`closure evaluation failed: ${evaluated.error}`);
  }
  const normalizedClosure = buildCodexNormalizedObservationArtifacts({
    turnId: input.turnId,
    gatewayCallResults: [evaluated],
  });
  if (
    normalizedClosure.missingNormalizationFailures.length > 0 ||
    normalizedClosure.artifacts.length !== 1
  ) {
    throw new Error(
      `closure normalization failed: ${normalizedClosure.missingNormalizationFailures.join(",")}`,
    );
  }
  const closureArtifact = normalizedClosure.artifacts[0];
  const closure = record(record(closureArtifact.payload).closure);
  return {
    artifacts: [...authoritativeEvidenceArtifacts, closureArtifact],
    closureArtifact,
    closure,
    semanticSupportRef: semanticArtifacts[0]
      ? String(semanticArtifacts[0].artifact_id)
      : null,
  };
}
