import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDirectMcpTemporalAssociation, revokeDirectMcpTemporalAssociation,
  verifyRegisteredDirectMcpTemporalAssociation } from "../direct-mcp-temporal-registry";

const association = {
  kind: "direct_mcp_client" as const,
  associationId: "direct_mcp_context:registry-test",
  associationEpoch: 1,
  continuationRef: "direct_mcp_session:registry-test",
  profileRef: "profile:test",
  runId: "run:test",
  roomId: "room:test",
  participantId: "participant:test",
};

afterEach(() => {
  revokeDirectMcpTemporalAssociation(association.associationId);
  vi.useRealTimers();
});

describe("direct MCP temporal handoff", () => {
  it("requires exact server-derived identity and revalidates on every read", async () => {
    const verify = vi.fn(async () => {});
    expect(await registerDirectMcpTemporalAssociation({ association, verify })).toBe(true);
    expect(await verifyRegisteredDirectMcpTemporalAssociation(association)).toBe(true);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(await verifyRegisteredDirectMcpTemporalAssociation({ ...association, runId: "other" })).toBe(false);
    expect(await verifyRegisteredDirectMcpTemporalAssociation({ ...association, profileRef: "other" })).toBe(false);
    expect(await registerDirectMcpTemporalAssociation({ association: { ...association, runId: "other" },
      verify: async () => {} })).toBe(false);
    verify.mockRejectedValueOnce(new Error("room revoked"));
    expect(await verifyRegisteredDirectMcpTemporalAssociation(association)).toBe(false);
    revokeDirectMcpTemporalAssociation(association.associationId);
    expect(await verifyRegisteredDirectMcpTemporalAssociation(association)).toBe(false);
  });

  it("expires without reconstructing authority after five minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T00:00:00Z"));
    expect(await registerDirectMcpTemporalAssociation({ association, verify: async () => {} })).toBe(true);
    vi.advanceTimersByTime(5 * 60_000);
    expect(await verifyRegisteredDirectMcpTemporalAssociation(association)).toBe(false);
  });
});
