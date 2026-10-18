import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixtureJson from "../../../../shared/contracts/__tests__/fixtures/casimir-spec/advection-diffusion.open-world.valid.v1.json";
import {
  CASIMIR_SPEC_LANGUAGE_VERSION,
  unsafeSealCasimirSpecScientificClaimIrV1,
  type BuildCasimirSpecScientificClaimIrV1Input,
  type CasimirSpecScientificClaimIrV1,
} from "../../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import {
  CASIMIR_SPEC_SOURCE_PACKET_ARTIFACT_ID,
  CASIMIR_SPEC_SOURCE_PACKET_SCHEMA_VERSION,
  formatCasimirSpecSourcePacketV1,
  parseCasimirSpecSourcePacketV1,
  type CasimirSpecSourcePacketV1,
} from "../../../../shared/contracts/casimir-spec-source-packet.v1";
import { admitCasimirSpecScientificClaimIrV1 } from "../casimir-spec-semantic-admission";

const fixture = fixtureJson as unknown as CasimirSpecScientificClaimIrV1;

function sourcePacket(): CasimirSpecSourcePacketV1 {
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
  const inputBody = {
    ...body,
    definitions: definitions.map(
      ({ expressionSha256: _expressionSha256, ...definition }) => definition,
    ),
    assumptions: assumptions.map(
      ({ propositionSha256: _propositionSha256, ...assumption }) => assumption,
    ),
    axiomLedger: {
      ...axiomLedger,
      entries: axiomLedger.entries.map(
        ({ typeExpressionSha256: _typeExpressionSha256, ...axiom }) => axiom,
      ),
    },
    claims: claims.map(
      ({ propositionSha256: _propositionSha256, ...claim }) => claim,
    ),
  } as Omit<BuildCasimirSpecScientificClaimIrV1Input, "generatedAt" | "source">;
  return {
    artifactId: CASIMIR_SPEC_SOURCE_PACKET_ARTIFACT_ID,
    schemaVersion: CASIMIR_SPEC_SOURCE_PACKET_SCHEMA_VERSION,
    languageVersion: CASIMIR_SPEC_LANGUAGE_VERSION,
    sourcePacketId: "source-packet:advection-diffusion-public-fixture",
    body: inputBody,
  };
}

describe("Casimir Spec deterministic source parsing and semantic admission", () => {
  it("round-trips canonical source bytes into the sole canonical claim IR", async () => {
    const sourceText = formatCasimirSpecSourcePacketV1(sourcePacket());
    const parseInput = {
      sourceText,
      sourcePath:
        "fixtures/casimir-spec/advection-diffusion.source-packet.v1.json",
      generatedAt: "2026-07-25T20:00:00.000Z",
    };
    const first = await parseCasimirSpecSourcePacketV1(parseInput);
    const second = await parseCasimirSpecSourcePacketV1(parseInput);

    expect(first.status).toBe("parsed");
    expect(second).toEqual(first);
    if (first.status !== "parsed") throw new Error("expected parsed result");
    expect(first.sourcePacketSha256).toBe(
      createHash("sha256").update(sourceText).digest("hex"),
    );
    expect(first.claimIr.schemaVersion).toBe(
      "casimir_spec_scientific_claim_ir/v1",
    );
    expect(first.claimIr.source.kind).toBe("parsed_surface");
    expect(first.claimIr.source.artifact.sha256).toBe(first.sourcePacketSha256);
    expect(first.claimIr.claimBoundary.semanticIdentityAuthority).toBe(false);
  });

  it("fails closed on noncanonical bytes, competing body fields, and unresolved ambiguity", async () => {
    const packet = sourcePacket();
    const canonical = formatCasimirSpecSourcePacketV1(packet);
    const noncanonical = await parseCasimirSpecSourcePacketV1({
      sourceText: ` ${canonical}`,
      sourcePath: "fixtures/noncanonical.json",
      generatedAt: "2026-07-25T20:00:00.000Z",
    });
    expect(noncanonical.status).toBe("blocked");
    expect(noncanonical.issues.map((issue) => issue.code)).toContain(
      "source_not_canonical",
    );

    const competing = structuredClone(packet) as unknown as Record<string, any>;
    competing.body.source = fixture.source;
    const competingResult = await parseCasimirSpecSourcePacketV1({
      sourceText: formatCasimirSpecSourcePacketV1(
        competing as CasimirSpecSourcePacketV1,
      ),
      sourcePath: "fixtures/competing-definition.json",
      generatedAt: "2026-07-25T20:00:00.000Z",
    });
    expect(competingResult.status).toBe("blocked");
    expect(competingResult.issues.map((issue) => issue.code)).toContain(
      "source_packet_body_shape_invalid",
    );

    const ambiguous = structuredClone(packet);
    ambiguous.body.symbols[0].unitBinding = {
      status: "unresolved",
      unit: null,
      dimensions: null,
    };
    const ambiguousResult = await parseCasimirSpecSourcePacketV1({
      sourceText: formatCasimirSpecSourcePacketV1(ambiguous),
      sourcePath: "fixtures/ambiguous-unit.json",
      generatedAt: "2026-07-25T20:00:00.000Z",
    });
    expect(ambiguousResult.status).toBe("blocked");
    expect(ambiguousResult.issues[0]?.detail).toContain(
      "observable_symbol_unit_mismatch",
    );
  });

  it("admits only snapshot-bound semantics and preserves declared blockers", async () => {
    const receipt = await admitCasimirSpecScientificClaimIrV1({
      claimIr: structuredClone(fixture),
      generatedAt: "2026-07-25T20:01:00.000Z",
      receiptId: "semantic-admission:advection-diffusion-public-fixture",
      catalogSnapshots: [],
      registeredIdentityBindings: [],
      graphSnapshot: null,
    });

    expect(receipt.disposition).toBe("admitted_with_declared_blockers");
    expect(receipt.issues).toEqual([]);
    expect(receipt.declaredBlockerIds).toEqual([
      "blocker:boundary-conditions",
      "blocker:formal-environment",
      "blocker:proof-not-run",
    ]);
    expect(receipt.claimBoundary.semanticIntentAuthority).toBe(false);
    expect(receipt.claimBoundary.physicalTruthAuthority).toBe(false);
    expect(receipt.claimBoundary.terminalEligible).toBe(false);
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects hash tampering and invalid core-operator arity", async () => {
    const tampered = structuredClone(fixture);
    tampered.semanticSha256 = "0".repeat(64);
    const tamperedReceipt = await admitCasimirSpecScientificClaimIrV1({
      claimIr: tampered,
      generatedAt: "2026-07-25T20:02:00.000Z",
      receiptId: "semantic-admission:tampered",
      catalogSnapshots: [],
      registeredIdentityBindings: [],
      graphSnapshot: null,
    });
    expect(tamperedReceipt.disposition).toBe("rejected");
    expect(tamperedReceipt.issues.map((issue) => issue.code)).toContain(
      "claim_ir_integrity_invalid",
    );

    const badArity = structuredClone(fixture);
    const proposition = badArity.claims[0].proposition;
    if (proposition.kind !== "apply") {
      throw new Error("fixture claim must use an apply expression");
    }
    proposition.arguments = proposition.arguments.slice(0, 1);
    const resealed = await unsafeSealCasimirSpecScientificClaimIrV1(badArity);
    const arityReceipt = await admitCasimirSpecScientificClaimIrV1({
      claimIr: resealed,
      generatedAt: "2026-07-25T20:03:00.000Z",
      receiptId: "semantic-admission:arity",
      catalogSnapshots: [],
      registeredIdentityBindings: [],
      graphSnapshot: null,
    });
    expect(arityReceipt.disposition).toBe("rejected");
    expect(arityReceipt.issues.map((issue) => issue.code)).toContain(
      "operator_arity_invalid",
    );
  });

  it("rejects a structurally valid but dimensionally inconsistent equation", async () => {
    const inconsistent = structuredClone(fixture);
    const velocity = inconsistent.symbols.find(
      (symbol) => symbol.symbolId === "symbol:velocity",
    );
    if (
      !velocity ||
      (velocity.unitBinding.status !== "specified" &&
        velocity.unitBinding.status !== "dimensionless")
    ) {
      throw new Error("fixture velocity must have dimensions");
    }
    velocity.unitBinding.dimensions = {
      ...velocity.unitBinding.dimensions,
      length: "0",
    };
    const resealed =
      await unsafeSealCasimirSpecScientificClaimIrV1(inconsistent);
    const receipt = await admitCasimirSpecScientificClaimIrV1({
      claimIr: resealed,
      generatedAt: "2026-07-25T20:04:00.000Z",
      receiptId: "semantic-admission:dimension-mismatch",
      catalogSnapshots: [],
      registeredIdentityBindings: [],
      graphSnapshot: null,
    });

    expect(receipt.disposition).toBe("rejected");
    expect(receipt.issues.map((issue) => issue.code)).toContain(
      "dimension_equation_mismatch",
    );
  });

  it("rejects a core equation that silently combines distinct bound frames", async () => {
    const inconsistent = structuredClone(fixture);
    const labFrame = inconsistent.definitions.find(
      (definition) => definition.definitionId === "definition:lab-frame",
    );
    const velocity = inconsistent.symbols.find(
      (symbol) => symbol.symbolId === "symbol:velocity",
    );
    if (!labFrame || !velocity) throw new Error("fixture frame drift");
    inconsistent.definitions.push({
      ...structuredClone(labFrame),
      definitionId: "definition:other-frame",
      name: "other_frame",
      display: "Independent comparison frame",
    });
    inconsistent.definitions.sort((left, right) =>
      left.definitionId.localeCompare(right.definitionId),
    );
    velocity.frameBinding = {
      status: "bound",
      frameDefinitionId: "definition:other-frame",
    };
    inconsistent.claims[0].definitionIds.push("definition:other-frame");
    inconsistent.claims[0].definitionIds.sort();

    const resealed =
      await unsafeSealCasimirSpecScientificClaimIrV1(inconsistent);
    const receipt = await admitCasimirSpecScientificClaimIrV1({
      claimIr: resealed,
      generatedAt: "2026-07-25T20:05:00.000Z",
      receiptId: "semantic-admission:frame-mismatch",
      catalogSnapshots: [],
      registeredIdentityBindings: [],
      graphSnapshot: null,
    });

    expect(receipt.disposition).toBe("rejected");
    expect(receipt.issues.map((issue) => issue.code)).toContain(
      "frame_equation_mismatch",
    );
  });
});
