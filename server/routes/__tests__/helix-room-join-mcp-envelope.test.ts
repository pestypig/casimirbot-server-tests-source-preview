import { describe, expect, it } from "vitest";
import { protectedMcpEnvelopeValue } from "../helix-mcp";
import { containsSharedLiveRoomSensitiveValue } from "../../services/shared-live-room-control/sensitive-text";

const invite = `helix_live_${"a".repeat(32)}`;
const envelope = { jsonrpc: "2.0", id: "join", method: "tools/call", params: { name: "helix_room_join",
  arguments: { idempotency_key: "join-request-001", request: { room_id: "shared_realtime_room:test", invite_code: invite } } } };
describe("MCP invitation credential-filter exception", () => {
  it("masks only the strictly validated join field and leaves the actual request untouched", () => {
    const protectedValue = protectedMcpEnvelopeValue(envelope);
    expect(containsSharedLiveRoomSensitiveValue(protectedValue)).toBe(false);
    expect(JSON.stringify(protectedValue)).not.toContain(invite);
    expect(envelope.params.arguments.request.invite_code).toBe(invite);
  });
  it.each([
    { ...envelope, method: "anything-else" },
    { ...envelope, params: { ...envelope.params, name: "helix_room_create" } },
    { ...envelope, params: { ...envelope.params, arguments: { ...envelope.params.arguments, profile_id: "forged" } } },
    { ...envelope, params: { ...envelope.params, arguments: { ...envelope.params.arguments, request: { ...envelope.params.arguments.request, consent: true } } } },
    { ...envelope, params: { ...envelope.params, arguments: { ...envelope.params.arguments, idempotency_key: "short" } } },
    { ...envelope, params: { ...envelope.params, arguments: { ...envelope.params.arguments, idempotency_key: invite } } },
  ])("retains protection for other operations, forged fields and credential-bearing keys %#", value => {
    expect(containsSharedLiveRoomSensitiveValue(protectedMcpEnvelopeValue(value))).toBe(true);
  });
  it("does not exempt unrelated credential fields elsewhere in a batch", () => {
    const result = protectedMcpEnvelopeValue([envelope, { ...envelope, credential: invite }]);
    expect(containsSharedLiveRoomSensitiveValue(result)).toBe(true);
  });
});
