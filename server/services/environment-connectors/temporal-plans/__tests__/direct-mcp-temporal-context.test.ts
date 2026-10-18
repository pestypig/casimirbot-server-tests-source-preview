import { expect, it, vi } from "vitest";
import { createDirectMcpTemporalContext } from "../direct-mcp-temporal-context";

const input = () => ({
  serviceInstanceRef: "service:one", profileRef: "profile:owner",
  authenticatedMcpClientRef: "mcp_client:one", accountSessionId: "session:one",
  roomId: "room:one", runId: "run:one", participantId: "participant:owner",
  authorizationExpiresAt: "2026-09-20T12:00:00.000Z",
  now: () => new Date("2026-09-20T11:00:00.000Z"),
  verifyCurrent: vi.fn().mockResolvedValue(undefined),
});

it("derives stable authenticated-client provenance without claiming a provider thread", async () => {
  const first = createDirectMcpTemporalContext(input());
  const second = createDirectMcpTemporalContext(input());
  expect(first.association).toEqual(second.association);
  expect(first.association).toMatchObject({ kind: "direct_mcp_client",
    profileRef: "profile:owner", roomId: "room:one", runId: "run:one",
    associationEpoch: 1 });
  expect(first.association.associationId).toMatch(/^direct_mcp_context:/);
  expect(first.association.continuationRef).toMatch(/^direct_mcp_session:/);
  await expect(first.verifyAssociation(first.association)).resolves.toBeUndefined();
});

it("changes the context across client session, service, room, run or participant identity", () => {
  const base = createDirectMcpTemporalContext(input()).association.associationId;
  for (const changed of [
    { accountSessionId: "session:other" }, { serviceInstanceRef: "service:other" },
    { roomId: "room:other" }, { runId: "run:other" },
    { participantId: "participant:other" },
  ]) expect(createDirectMcpTemporalContext({ ...input(), ...changed }).association.associationId).not.toBe(base);
});

it("rejects tampered context before reading the current room/run", async () => {
  const options = input();
  const direct = createDirectMcpTemporalContext(options);
  await expect(direct.verifyAssociation({ ...direct.association, runId: "run:other" }))
    .rejects.toThrow("temporal_direct_context_identity_mismatch");
  expect(options.verifyCurrent).not.toHaveBeenCalled();
});

it("rejects expired authorization and current-run loss on revalidation", async () => {
  const options = input();
  let observedAt = new Date("2026-09-20T11:00:00.000Z");
  options.now = () => observedAt;
  const direct = createDirectMcpTemporalContext(options);
  observedAt = new Date("2026-09-20T12:00:00.000Z");
  await expect(direct.verifyAssociation(direct.association))
    .rejects.toThrow("temporal_direct_context_unavailable");
  expect(options.verifyCurrent).not.toHaveBeenCalled();
  const current = input();
  current.verifyCurrent.mockRejectedValue(new Error("direct_mcp_run_unverified"));
  const stale = createDirectMcpTemporalContext(current);
  await expect(stale.verifyAssociation(stale.association)).rejects.toThrow("direct_mcp_run_unverified");
});
