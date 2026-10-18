import { describe, expect, it } from "vitest";
import type { HelixLocalSupervisorPresence } from "@shared/helix-local-supervisor-coordination";
import { HelixReasoningTaskBindingStore } from "../reasoning-task-binding-store";

// O1 contract fixtures only. These principals never contact the live service.
// Expected failures expose gaps in the legacy store, not passing new behavior.
const fixture = () => {
  let now = new Date("2026-09-08T12:00:00.000Z");
  const target: HelixLocalSupervisorPresence = {
    schema: "helix.local_supervisor_coordination.v1",
    service_instance_ref: "fixture-service", client_session_ref: "fixture-session",
    conversation_thread_ref: "fixture-task", authenticated_profile_ref: "fixture-owner",
    authenticated_mcp_client_ref: "fixture-client", declared_objective_summary: "Pairing test",
    declared_objective_is_verified: false, lifecycle_basis: "authenticated_client_heartbeat",
    lifecycle_state: "active", resource_claims: [], room_ref: null, run_ref: null,
    environment_ref: null, verified_room_identity: null, verified_connector_identity: null,
    verified_retained_runtime_identity: null, verified_execution_lease_identity: null,
    blocker_summary: null, observed_at: now.toISOString(),
    heartbeat_expires_at: new Date(now.getTime() + 180_000).toISOString(), active: true,
    credential_included: false, private_endpoint_included: false, hidden_reasoning_included: false,
    native_account_identity_included: false, content_role: "supervisor_presence_advisory",
    answer_authority: false, assistant_answer: false, terminal_eligible: false,
    raw_content_included: false,
    thread_observability_bridge: {
      supported_levels: ["continuation_ready"], requested_level: "continuation_ready",
      checkpoint_publication: null, declaration_basis: "authenticated_client_declaration",
      provider_thread_content_included: false, hidden_reasoning_included: false,
      answer_authority: false, terminal_eligible: false,
    },
  };
  const store = new HelixReasoningTaskBindingStore({
    serviceInstanceRef: target.service_instance_ref, listPresence: () => [target],
  }, () => now);
  const issue = (expiresInSeconds = 900) => store.issueClaim({
    profileRef: "fixture-owner", clientSessionRef: "fixture-session",
    helixConversationId: "fixture-chat", expiresInSeconds,
  });
  const claim = (claimHandle: string) => store.claim({
    profileRef: "fixture-owner", authenticatedMcpClientRef: "fixture-client",
    clientSessionRef: "fixture-session", claimHandle,
  });
  return { store, issue, claim, target, advance(seconds: number) {
    now = new Date(now.getTime() + seconds * 1000);
    target.active = Date.parse(target.heartbeat_expires_at) > now.getTime();
  } };
};

describe("O1 durable pairing requirements against the legacy store", () => {
  it.fails("honors the approved 15-minute invitation deadline independently of presence", () => {
    const h = fixture();
    expect(h.issue().binding.expires_at).toBe("2026-09-08T12:15:00.000Z");
  });

  it.fails("accepts the exact already-approved invitation after idle exceeds five minutes", () => {
    const h = fixture();
    const issued = h.issue();
    h.advance(301);
    expect(h.target.active).toBe(false);
    expect(h.claim(issued.claim_handle)).toMatchObject({
      status: "active", helix_conversation_id: "fixture-chat",
      reasoning_binding_id: issued.binding.reasoning_binding_id,
      execution_authority: false, answer_authority: false,
    });
  });

  it.fails("reconciles a repeated exact acceptance to the original result", () => {
    const h = fixture();
    const issued = h.issue(120);
    const accepted = h.claim(issued.claim_handle);
    expect(h.claim(issued.claim_handle)).toEqual(accepted);
  });

  it.fails("restores the approved pairing through the current service reconstruction path", () => {
    const h = fixture();
    const accepted = h.claim(h.issue(120).claim_handle);
    // Mirrors server/index.ts: a new service constructs a new binding store.
    // This deliberately exposes the missing persistence integration. O2 must
    // replace reconstruction with its real durable loader, not copy a Map here.
    const restarted = new HelixReasoningTaskBindingStore({
      serviceInstanceRef: "fixture-service-restarted", listPresence: () => [],
    });
    expect(restarted.inspect({ profileRef: "fixture-owner",
      bindingId: accepted.reasoning_binding_id })).toMatchObject({
      reasoning_binding_id: accepted.reasoning_binding_id,
      helix_conversation_id: "fixture-chat", status: "active",
      execution_authority: false,
    });
  });

  it("does not accept an old service handle as proof of durable identity", () => {
    const h = fixture();
    const issued = h.issue(120);
    const restarted = new HelixReasoningTaskBindingStore({
      serviceInstanceRef: "fixture-service-restarted", listPresence: () => [],
    });
    expect(() => restarted.claim({ profileRef: "fixture-owner",
      authenticatedMcpClientRef: "fixture-client", clientSessionRef: "fixture-session",
      claimHandle: issued.claim_handle })).toThrow("reasoning_binding_claim_service_epoch_mismatch");
  });

  it("does not use an expired heartbeat alone to issue a new invitation", () => {
    const h = fixture();
    h.advance(181);
    expect(() => h.issue()).toThrow("reasoning_binding_target_inactive");
  });

  it("does not allow a foreign client to consume the approved invitation", () => {
    const h = fixture();
    const issued = h.issue(120);
    expect(() => h.store.claim({
      profileRef: "fixture-owner", authenticatedMcpClientRef: "foreign-client",
      clientSessionRef: "fixture-session", claimHandle: issued.claim_handle,
    })).toThrow("reasoning_binding_identity_mismatch");
    expect(h.claim(issued.claim_handle).status).toBe("active");
  });
});
