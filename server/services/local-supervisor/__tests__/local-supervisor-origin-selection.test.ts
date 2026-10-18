import { describe, expect, it } from "vitest";
import {
  buildHelixLocalSupervisorStatus,
  createHelixLocalSupervisorIdentity,
  helixWorkspaceRefFor,
} from "../local-supervisor-identity";
import { selectHelixLocalSupervisorOrigin } from
  "../local-supervisor-origin-selection";
import { signedLauncherEnvironment } from "./ownership-receipt-fixture";

const workspacePath = "C:\\Work\\CasimirBot";
const workspaceRef = helixWorkspaceRefFor(workspacePath);
const ownedStatus = (overrides?: { ready?: boolean; workspacePath?: string }) =>
  buildHelixLocalSupervisorStatus({
    identity: createHelixLocalSupervisorIdentity({
      workspacePath: overrides?.workspacePath ?? workspacePath,
      environment: signedLauncherEnvironment(
        overrides?.workspacePath ?? workspacePath,
      ),
      startedAt: "2026-08-27T18:00:00.000Z",
      entropy: "owned",
    }),
    ready: overrides?.ready ?? true,
  });

describe("local supervisor origin selection", () => {
  it("attaches to one exact launcher-verified owned instance", () => {
    const result = selectHelixLocalSupervisorOrigin({
      expectedWorkspaceRef: workspaceRef,
      candidates: [
        { origin: "http://127.0.0.1:1522", occupancy: "listener", ownership: "verified_owned", status: ownedStatus() },
        { origin: "http://127.0.0.1:1523", occupancy: "free", ownership: "none", status: null },
      ],
    });
    expect(result).toMatchObject({
      decision: "attach",
      reason: "verified_owned_instance_ready",
      selected_origin: "http://127.0.0.1:1522",
    });
  });

  it("selects the preferred free origin", () => {
    const result = selectHelixLocalSupervisorOrigin({
      expectedWorkspaceRef: workspaceRef,
      candidates: [
        { origin: "http://127.0.0.1:1522", occupancy: "free", ownership: "none", status: null },
        { origin: "http://127.0.0.1:1523", occupancy: "free", ownership: "none", status: null },
      ],
    });
    expect(result).toMatchObject({
      decision: "start",
      reason: "free_loopback_origin",
      selected_origin: "http://127.0.0.1:1522",
    });
  });

  it("skips a foreign preferred listener and selects the next free origin", () => {
    const result = selectHelixLocalSupervisorOrigin({
      expectedWorkspaceRef: workspaceRef,
      candidates: [
        { origin: "http://127.0.0.1:1522", occupancy: "listener", ownership: "foreign_or_unknown", status: null },
        { origin: "http://127.0.0.1:1523", occupancy: "free", ownership: "none", status: null },
      ],
    });
    expect(result).toMatchObject({
      decision: "start",
      reason: "foreign_listener_skipped",
      selected_origin: "http://127.0.0.1:1523",
      foreign_or_unknown_listener_count: 1,
    });
    expect(result.process_identity_included).toBe(false);
    expect(result.credential_included).toBe(false);
  });

  it("fails closed for contradictory verified ownership", () => {
    for (const status of [
      ownedStatus({ ready: false }),
      ownedStatus({ workspacePath: "C:\\Work\\Other" }),
    ]) {
      const result = selectHelixLocalSupervisorOrigin({
        expectedWorkspaceRef: workspaceRef,
        candidates: [
          { origin: "http://127.0.0.1:1522", occupancy: "listener", ownership: "verified_owned", status },
          { origin: "http://127.0.0.1:1523", occupancy: "free", ownership: "none", status: null },
        ],
      });
      expect(result).toMatchObject({
        decision: "fail_closed",
        reason: "verified_ownership_contradiction",
        selected_origin: null,
      });
    }
  });

  it("fails closed when two owned instances are simultaneously verified", () => {
    const result = selectHelixLocalSupervisorOrigin({
      expectedWorkspaceRef: workspaceRef,
      candidates: [1522, 1523].map((port) => ({
        origin: `http://127.0.0.1:${port}`,
        occupancy: "listener" as const,
        ownership: "verified_owned" as const,
        status: ownedStatus(),
      })),
    });
    expect(result).toMatchObject({
      decision: "fail_closed",
      reason: "multiple_verified_owned_instances",
      selected_origin: null,
    });
  });

  it("reports exhaustion without mutating an occupied candidate", () => {
    const result = selectHelixLocalSupervisorOrigin({
      expectedWorkspaceRef: workspaceRef,
      candidates: [
        { origin: "http://127.0.0.1:1522", occupancy: "listener", ownership: "foreign_or_unknown", status: null },
      ],
    });
    expect(result).toMatchObject({
      decision: "fail_closed",
      reason: "candidate_origins_exhausted",
      selected_origin: null,
      atomic_bind_claim_required: true,
      post_start_status_verification_required: true,
    });
  });

  it("rejects invalid, duplicate, credential-bearing, and excessive candidates", () => {
    const candidate = (origin: string) => ({
      origin,
      occupancy: "free" as const,
      ownership: "none" as const,
      status: null,
    });
    for (const origin of [
      "http://localhost:1522",
      "https://127.0.0.1:1522",
      "http://user:pass@127.0.0.1:1522",
      "http://127.0.0.1:1522/path",
      "http://127.0.0.1:80",
    ]) {
      expect(() => selectHelixLocalSupervisorOrigin({
        expectedWorkspaceRef: workspaceRef,
        candidates: [candidate(origin)],
      })).toThrow();
    }
    expect(() => selectHelixLocalSupervisorOrigin({
      expectedWorkspaceRef: workspaceRef,
      candidates: [candidate("http://127.0.0.1:1522"), candidate("http://127.0.0.1:1522")],
    })).toThrow(/unique/u);
    expect(() => selectHelixLocalSupervisorOrigin({
      expectedWorkspaceRef: workspaceRef,
      candidates: Array.from({ length: 17 }, (_, index) =>
        candidate(`http://127.0.0.1:${2000 + index}`)),
    })).toThrow(/1-16/u);
  });
});
