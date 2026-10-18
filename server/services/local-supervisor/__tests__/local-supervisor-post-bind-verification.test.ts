import { describe, expect, it } from "vitest";
import type { HelixLocalSupervisorStatus } from
  "@shared/helix-local-supervisor";
import {
  buildHelixLocalSupervisorStatus,
  createHelixLocalSupervisorIdentity,
  helixWorkspaceRefFor,
} from "../local-supervisor-identity";
import { selectHelixLocalSupervisorOrigin } from
  "../local-supervisor-origin-selection";
import { verifyHelixLocalSupervisorPostBind } from
  "../local-supervisor-post-bind-verification";
import { signedLauncherEnvironment } from "./ownership-receipt-fixture";

const workspacePath = "C:\\Work\\CasimirBot";
const workspaceRef = helixWorkspaceRefFor(workspacePath);
const origin = "http://127.0.0.1:1523";

const status = (overrides?: {
  ready?: boolean;
  workspacePath?: string;
  supervised?: boolean;
}): HelixLocalSupervisorStatus =>
  buildHelixLocalSupervisorStatus({
    identity: createHelixLocalSupervisorIdentity({
      workspacePath: overrides?.workspacePath ?? workspacePath,
      environment: overrides?.supervised === false
        ? {}
        : signedLauncherEnvironment(overrides?.workspacePath ?? workspacePath),
      startedAt: "2026-08-27T18:00:00.000Z",
      entropy: "post-bind",
    }),
    ready: overrides?.ready ?? true,
  });

const startSelection = () => selectHelixLocalSupervisorOrigin({
  expectedWorkspaceRef: workspaceRef,
  candidates: [
    { origin: "http://127.0.0.1:1522", occupancy: "listener", ownership: "foreign_or_unknown", status: null },
    { origin, occupancy: "free", ownership: "none", status: null },
  ],
});

const verify = (overrides?: Partial<Parameters<
  typeof verifyHelixLocalSupervisorPostBind
>[0]>) => verifyHelixLocalSupervisorPostBind({
  expectedWorkspaceRef: workspaceRef,
  selection: startSelection(),
  observedOrigin: origin,
  atomicBindClaimed: true,
  listenerPresent: true,
  status: status(),
  ...overrides,
});

describe("local supervisor post-bind verification", () => {
  it("verifies the exact enforcing keyed instance after an atomic bind", () => {
    expect(verify()).toMatchObject({
      decision: "ready",
      reason: "bound_instance_verified",
      verified_origin: origin,
      atomic_bind_claimed: true,
      credential_included: false,
      process_identity_included: false,
    });
  });

  it("rejects attach and fail-closed selections as launch claims", () => {
    const attach = selectHelixLocalSupervisorOrigin({
      expectedWorkspaceRef: workspaceRef,
      candidates: [{
        origin,
        occupancy: "listener",
        ownership: "verified_owned",
        status: status(),
      }],
    });
    expect(verify({ selection: attach })).toMatchObject({
      decision: "fail_closed",
      reason: "selection_not_start",
    });
  });

  it("rejects an origin different from the selected origin", () => {
    expect(verify({ observedOrigin: "http://127.0.0.1:1524" })).toMatchObject({
      decision: "fail_closed",
      reason: "selected_origin_mismatch",
    });
  });

  it("requires the launcher's atomic bind claim", () => {
    expect(verify({ atomicBindClaimed: false })).toMatchObject({
      decision: "fail_closed",
      reason: "atomic_bind_not_claimed",
      atomic_bind_claimed: false,
    });
  });

  it("requires a listener with a valid status", () => {
    expect(verify({ listenerPresent: false })).toMatchObject({
      decision: "fail_closed",
      reason: "listener_missing",
    });
    expect(verify({ status: null })).toMatchObject({
      decision: "fail_closed",
      reason: "invalid_status",
    });
  });

  it("rejects the wrong workspace and an unready supervisor", () => {
    expect(verify({ status: status({ workspacePath: "C:\\Work\\Other" }) }))
      .toMatchObject({ decision: "fail_closed", reason: "workspace_mismatch" });
    expect(verify({ status: status({ ready: false }) }))
      .toMatchObject({ decision: "fail_closed", reason: "supervisor_not_ready" });
  });

  it("requires the enforcing external keyed-launcher mode", () => {
    expect(verify({ status: status({ supervised: false }) })).toMatchObject({
      decision: "fail_closed",
      reason: "supervisor_not_enforcing",
    });
  });

  it("rejects status exposure and malformed observed origins", () => {
    const exposed = {
      ...status(),
      process_identity_included: true,
    } as unknown as HelixLocalSupervisorStatus;
    expect(verify({ status: exposed })).toMatchObject({
      decision: "fail_closed",
      reason: "status_exposure_violation",
    });
    expect(() => verify({ observedOrigin: "http://localhost:1523" }))
      .toThrow(/exact loopback origin/u);
  });
});
