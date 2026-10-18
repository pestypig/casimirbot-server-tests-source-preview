import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import fixtureJson from "../../../../../shared/contracts/__tests__/fixtures/casimir-spec/advection-diffusion.open-world.valid.v1.json";
import {
  CASIMIR_SPEC_LANGUAGE_VERSION,
  type BuildCasimirSpecScientificClaimIrV1Input,
  type CasimirSpecScientificClaimIrV1,
} from "../../../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import {
  CASIMIR_SPEC_SOURCE_PACKET_ARTIFACT_ID,
  CASIMIR_SPEC_SOURCE_PACKET_SCHEMA_VERSION,
  formatCasimirSpecSourcePacketV1,
  type CasimirSpecSourcePacketV1,
} from "../../../../../shared/contracts/casimir-spec-source-packet.v1";

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
  executeTheorySemanticAdmitterGatewayCapability,
  THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
} from "../theory-semantic-admitter";

const fixture = fixtureJson as unknown as CasimirSpecScientificClaimIrV1;
const TURN_ID = "ask:test:semantic-admitter-current-turn";
const SOURCE_EVIDENCE_REF = `${TURN_ID}:casimir-spec-source-packet`;
const SOURCE_PATH =
  "fixtures/casimir-spec/advection-diffusion.source-packet.v1.json";
const SOURCE_CAPABILITY = "research-library.apply_evidence_enrichment";
const SOURCE_MEDIA_TYPE =
  "application/vnd.casimir-spec-source-packet+json";

const sourcePacket = (): CasimirSpecSourcePacketV1 => {
  const {
    artifactId: _artifactId,
    schemaVersion: _schemaVersion,
    generatedAt: _generatedAt,
    semanticSha256: _semanticSha256,
    artifactSha256: _artifactSha256,
    source: _source,
    definitions,
    assumptions,
    axiomLedger,
    claims,
    ...body
  } = structuredClone(fixture);
  return {
    artifactId: CASIMIR_SPEC_SOURCE_PACKET_ARTIFACT_ID,
    schemaVersion: CASIMIR_SPEC_SOURCE_PACKET_SCHEMA_VERSION,
    languageVersion: CASIMIR_SPEC_LANGUAGE_VERSION,
    sourcePacketId: "source-packet:semantic-admitter-current-turn-fixture",
    body: {
      ...body,
      definitions: definitions.map(
        ({ expressionSha256: _expressionSha256, ...definition }) =>
          definition,
      ),
      assumptions: assumptions.map(
        ({ propositionSha256: _propositionSha256, ...assumption }) =>
          assumption,
      ),
      axiomLedger: {
        ...axiomLedger,
        entries: axiomLedger.entries.map(
          ({ typeExpressionSha256: _typeExpressionSha256, ...axiom }) =>
            axiom,
        ),
      },
      claims: claims.map(
        ({ propositionSha256: _propositionSha256, ...claim }) => claim,
      ),
    } as Omit<
      BuildCasimirSpecScientificClaimIrV1Input,
      "generatedAt" | "source"
    >,
  };
};

const packetSha256 = (packet: CasimirSpecSourcePacketV1): string =>
  createHash("sha256")
    .update(formatCasimirSpecSourcePacketV1(packet), "utf8")
    .digest("hex");

const sourceEvidenceEnvelope = (input?: {
  packet?: CasimirSpecSourcePacketV1 | Record<string, unknown>;
  artifactRef?: string;
  turnId?: string;
  contentSha256?: string;
  sourceCapabilityId?: string;
  capabilityKey?: string;
}): Record<string, unknown> => {
  const packet = input?.packet ?? sourcePacket();
  const contentSha256 =
    input?.contentSha256 ??
    packetSha256(packet as CasimirSpecSourcePacketV1);
  return {
    schema: "helix.current_turn_artifact.v1",
    artifact_id: input?.artifactRef ?? SOURCE_EVIDENCE_REF,
    producer_item_id: "semantic-source-packet-preparation",
    kind: "casimir_spec_source_packet",
    observation_kind: "casimir_spec_source_packet",
    payload_schema: CASIMIR_SPEC_SOURCE_PACKET_SCHEMA_VERSION,
    turn_id: input?.turnId ?? TURN_ID,
    source_scope: "current_turn_context",
    source_capability_id:
      input?.sourceCapabilityId ?? SOURCE_CAPABILITY,
    capability_key: input?.capabilityKey ?? SOURCE_CAPABILITY,
    source_packet_id: packet.sourcePacketId,
    source_path: SOURCE_PATH,
    media_type: SOURCE_MEDIA_TYPE,
    content_sha256: contentSha256,
    payload: packet,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  };
};

const executeSemanticAdmission = (input?: {
  packet?: CasimirSpecSourcePacketV1 | Record<string, unknown>;
  sourceEvidenceRef?: string;
  turnId?: string;
  authoritativeEvidenceArtifacts?: unknown[];
}) => {
  const packet = input?.packet ?? sourcePacket();
  return executeTheorySemanticAdmitterGatewayCapability({
    capabilityId: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
    args: {
      source_evidence_ref:
        input?.sourceEvidenceRef ?? SOURCE_EVIDENCE_REF,
      source_packet: packet,
      source_path: SOURCE_PATH,
      receipt_id: "semantic-admission:current-turn-fixture",
    },
    accountType: "developer",
    turnId: input?.turnId ?? TURN_ID,
    authoritativeEvidenceArtifacts:
      input?.authoritativeEvidenceArtifacts ?? [
        sourceEvidenceEnvelope({ packet }),
      ],
  });
};

describe("theory semantic admitter gateway account policy", () => {
  beforeEach(async () => {
    await resetAccountSessionStore();
  });

  it("advertises read-only semantic admission only to developers", async () => {
    const developerReceipt = await signInLocalAccountSession({
      profile_id: "profile:semantic-admitter-developer",
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
        capability_id: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
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

    const userReceipt = await signInLocalAccountSession({
      profile_id: "profile:semantic-admitter-user",
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
        capability_id: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
      }),
    );
    expect(userListing.locked_capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
        locked_reason: "capability_outside_account_policy",
      }),
    );
  });

  it("fails closed before a public provider can submit source content", async () => {
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:semantic-admitter-public-call",
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
        capabilityId: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
        arguments: {
          source_packet: { untrusted: true },
          source_path: "fixtures/untrusted.json",
          receipt_id: "semantic-admission:must-not-run",
        },
        turnId: "ask:test:semantic-admitter-public-block",
      });

    expect(result).toMatchObject({
      ok: false,
      capability_id: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
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

  it("passes the exact turn and authoritative source ledger through the governed gateway", async () => {
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:semantic-admitter-governed-call",
      account_type: "developer",
    });
    const accountContext = await resolveWorkstationGatewayAccountContext(
      receipt.session?.session_id,
    );
    const packet = sourcePacket();
    const result =
      await callAccountAuthorizedWorkstationGatewayCapabilityForProvider({
        accountContext,
        requestedMode: "read",
        requestedRuntime: "codex",
        capabilityId: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
        arguments: {
          source_evidence_ref: SOURCE_EVIDENCE_REF,
          source_packet: packet,
          source_path: SOURCE_PATH,
          receipt_id: "semantic-admission:governed-current-turn",
        },
        turnId: TURN_ID,
        authoritativeEvidenceArtifacts: [
          sourceEvidenceEnvelope({ packet }),
        ],
      });

    expect(result).toMatchObject({
      ok: true,
      capability_id: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
      gateway_admission: {
        admission_status: "admitted",
        admission_reason:
          "canonical_claim_ir_semantically_admitted",
      },
      observation_packet: {
        turn_id: TURN_ID,
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
      observation: {
        status: "succeeded",
        source_evidence_binding: {
          artifact_ref: SOURCE_EVIDENCE_REF,
          turn_id: TURN_ID,
          content_sha256: packetSha256(packet),
        },
        terminal_eligible: false,
        assistant_answer: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
    });
  });

  it("returns typed missing-input evidence without consulting snapshots", async () => {
    const result = await executeTheorySemanticAdmitterGatewayCapability({
      capabilityId: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
      args: {},
      accountType: "developer",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "missing_input",
      admissionStatus: "blocked",
      admissionReason: "semantic_admission_input_missing",
      observation: {
        status: "blocked",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.missingRequirements.map((entry) => entry.code)).toEqual([
      "source_evidence_ref_required",
      "source_packet_required",
      "source_path_required",
      "receipt_id_required",
    ]);
  });

  it("fails closed on a non-serializable authoritative source packet", async () => {
    const cyclic = sourcePacket() as unknown as Record<string, unknown>;
    const cyclicBody = cyclic.body as Record<string, unknown>;
    cyclicBody.self = cyclic;
    const result = await executeSemanticAdmission({
      packet: cyclic,
      authoritativeEvidenceArtifacts: [
        sourceEvidenceEnvelope({
          packet: cyclic,
          contentSha256: "a".repeat(64),
        }),
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      admissionStatus: "blocked",
      admissionReason: "source_evidence_admission_blocked",
      blockedReason: "source_evidence_packet_serialization_failed",
      observation: {
        status: "blocked",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
    });
  });
});

describe("theory semantic admitter exact source-evidence binding", () => {
  it("admits only the exact current-turn packet and emits its bound identity", async () => {
    const packet = sourcePacket();
    const expectedSha256 = packetSha256(packet);
    const result = await executeSemanticAdmission({ packet });

    expect(result).toMatchObject({
      ok: true,
      status: "succeeded",
      admissionStatus: "admitted",
      admissionReason: "canonical_claim_ir_semantically_admitted",
      observation: {
        schema: "casimir.theory_semantic_admitter.observation.v1",
        status: "succeeded",
        source_evidence_ref: SOURCE_EVIDENCE_REF,
        source_evidence_binding: {
          schema:
            "casimir.theory_semantic_admitter.source_evidence_binding.v1",
          authority: "current_turn_authoritative_evidence",
          artifact_ref: SOURCE_EVIDENCE_REF,
          turn_id: TURN_ID,
          source_capability_id: SOURCE_CAPABILITY,
          source_scope: "current_turn_context",
          source_packet_id: packet.sourcePacketId,
          source_path: SOURCE_PATH,
          media_type: SOURCE_MEDIA_TYPE,
          content_sha256: expectedSha256,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        source_packet_id: packet.sourcePacketId,
        source_path: SOURCE_PATH,
        source_media_type: SOURCE_MEDIA_TYPE,
        source_packet_sha256: expectedSha256,
        claim_ir: {
          source: {
            kind: "parsed_surface",
            artifact: {
              path: SOURCE_PATH,
              sha256: expectedSha256,
            },
          },
        },
        output_role: "evidence_for_synthesis",
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("rejects an exact reference from a different turn", async () => {
    await expect(
      executeSemanticAdmission({
        authoritativeEvidenceArtifacts: [
          sourceEvidenceEnvelope({
            turnId: "ask:test:semantic-admitter-stale-turn",
          }),
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      admissionReason: "source_evidence_admission_blocked",
      blockedReason: "source_evidence_turn_mismatch",
      observation: {
        status: "blocked",
        requested_source_evidence_ref: SOURCE_EVIDENCE_REF,
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("rejects a missing or ambiguous exact source reference", async () => {
    await expect(
      executeSemanticAdmission({
        sourceEvidenceRef: `${TURN_ID}:missing-source-packet`,
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockedReason: "source_evidence_not_admitted",
    });

    const duplicate = sourceEvidenceEnvelope();
    await expect(
      executeSemanticAdmission({
        authoritativeEvidenceArtifacts: [
          sourceEvidenceEnvelope(),
          structuredClone(duplicate),
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockedReason: "source_evidence_ambiguous",
    });
  });

  it("rejects an authoritative content digest mismatch", async () => {
    await expect(
      executeSemanticAdmission({
        authoritativeEvidenceArtifacts: [
          sourceEvidenceEnvelope({
            contentSha256: "0".repeat(64),
          }),
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockedReason: "source_evidence_content_hash_mismatch",
      observation: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("rejects a packet identity that disagrees with its evidence envelope", async () => {
    const evidence = sourceEvidenceEnvelope();
    evidence.source_packet_id = "source-packet:substituted";
    await expect(
      executeSemanticAdmission({
        authoritativeEvidenceArtifacts: [evidence],
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockedReason: "source_evidence_packet_identity_mismatch",
      observation: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("rejects inconsistent producer provenance", async () => {
    await expect(
      executeSemanticAdmission({
        authoritativeEvidenceArtifacts: [
          sourceEvidenceEnvelope({
            sourceCapabilityId:
              "research-library.apply_evidence_enrichment",
            capabilityKey: "docs.search",
          }),
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockedReason: "source_evidence_provenance_mismatch",
      observation: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });
});
