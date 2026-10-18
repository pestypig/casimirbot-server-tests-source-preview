import { describe, expect, it, vi } from "vitest";
import {
  buildHelixLocalSupervisorStatus,
  createHelixLocalSupervisorIdentity,
  helixWorkspaceRefFor,
} from "../local-supervisor-identity";
import {
  runHelixLocalSupervisorLaunchOrchestration,
  type HelixLocalSupervisorLaunchAdapter,
} from "../local-supervisor-launch-orchestration";
import { signedLauncherEnvironment } from "./ownership-receipt-fixture";

const workspacePath = "C:\\Work\\CasimirBot";
const workspaceRef = helixWorkspaceRefFor(workspacePath);
const preferred = "http://127.0.0.1:1522";
const alternate = "http://127.0.0.1:1523";

const status = (overrides?: { workspacePath?: string; ready?: boolean }) =>
  buildHelixLocalSupervisorStatus({
    identity: createHelixLocalSupervisorIdentity({
      workspacePath: overrides?.workspacePath ?? workspacePath,
      environment: signedLauncherEnvironment(
        overrides?.workspacePath ?? workspacePath,
      ),
      startedAt: "2026-08-27T18:00:00.000Z",
      entropy: overrides?.workspacePath ?? "orchestrated",
    }),
    ready: overrides?.ready ?? true,
  });

const run = (adapter: HelixLocalSupervisorLaunchAdapter, overrides?: {
  candidateOrigins?: string[];
  deadlineMs?: number;
}) => runHelixLocalSupervisorLaunchOrchestration({
  expectedWorkspaceRef: workspaceRef,
  candidateOrigins: overrides?.candidateOrigins ?? [preferred, alternate],
  deadlineMs: overrides?.deadlineMs ?? 2_000,
  adapter,
});

const collisionAdapter = (startProtected: HelixLocalSupervisorLaunchAdapter[
  "startProtected"
]): HelixLocalSupervisorLaunchAdapter => ({
  inspectCandidate: vi.fn(async (origin) => origin === preferred
    ? { occupancy: "listener", ownership: "foreign_or_unknown", status: null }
    : { occupancy: "free", ownership: "none", status: null }),
  startProtected,
});

describe("local supervisor launch orchestration", () => {
  it("attaches to the exact verified owned enforcing instance without starting", async () => {
    const startProtected = vi.fn();
    const result = await run({
      inspectCandidate: vi.fn(async (origin) => origin === preferred
        ? { occupancy: "listener", ownership: "verified_owned", status: status() }
        : { occupancy: "free", ownership: "none", status: null }),
      startProtected,
    });
    expect(result).toMatchObject({
      decision: "attached",
      reason: "verified_owned_instance_attached",
      selected_origin: preferred,
      retryable: false,
    });
    expect(startProtected).not.toHaveBeenCalled();
  });

  it("skips a foreign collision and starts the verified alternate instance", async () => {
    const startProtected = vi.fn(async (selection) => ({
      observedOrigin: selection.selected_origin!,
      atomicBindClaimed: true,
      listenerPresent: true,
      status: status(),
    }));
    const result = await run(collisionAdapter(startProtected));
    expect(result).toMatchObject({
      decision: "started",
      settled_stage: "complete",
      reason: "bound_instance_started",
      selected_origin: alternate,
      retryable: false,
      credential_included: false,
      process_identity_included: false,
    });
    expect(startProtected).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the protected start operation crashes", async () => {
    const result = await run(collisionAdapter(vi.fn(async () => {
      throw new Error("secret-bearing internal failure");
    })));
    expect(result).toMatchObject({
      decision: "fail_closed",
      settled_stage: "protected_start",
      reason: "protected_start_failed",
      selected_origin: null,
      service_instance_ref: null,
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret-bearing");
  });

  it("fails closed when post-bind status is stale or belongs to another workspace", async () => {
    for (const observedStatus of [
      status({ ready: false }),
      status({ workspacePath: "C:\\Work\\Other" }),
    ]) {
      const result = await run(collisionAdapter(vi.fn(async () => ({
        observedOrigin: alternate,
        atomicBindClaimed: true,
        listenerPresent: true,
        status: observedStatus,
      }))));
      expect(result).toMatchObject({
        decision: "fail_closed",
        settled_stage: "post_bind",
        reason: "post_bind_verification_failed",
        selected_origin: null,
        service_instance_ref: null,
      });
    }
  });

  it("fails closed without starting when every candidate is occupied", async () => {
    const startProtected = vi.fn();
    const result = await run({
      inspectCandidate: vi.fn(async () => ({
        occupancy: "listener",
        ownership: "foreign_or_unknown",
        status: null,
      })),
      startProtected,
    });
    expect(result).toMatchObject({
      decision: "fail_closed",
      settled_stage: "selection",
      reason: "selection_failed_closed",
      retryable: true,
    });
    expect(startProtected).not.toHaveBeenCalled();
  });

  it("sanitizes candidate inspection failures", async () => {
    const result = await run({
      inspectCandidate: vi.fn(async () => {
        throw new Error("private inspection details");
      }),
      startProtected: vi.fn(),
    });
    expect(result).toMatchObject({
      decision: "fail_closed",
      settled_stage: "inspection",
      reason: "candidate_inspection_failed",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("private inspection details");
  });

  it("settles with a typed deadline instead of waiting on a hung adapter", async () => {
    const result = await run({
      inspectCandidate: vi.fn(async () => await new Promise(() => undefined)),
      startProtected: vi.fn(),
    }, { candidateOrigins: [alternate], deadlineMs: 100 });
    expect(result).toMatchObject({
      decision: "fail_closed",
      settled_stage: "inspection",
      reason: "orchestration_deadline_exceeded",
      retryable: true,
    });
  });

  it("allows a later explicit retry to recover without replaying the failed start", async () => {
    const firstStart = vi.fn(async () => {
      throw new Error("transient start failure");
    });
    const first = await run(collisionAdapter(firstStart));
    expect(first.decision).toBe("fail_closed");

    const secondStart = vi.fn(async (selection) => ({
      observedOrigin: selection.selected_origin!,
      atomicBindClaimed: true,
      listenerPresent: true,
      status: status(),
    }));
    const second = await run(collisionAdapter(secondStart));
    expect(second).toMatchObject({
      decision: "started",
      selected_origin: alternate,
    });
    expect(firstStart).toHaveBeenCalledTimes(1);
    expect(secondStart).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed candidates before invoking the protected adapter", async () => {
    const inspectCandidate = vi.fn();
    await expect(run({ inspectCandidate, startProtected: vi.fn() }, {
      candidateOrigins: ["http://localhost:1523"],
    })).rejects.toThrow(/exact loopback origins/u);
    expect(inspectCandidate).not.toHaveBeenCalled();
  });
});
