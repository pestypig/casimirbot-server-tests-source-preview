import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildHelixLocalSupervisorStatus,
  createHelixLocalSupervisorIdentity,
  helixWorkspaceRefFor,
  resolveHelixLocalSupervisorMode,
} from "../local-supervisor-identity";
import { decideHelixLocalSupervisorAttachment } from
  "../local-supervisor-attachment";

describe("local supervisor identity", () => {
  const signedLauncherEnvironment = (
    workspacePath: string,
    now: Date,
    bootNonce = "launcher_boot_nonce_1234567890",
  ) => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const payload = Buffer.from(JSON.stringify({
      schema: "helix.local_supervisor_ownership_receipt.v1",
      workspace_ref: helixWorkspaceRefFor(workspacePath),
      boot_nonce: bootNonce,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 60_000).toISOString(),
      supervisor_mode: "external_keyed_launcher",
    }), "utf8");
    return {
      CASIMIR_LOCAL_SUPERVISOR_OWNERSHIP_RECEIPT: Buffer.from(JSON.stringify({
        payload: payload.toString("base64url"),
        signature: crypto.sign(null, payload, privateKey).toString("base64url"),
      }), "utf8").toString("base64url"),
      CASIMIR_LOCAL_SUPERVISOR_TRUSTED_PUBLIC_KEYS: publicKey.export({
        type: "spki",
        format: "pem",
      }).toString(),
    };
  };
  it("canonicalizes equivalent Windows workspace paths without exposing them", () => {
    const upper = helixWorkspaceRefFor("C:\\Work\\CasimirBot");
    const lower = helixWorkspaceRefFor("c:/work/casimirbot");
    expect(upper).toBe(lower);
    expect(upper).toMatch(/^workspace:[a-f0-9]{64}$/u);
    expect(upper).not.toContain("casimirbot");
  });

  it("keeps one process identity stable while separating another boot", () => {
    const common = {
      workspacePath: "C:\\Work\\CasimirBot",
      environment: {},
      startedAt: "2026-08-26T12:00:00.000Z",
    };
    const first = createHelixLocalSupervisorIdentity({
      ...common,
      entropy: "first",
    });
    const same = createHelixLocalSupervisorIdentity({
      ...common,
      entropy: "first",
    });
    const second = createHelixLocalSupervisorIdentity({
      ...common,
      entropy: "second",
    });
    expect(first).toEqual(same);
    expect(first.serviceInstanceRef).not.toBe(second.serviceInstanceRef);
    expect(first.workspaceRef).toBe(second.workspaceRef);
  });

  it("binds a signed keyed-launch receipt to exactly one service epoch", () => {
    const workspacePath = "C:\\Work\\CasimirBot";
    const startedAt = new Date("2026-08-26T12:00:00.000Z");
    const environment = signedLauncherEnvironment(workspacePath, startedAt);
    const first = createHelixLocalSupervisorIdentity({
      workspacePath,
      environment,
      startedAt: startedAt.toISOString(),
      entropy: "first-process",
    });
    const replay = createHelixLocalSupervisorIdentity({
      workspacePath,
      environment,
      startedAt: new Date(startedAt.getTime() + 1_000).toISOString(),
      entropy: "second-process",
    });
    const nextBoot = createHelixLocalSupervisorIdentity({
      workspacePath,
      environment: signedLauncherEnvironment(
        workspacePath,
        startedAt,
        "launcher_boot_nonce_0987654321",
      ),
      startedAt: startedAt.toISOString(),
      entropy: "first-process",
    });

    expect(first.supervisorMode).toBe("external_keyed_launcher");
    expect(replay.serviceInstanceRef).toBe(first.serviceInstanceRef);
    expect(nextBoot.serviceInstanceRef).not.toBe(first.serviceInstanceRef);
  });

  it("claims one-instance enforcement only for an enforcing supervisor", () => {
    expect(resolveHelixLocalSupervisorMode({ CASIMIR_DESKTOP_HOST: "1" })).toBe(
      "desktop_single_instance",
    );
    const workspace = "C:\\Work\\CasimirBot";
    const now = new Date("2026-08-26T12:00:00.000Z");
    expect(resolveHelixLocalSupervisorMode(
      signedLauncherEnvironment(workspace, now), workspace, now,
    )).toBe("external_keyed_launcher");
    expect(resolveHelixLocalSupervisorMode({
      CASIMIR_KEYED_LAUNCHER_SUPERVISED: "1",
    }, workspace, now)).toBe("external_process");
    expect(resolveHelixLocalSupervisorMode({})).toBe("external_process");

    const status = buildHelixLocalSupervisorStatus({
      identity: createHelixLocalSupervisorIdentity({
        workspacePath: "C:\\Work\\CasimirBot",
        environment: {},
        startedAt: "2026-08-26T12:00:00.000Z",
        entropy: "unmanaged",
      }),
      ready: true,
    });
    expect(status.one_instance_enforced).toBe(false);
    expect(status.attach_supported).toBe(true);
    expect(status.concurrent_read_admission).toBe("grant_scoped");
    expect(status.mutation_admission).toBe("serialized_execution_lease");
    expect(status.credential_included).toBe(false);
    expect(status.private_endpoint_included).toBe(false);
    expect(status.workspace_path_included).toBe(false);
    expect(status.process_identity_included).toBe(false);
    expect(status.account_identity_included).toBe(false);
    expect(status.answer_authority).toBe(false);
    expect(status.terminal_eligible).toBe(false);
  });

  it("rejects tampered, expired, and wrong-workspace launcher receipts", () => {
    const workspace = "C:\\Work\\CasimirBot";
    const now = new Date("2026-08-26T12:00:00.000Z");
    const valid = signedLauncherEnvironment(workspace, now);
    expect(resolveHelixLocalSupervisorMode(valid, workspace, now)).toBe(
      "external_keyed_launcher",
    );
    expect(resolveHelixLocalSupervisorMode({
      ...valid,
      CASIMIR_LOCAL_SUPERVISOR_OWNERSHIP_RECEIPT:
        `${valid.CASIMIR_LOCAL_SUPERVISOR_OWNERSHIP_RECEIPT.slice(0, -2)}xx`,
    }, workspace, now)).toBe("external_process");
    expect(resolveHelixLocalSupervisorMode(valid, "C:\\Work\\Other", now)).toBe(
      "external_process",
    );
    expect(resolveHelixLocalSupervisorMode(
      valid, workspace, new Date(now.getTime() + 61_000),
    )).toBe("external_process");
  });

  it("attaches only to the exact ready enforcing workspace", () => {
    const identity = createHelixLocalSupervisorIdentity({
      workspacePath: "C:\\Work\\CasimirBot",
      environment: { CASIMIR_DESKTOP_HOST: "1" },
      startedAt: "2026-08-26T12:00:00.000Z",
      entropy: "desktop",
    });
    const status = buildHelixLocalSupervisorStatus({ identity, ready: true });
    expect(decideHelixLocalSupervisorAttachment({
      expectedWorkspaceRef: identity.workspaceRef,
      status,
      listenerPresent: true,
    })).toEqual({
      decision: "attach",
      reason: "compatible_workspace_service",
    });
    expect(decideHelixLocalSupervisorAttachment({
      expectedWorkspaceRef: helixWorkspaceRefFor("C:\\Work\\Other"),
      status,
      listenerPresent: true,
    })).toEqual({ decision: "fail_closed", reason: "workspace_mismatch" });
  });

  it("starts only when no listener exists and never replaces an unknown listener", () => {
    const expectedWorkspaceRef = helixWorkspaceRefFor("C:\\Work\\CasimirBot");
    expect(decideHelixLocalSupervisorAttachment({
      expectedWorkspaceRef,
      status: null,
      listenerPresent: false,
    })).toEqual({ decision: "start", reason: "no_listener" });
    expect(decideHelixLocalSupervisorAttachment({
      expectedWorkspaceRef,
      status: null,
      listenerPresent: true,
    })).toEqual({ decision: "fail_closed", reason: "invalid_status" });
  });

  it("rejects a matching external service without supervisor enforcement", () => {
    const identity = createHelixLocalSupervisorIdentity({
      workspacePath: "C:\\Work\\CasimirBot",
      environment: {},
      startedAt: "2026-08-26T12:00:00.000Z",
      entropy: "plain",
    });
    const status = buildHelixLocalSupervisorStatus({ identity, ready: true });
    expect(decideHelixLocalSupervisorAttachment({
      expectedWorkspaceRef: identity.workspaceRef,
      status,
      listenerPresent: true,
    })).toEqual({ decision: "fail_closed", reason: "supervisor_not_enforcing" });
    expect(status.one_instance_enforced).toBe(false);
    expect(status.content_role).toBe("local_supervisor_status_not_authority");
  });
});
