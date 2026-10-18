import { describe, expect, it } from "vitest";

import { getHelixMcpEvidenceCapabilityDescriptor } from "@shared/helix-mcp-evidence-capability-registry";
import { buildHelixMcpEvidenceObservation } from "../observation";

describe("MCP evidence observation builder", () => {
  it("builds stable hashes with unique call identity and immutable authority", () => {
    const descriptor = getHelixMcpEvidenceCapabilityDescriptor("helix_public_ui_catalog");
    expect(descriptor).not.toBeNull();
    const build = (observationRef: string, toolCallRef: string) =>
      buildHelixMcpEvidenceObservation({
        descriptor: descriptor!,
        request: { include_capabilities: true, surface_id: null },
        payload: { controls: 398, capabilities: 40 },
        toolCallRef,
        producerRef: "casimirbot-node:test",
        subjectRefs: ["account-profile:test"],
        summary: "Observed the bounded public UI catalog.",
        payloadSchema: "helix.public_ui_agent_catalog.v1",
        supportRefs: ["public-ui-catalog:revision:1"],
        observedAt: "2026-08-29T12:00:00.000Z",
        observationRefFactory: () => observationRef,
      });

    const first = build("mcp_evidence_observation:test:1", "mcp_tool_call:test:1");
    const second = build("mcp_evidence_observation:test:2", "mcp_tool_call:test:2");
    expect(first.observation_ref).not.toBe(second.observation_ref);
    expect(first.request_fingerprint).toBe(second.request_fingerprint);
    expect(first.provenance.payload_sha256).toBe(second.provenance.payload_sha256);
    expect(first.authority).toEqual({
      assistant_answer: false,
      answer_authority: false,
      agent_executable: false,
      terminal_eligible: false,
      raw_content_included: false,
      reentry_required: true,
    });
  });

  it("rejects non-JSON and reserved payload material before publication", () => {
    const descriptor = getHelixMcpEvidenceCapabilityDescriptor("helix_public_ui_catalog")!;
    expect(() => buildHelixMcpEvidenceObservation({
      descriptor,
      request: {},
      payload: { access_token: "forbidden" },
      producerRef: "casimirbot-node:test",
      summary: "Invalid.",
      payloadSchema: "test.invalid.v1",
    })).toThrow();
    expect(() => buildHelixMcpEvidenceObservation({
      descriptor,
      request: {},
      payload: { invalid: undefined },
      producerRef: "casimirbot-node:test",
      summary: "Invalid.",
      payloadSchema: "test.invalid.v1",
    })).toThrow();
  });
});
