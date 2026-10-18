import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  buildLocalSupervisorCoordinationSnapshot,
  createLocalSupervisorCoordinationRouter,
} from
  "../local-supervisor-coordination";
import { HelixLocalSupervisorCoordinationStore } from
  "../../services/local-supervisor/local-supervisor-coordination";

const SERVICE = "service_instance:0123456789abcdef0123456789abcdef";

vi.mock("../agi.realtime-room/http-context", () => ({
  requireSharedRoomAccount: vi.fn(async (req: express.Request) => ({
    sessionId: req.get("x-test-session") ?? "session:missing",
    profileId: req.get("x-test-profile") ?? "profile:missing",
    displayName: "Test profile",
    isGuest: false,
  })),
}));

describe("local supervisor coordination snapshot", () => {
  it("projects declared occupations and verified relay recommendations without private session state", () => {
    const store = new HelixLocalSupervisorCoordinationStore(
      SERVICE,
      () => new Date("2026-08-27T16:00:00.000Z"),
      ({ authenticatedProfileRef, resourceRef, claimClass }) =>
        authenticatedProfileRef === "profile:owner" &&
        resourceRef === "runtime:keyed" &&
        claimClass === "retained_runtime"
          ? { verificationRef: "resource_verification:keyed-owner" }
          : null,
    );
    store.registerOrHeartbeat({
      profileRef: "profile:owner",
      accountSessionId: "private-session-owner",
      presence: {
        client_session_ref: "client:owner",
        conversation_thread_ref: "thread:c0",
        declared_objective_summary: "Run the C0 fixture",
        lifecycle_state: "active",
        resource_claims: [{
          resource_ref: "runtime:keyed",
          claim_class: "retained_runtime",
        }],
        heartbeat_ttl_seconds: 60,
      },
    });
    store.registerOrHeartbeat({
      profileRef: "profile:member",
      accountSessionId: "private-session-member",
      presence: {
        client_session_ref: "client:member",
        conversation_thread_ref: "thread:m1",
        declared_objective_summary: "Wait for the shared harness",
        lifecycle_state: "waiting",
        resource_claims: [{
          resource_ref: "runtime:keyed",
          claim_class: "mutation_lease_wait",
        }],
        heartbeat_ttl_seconds: 60,
      },
    });

    const snapshot = buildLocalSupervisorCoordinationSnapshot({
      serviceInstanceRef: SERVICE,
      store,
    });
    expect(snapshot).toMatchObject({
      service_instance_ref: SERVICE,
      presence: [{
        client_session_ref: "client:member",
        declared_objective_summary: "Wait for the shared harness",
        declared_objective_is_verified: false,
      }, {
        client_session_ref: "client:owner",
        declared_objective_summary: "Run the C0 fixture",
        declared_objective_is_verified: false,
        resource_claims: [{
          claim_basis: "server_verified",
          verification_ref: "resource_verification:keyed-owner",
          collision_authority: true,
        }],
      }],
      relay_recommendations: [{
        source_client_session_ref: "client:member",
        target_client_session_ref: "client:owner",
        recommended_relay_type: "handoff_request",
        automatically_published: false,
      }],
      answer_authority: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("private-session-owner");
    expect(serialized).not.toContain("private-session-member");
  });
});

describe("local supervisor coordination route admission", () => {
  it("requires the requesting account to own the exact registered client session", async () => {
    const store = new HelixLocalSupervisorCoordinationStore(SERVICE);
    store.registerOrHeartbeat({
      profileRef: "profile:owner",
      accountSessionId: "session:owner",
      presence: {
        client_session_ref: "client:owner",
        conversation_thread_ref: "thread:owner",
        declared_objective_summary: "Observe coordination",
        lifecycle_state: "active",
        resource_claims: [],
        heartbeat_ttl_seconds: 60,
      },
    });
    const app = express();
    app.use("/api/local-supervisor", createLocalSupervisorCoordinationRouter({
      serviceInstanceRef: SERVICE,
      store,
    }));

    await request(app)
      .get("/api/local-supervisor/coordination")
      .set("x-test-profile", "profile:owner")
      .set("x-test-session", "session:owner")
      .expect(404)
      .expect(({ body }) => {
        expect(body.error).toBe("supervisor_client_not_registered");
      });
    await request(app)
      .get("/api/local-supervisor/coordination?client_session_ref=client:owner")
      .set("x-test-profile", "profile:owner")
      .set("x-test-session", "session:wrong")
      .expect(403)
      .expect(({ body }) => {
        expect(body.error).toBe("supervisor_client_identity_mismatch");
      });
    await request(app)
      .get("/api/local-supervisor/coordination?client_session_ref=client:owner")
      .set("x-test-profile", "profile:owner")
      .set("x-test-session", "session:owner")
      .expect(200)
      .expect(({ body }) => {
        expect(body.presence).toHaveLength(1);
        expect(body.presence[0].client_session_ref).toBe("client:owner");
      });
  });
});
