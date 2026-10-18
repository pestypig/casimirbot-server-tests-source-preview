import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { resolveCurrentTurnProviderTerminalIdentity } from "../services/helix-ask/turn-finalizer";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/turn-finalizer.ts");

describe("Helix Ask turn finalizer extraction boundary", () => {
  it("keeps the turn finalizer implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/turn-finalizer");
    expect(routeSource).not.toMatch(/const\s+finalizeHelixAskTurnPayload\s*=\s*\(args:\s*\{/);
    expect(serviceSource).toMatch(/const\s+finalizeHelixAskTurnPayload\s*=\s*\(args:\s*FinalizeHelixAskTurnPayloadInput\)/);
    expect(serviceSource).toMatch(/export\s+const\s+createHelixAskTurnFinalizer\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves a current-turn provider identity across post-envelope trace rebuilds", () => {
    const turnId = "ask:provider-finalizer-identity";
    const observationRef = `${turnId}:workstation_gateway:docs.search:packet`;
    expect(resolveCurrentTurnProviderTerminalIdentity({
      turnId,
      fallbackTerminalArtifactKind: "workstation_tool_evaluation",
      fallbackFinalAnswerSource: "workstation_tool_evaluation",
      payload: {
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        terminal_presentation: {
          final_answer_source: "agent_provider_terminal_candidate",
          terminal_authority_ref: `${turnId}:agent_provider_terminal_candidate:codex:test`,
          selected_observation_refs: [observationRef],
        },
        current_turn_artifact_ledger: [
          { artifact_id: observationRef, kind: "provider_gateway_observation_packet" },
        ],
      },
    })).toEqual({
      terminalArtifactKind: "agent_provider_terminal_candidate",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });
  });

  it("defers provider terminal publication until after the solver hard gate rebuild", () => {
    const serviceSource = readFileSync(servicePath, "utf8");
    const deferralIndex = serviceSource.indexOf("const finalizerDefersProviderSingleWriter");
    const hardGateIndex = serviceSource.indexOf("applyAskTurnSolverHardGateFailure({", deferralIndex);
    const deferredWriterIndex = serviceSource.indexOf("finalizerDefersProviderSingleWriter &&", hardGateIndex);

    expect(deferralIndex).toBeGreaterThan(-1);
    expect(hardGateIndex).toBeGreaterThan(deferralIndex);
    expect(deferredWriterIndex).toBeGreaterThan(hardGateIndex);
  });

  it("preserves turn-scoped provider refs before the artifact ledger is attached", () => {
    const turnId = "ask:provider-finalizer-pre-ledger";
    expect(resolveCurrentTurnProviderTerminalIdentity({
      turnId,
      fallbackTerminalArtifactKind: "workstation_tool_evaluation",
      fallbackFinalAnswerSource: "workstation_tool_evaluation",
      payload: {
        terminal_presentation: {
          final_answer_source: "agent_provider_terminal_candidate",
          terminal_authority_ref: `${turnId}:agent_provider_terminal_candidate:codex:test`,
          selected_observation_refs: [`${turnId}:workstation_gateway:docs.search:packet`],
        },
      },
    })).toEqual({
      terminalArtifactKind: "agent_provider_terminal_candidate",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });
  });

  it("does not preserve a provider identity backed only by stale refs", () => {
    const turnId = "ask:provider-finalizer-stale";
    expect(resolveCurrentTurnProviderTerminalIdentity({
      turnId,
      fallbackTerminalArtifactKind: "workstation_tool_evaluation",
      fallbackFinalAnswerSource: "workstation_tool_evaluation",
      payload: {
        terminal_presentation: {
          final_answer_source: "agent_provider_terminal_candidate",
          terminal_authority_ref: `${turnId}:agent_provider_terminal_candidate:codex:test`,
          selected_observation_refs: ["ask:prior:docs.search:packet"],
        },
        current_turn_artifact_ledger: [],
      },
    })).toEqual({
      terminalArtifactKind: "workstation_tool_evaluation",
      finalAnswerSource: "workstation_tool_evaluation",
    });
  });
});
