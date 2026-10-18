import { describe, expect, it, vi } from "vitest";
import { HelixReasoningTaskBindingStore } from "../reasoning-task-binding-store";
import { acceptPairingLedgerRow, createPairingLedgerRow, pairingApprovalSchema, revokePairingLedgerRow } from "../pairing-ledger-contract";
import type { HelixLocalSupervisorPresence } from "@shared/helix-local-supervisor-coordination";

const destination = { issuer: "fixture-issuer", profileId: "fixture-owner", installationId: "fixture-device",
  clientId: "fixture-client", taskId: "fixture-task" };
const start = new Date("2026-09-08T12:00:00Z");
function fixture() {
  let now = start;
  const entries: HelixLocalSupervisorPresence[] = [];
  let row = acceptPairingLedgerRow(createPairingLedgerRow({ id: "fixture-pairing", requestDigest: "a".repeat(64),
    acceptanceSecretDigest: "b".repeat(64), consentReceiptId: "fixture-human-consent",
    approval: pairingApprovalSchema.parse({ destination, chatId: "fixture-chat", environment: null,
      scope: "exact_chat_steering", policyRevision: 1 }) }, start), destination, start);
  const readAccepted = vi.fn(async () => row);
  const store = new HelixReasoningTaskBindingStore({ serviceInstanceRef: "fixture-service", listPresence: () => entries }, () => now);
  const input = { destination, clientSessionRef: "fixture-session", readAccepted };
  return { store, input, readAccepted, entries, row: () => row,
    advance: (seconds: number) => { now = new Date(now.getTime() + seconds * 1000); },
    expire: () => { now = new Date(row.pairingExpiresAt); },
    revoke: () => { row = revokePairingLedgerRow(row, destination.profileId, now); } };
}

describe("durable runtime binding preflight", () => {
  // Restart invariants now run through DurableReasoningBindingAccess in
  // durable-steering-repository.test.ts and independent-process snapshot tests.
  it("requires fresh admission for every operation and preserves same-session dedupe", async () => {
    const h = fixture();
    const binding = await h.store.withAcceptedPairing(h.input, value => value);
    const request = { profileRef: destination.profileId, bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch, clientEventRef: "fixture-event", origin: "typed" as const,
      instructionText: "Please inspect the surroundings." };
    expect(binding).toMatchObject({ continuation_transport: "polling", negotiated_observability_level: "tool_activity_only", execution_authority: false,
      pairing_id: h.row().id,
      expires_at: h.row().pairingExpiresAt });
    expect(() => h.store.dispatch(request)).toThrow("reasoning_binding_durable_preflight_required");
    const event = await h.store.withAcceptedPairing(h.input, () => h.store.dispatch(request));
    expect(await h.store.withAcceptedPairing(h.input, () => h.store.dispatch(request))).toEqual(event);
    expect(h.readAccepted).toHaveBeenCalledTimes(3);
    expect(() => h.store.inspect({ profileRef: destination.profileId, bindingId: binding.reasoning_binding_id }))
      .toThrow("reasoning_binding_durable_preflight_required");
    h.revoke();
    await expect(h.store.withAcceptedPairing(h.input, () => h.store.dispatch(request))).rejects.toThrow("pairing_revoked");
  });

  it("admits accepted MCP polling without claiming checkpoints, and still requires fresh exact-task presence", async () => {
    const h = fixture();
    const binding = await h.store.withAcceptedPairing(h.input, value => value);
    const association = { profileRef: destination.profileId, authenticatedMcpClientRef: destination.clientId,
      clientSessionRef: h.input.clientSessionRef, clientContinuationRef: destination.taskId,
      bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
      helixConversationId: "fixture-chat", missionId: null, runId: null };
    const verify = () => h.store.withAcceptedPairing(h.input, () => h.store.verifyTaskAssociation(association));
    await expect(verify()).rejects.toThrow("reasoning_binding_target_inactive");
    h.entries.push({
      schema: "helix.local_supervisor_coordination.v1", service_instance_ref: "fixture-service",
      client_session_ref: h.input.clientSessionRef, conversation_thread_ref: destination.taskId,
      authenticated_profile_ref: destination.profileId, authenticated_mcp_client_ref: destination.clientId,
      declared_objective_summary: "Poll exact approved steering", declared_objective_is_verified: false,
      lifecycle_basis: "authenticated_client_heartbeat", lifecycle_state: "active",
      thread_observability_bridge: { supported_levels: ["tool_activity_only"], requested_level: "tool_activity_only",
        checkpoint_publication: null, declaration_basis: "authenticated_client_declaration", provider_thread_content_included: false,
        hidden_reasoning_included: false, answer_authority: false, terminal_eligible: false },
      resource_claims: [], room_ref: null, environment_ref: null, run_ref: null,
      verified_room_identity: null, verified_connector_identity: null, verified_retained_runtime_identity: null,
      verified_execution_lease_identity: null, blocker_summary: null, observed_at: start.toISOString(),
      heartbeat_expires_at: new Date(start.getTime() + 180000).toISOString(), active: true,
      credential_included: false, private_endpoint_included: false, hidden_reasoning_included: false,
      native_account_identity_included: false, content_role: "supervisor_presence_advisory", answer_authority: false,
      assistant_answer: false, terminal_eligible: false, raw_content_included: false,
    });
    await expect(verify()).resolves.toMatchObject({ continuation_transport: "polling", negotiated_observability_level: "tool_activity_only" });
    h.entries[0].conversation_thread_ref = "fixture-foreign-task";
    await expect(verify()).rejects.toThrow("reasoning_binding_target_inactive");
    h.entries[0].conversation_thread_ref = destination.taskId;
    h.advance(180);
    await expect(verify()).rejects.toThrow("reasoning_binding_target_inactive");
    expect(await h.store.withAcceptedPairing(h.input, value => value)).toMatchObject({
      pairing_id: h.row().id, expires_at: h.row().pairingExpiresAt, continuation_transport: "polling" });
  });

  it("rejects wrong destinations, missing durable evidence and exact grant expiry", async () => {
    const h = fixture();
    for (const key of Object.keys(destination)) {
      await expect(h.store.withAcceptedPairing({ ...h.input, destination: { ...destination, [key]: "fixture-foreign" } }, x => x))
        .rejects.toThrow("pairing_destination_mismatch");
    }
    await expect(h.store.withAcceptedPairing({ ...h.input, readAccepted: async () => { throw new Error("fixture-disk-unavailable"); } }, x => x))
      .rejects.toThrow("fixture-disk-unavailable");
    h.expire();
    await expect(h.store.withAcceptedPairing(h.input, x => x)).rejects.toThrow("pairing_expired");
  });

  it("changes the transient binding identity on service replacement without extending consent", async () => {
    const h = fixture();
    const before = await h.store.withAcceptedPairing(h.input, x => x);
    const replacement = new HelixReasoningTaskBindingStore({ serviceInstanceRef: "fixture-replacement", listPresence: () => [] }, () => start);
    const after = await replacement.withAcceptedPairing({ ...h.input, clientSessionRef: "fixture-new-session" }, x => x);
    expect(after.reasoning_binding_id).not.toBe(before.reasoning_binding_id);
    expect(after.expires_at).toBe(before.expires_at);
    expect(after.pairing_id).toBe(before.pairing_id);
    expect(() => replacement.inspect({ profileRef: destination.profileId, bindingId: before.reasoning_binding_id }))
      .toThrow("reasoning_binding_not_found");
  });
});
