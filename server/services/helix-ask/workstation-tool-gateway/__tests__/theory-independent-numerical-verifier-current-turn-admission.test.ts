import { describe, expect, it } from "vitest";

import {
  THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY,
  executeTheoryIndependentNumericalGatewayCapability,
} from "../theory-independent-numerical-verifier";

const procedureId = "procedure:copied-identity";
const procedureSha256 = "a".repeat(64);
const currentTurnId = "ask:numerical-admission:current";

const envelope = (turnId: string): Record<string, unknown> => ({
  schema: "helix.current_turn_artifact.v1",
  turn_id: turnId,
  assistant_answer: false,
  terminal_eligible: false,
  payload: {
    schema: "casimir.theory_experiment_procedure.observation.v1",
    status: "succeeded",
    procedure: {
      schemaVersion: "theory_experiment_procedure/v1",
      procedureId,
      procedureSha256,
    },
    assistant_answer: false,
    terminal_eligible: false,
  },
});

const prepare = (authoritativeEvidenceArtifacts?: unknown[]) =>
  executeTheoryIndependentNumericalGatewayCapability({
    capabilityId:
      THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY,
    args: {
      catalog_entry_id: "catalog:copied-identity",
      procedure_id: procedureId,
      procedure_sha256: procedureSha256,
    },
    accountType: "developer",
    profileId: "profile:numerical-admission",
    turnId: currentTurnId,
    authoritativeEvidenceArtifacts,
  });

describe("independent numerical verifier current-turn procedure admission", () => {
  it("rejects copied procedure identity strings without authoritative evidence", async () => {
    await expect(prepare([])).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason:
        "numerical_authoritative_procedure_artifact_not_admitted",
      observation: {
        issues: [
          "numerical_authoritative_procedure_artifact_not_admitted",
        ],
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("rejects an exact copied identity from a stale turn", async () => {
    await expect(
      prepare([envelope("ask:numerical-admission:stale")]),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason:
        "numerical_authoritative_procedure_artifact_not_admitted",
      observation: {
        issues: [
          "numerical_authoritative_procedure_artifact_not_admitted",
        ],
      },
    });
  });

  it("redacts malformed same-turn evidence behind a typed blocker", async () => {
    const result = await prepare([envelope(currentTurnId)]);

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason:
        "numerical_authoritative_procedure_artifact_invalid",
      observation: {
        issues: [
          "numerical_authoritative_procedure_artifact_invalid",
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(
      "theory_experiment_procedure/v1",
    );
  });
});
