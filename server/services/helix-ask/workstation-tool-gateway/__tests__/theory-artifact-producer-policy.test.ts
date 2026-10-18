import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../../../helix-account/account-session-store";
import {
  callAccountAuthorizedWorkstationGatewayCapabilityForProvider,
  listAccountAuthorizedWorkstationGatewayCapabilities,
  resolveWorkstationGatewayAccountContext,
} from "../account-policy";
import {
  executeTheoryArtifactProducerGatewayCapability,
  THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
  THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
  theoryArtifactProducerAdmitLanyonManifest,
  theoryArtifactProducerPrepareLanyonRequestManifest,
} from "../theory-artifact-producer";

describe("theory artifact producer gateway account policy", () => {
  beforeEach(async () => {
    vi.stubEnv("CASIMIR_LANYON_SOURCE_ROOT", "");
    await resetAccountSessionStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("advertises read-only Lanyon admission only to developers", async () => {
    const developerReceipt = await signInLocalAccountSession({
      profile_id: "profile:lanyon-adapter-developer",
      account_type: "developer",
    });
    const developerContext = await resolveWorkstationGatewayAccountContext(
      developerReceipt.session?.session_id,
    );
    const developerListing =
      listAccountAuthorizedWorkstationGatewayCapabilities({
        accountContext: developerContext,
        requestedMode: "read",
        requestedRuntime: "codex",
      });
    expect(developerListing.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id:
          THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
        mode: "read",
        mutating: false,
        requires_confirmation: false,
        shell_access: false,
        code_mutation: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      }),
    );
    expect(developerListing.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
        mode: "read",
        mutating: false,
        requires_confirmation: false,
        shell_access: false,
        code_mutation: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      }),
    );
    expect(
      theoryArtifactProducerAdmitLanyonManifest.input_schema,
    ).toMatchObject({
      additionalProperties: false,
      required: ["request_artifact_ref", "case_id"],
      properties: {
        request_artifact_ref: { type: "string" },
        case_id: { type: "string" },
      },
    });
    expect(
      theoryArtifactProducerPrepareLanyonRequestManifest.input_schema,
    ).toMatchObject({
      additionalProperties: false,
      required: [
        "procedure_artifact_ref",
        "procedure_id",
        "procedure_sha256",
        "semantic_admission_artifact_ref",
        "case_id",
      ],
    });
    expect(
      theoryArtifactProducerAdmitLanyonManifest.input_schema.properties,
    ).not.toHaveProperty("source_root");
    expect(
      theoryArtifactProducerAdmitLanyonManifest.input_schema.properties,
    ).not.toHaveProperty("sourceRoot");

    const userReceipt = await signInLocalAccountSession({
      profile_id: "profile:lanyon-adapter-user",
      account_type: "user",
    });
    const userContext = await resolveWorkstationGatewayAccountContext(
      userReceipt.session?.session_id,
    );
    const userListing = listAccountAuthorizedWorkstationGatewayCapabilities({
      accountContext: userContext,
      requestedMode: "read",
      requestedRuntime: "codex",
    });
    expect(userListing.capabilities).not.toContainEqual(
      expect.objectContaining({
        capability_id:
          THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
      }),
    );
    expect(userListing.capabilities).not.toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
      }),
    );
    expect(userListing.locked_capabilities).toContainEqual(
      expect.objectContaining({
        capability_id:
          THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
        locked_reason: "capability_outside_account_policy",
      }),
    );
    expect(userListing.locked_capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
        locked_reason: "capability_outside_account_policy",
      }),
    );
  });

  it("fails closed before a public provider can inspect a source root", async () => {
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:lanyon-adapter-public-call",
      account_type: "user",
    });
    const accountContext = await resolveWorkstationGatewayAccountContext(
      receipt.session?.session_id,
    );
    const result =
      await callAccountAuthorizedWorkstationGatewayCapabilityForProvider({
        accountContext,
        requestedMode: "read",
        requestedRuntime: "codex",
        capabilityId: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
        arguments: {
          source_root: "C:/must-not-be-read",
          case_id: "linear_advection_1d",
          request_artifact_ref: "artifact:lanyon-request",
        },
        turnId: "ask:test:lanyon-adapter-public-block",
      });

    expect(result).toMatchObject({
      ok: false,
      capability_id: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
      gateway_admission: {
        admission_status: "blocked",
        admission_reason: "account_policy_blocked",
        blocked_reason: "capability_outside_account_policy",
      },
      observation_packet: {
        status: "blocked",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
    });
  });

  it("returns typed missing-input evidence without touching a source root", async () => {
    const result = await executeTheoryArtifactProducerGatewayCapability({
      capabilityId: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
      args: {},
      accountType: "developer",
      profileId: "profile:lanyon-adapter-developer",
      turnId: "ask:test:lanyon-missing",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "missing_input",
      admissionStatus: "blocked",
      admissionReason: "lanyon_adapter_input_missing",
      observation: {
        status: "blocked",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.missingRequirements.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "lanyon_case_id_required",
        "lanyon_source_root_not_configured",
        "lanyon_request_artifact_ref_required",
        "authoritative_evidence_artifacts_required",
      ]),
    );
  });

  it("ignores caller-supplied source roots and requires server configuration", async () => {
    const result = await executeTheoryArtifactProducerGatewayCapability({
      capabilityId: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
      args: {
        case_id: "linear_advection_1d",
        request: { artifactId: "caller-payload-is-not-a-source-root" },
        source_root: "C:/caller-controlled-root",
        sourceRoot: "C:/caller-controlled-camel-root",
      },
      accountType: "developer",
      profileId: "profile:lanyon-adapter-developer",
      turnId: "ask:test:lanyon-source-root",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "missing_input",
      admissionStatus: "blocked",
      admissionReason: "lanyon_adapter_input_missing",
      blockedReason: "lanyon_source_root_not_configured",
    });
    expect(result.missingRequirements.map((entry) => entry.code)).toEqual([
      "lanyon_source_root_not_configured",
      "lanyon_request_artifact_ref_required",
      "authoritative_evidence_artifacts_required",
    ]);
  });
});
