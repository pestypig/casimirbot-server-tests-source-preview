import { describe, expect, it } from "vitest";
import {
  assertCurrentHelixExternalExecutionActive,
  assertHelixExternalExecutionActive,
  helixExternalPolicyAllowsCapability,
  runWithHelixExternalCapabilityPolicy,
  type HelixExternalCapabilityPolicy,
} from "../external-capability-policy";

const policy = (
  overrides: Partial<HelixExternalCapabilityPolicy> = {},
): HelixExternalCapabilityPolicy => ({
  runId: "run-cancellation-test",
  tenantId: "tenant-a",
  accountProfileId: "profile-a",
  accountType: "developer",
  allowedCapabilities: ["repo.search"],
  readOnly: true,
  ...overrides,
});

describe("external Helix cooperative cancellation", () => {
  it("preserves the controller's cancellation reason", () => {
    const controller = new AbortController();
    controller.abort(new Error("agent_run_cancelled"));

    expect(() =>
      assertHelixExternalExecutionActive(policy({ signal: controller.signal })),
    ).toThrow("agent_run_cancelled");
  });

  it("fails a phase boundary once its deadline is reached", () => {
    const deadlineAt = "2026-07-26T20:00:00.000Z";

    expect(() =>
      assertHelixExternalExecutionActive(
        policy({ deadlineAt }),
        Date.parse(deadlineAt),
      ),
    ).toThrow("helix_ask_timeout");
    expect(() =>
      assertHelixExternalExecutionActive(
        policy({ deadlineAt }),
        Date.parse(deadlineAt) - 1,
      ),
    ).not.toThrow();
  });

  it("keeps the signal available across asynchronous phase boundaries", async () => {
    const controller = new AbortController();

    await expect(
      runWithHelixExternalCapabilityPolicy(
        policy({ signal: controller.signal }),
        async () => {
          await Promise.resolve();
          controller.abort(new Error("agent_run_cancelled"));
          assertCurrentHelixExternalExecutionActive();
        },
      ),
    ).rejects.toThrow("agent_run_cancelled");
  });

  it("stops later capability admission after cancellation", () => {
    const controller = new AbortController();
    const scoped = policy({ signal: controller.signal });
    expect(helixExternalPolicyAllowsCapability(scoped, "repo.search")).toBe(
      true,
    );

    controller.abort(new Error("agent_run_cancelled"));

    expect(() =>
      helixExternalPolicyAllowsCapability(scoped, "repo.search"),
    ).toThrow("agent_run_cancelled");
  });
});
