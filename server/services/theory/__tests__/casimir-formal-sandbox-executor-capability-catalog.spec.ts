import { describe, expect, it } from "vitest";

import {
  inspectCasimirFormalSandboxExecutorCapabilityCatalogV1,
  resolveCasimirFormalSandboxExecutorCapabilityV1,
} from "../casimir-formal-sandbox-executor-capability-catalog";

describe("formal sandbox executor capability catalog", () => {
  it("is intentionally unconfigured until an external worker is attested", async () => {
    await expect(
      inspectCasimirFormalSandboxExecutorCapabilityCatalogV1(),
    ).resolves.toMatchObject({
      configured: false,
      capabilityIds: [],
      issues: [],
      assistantAnswer: false,
      terminalEligible: false,
    });
    await expect(
      resolveCasimirFormalSandboxExecutorCapabilityV1({
        capabilityId: "caller:lookalike",
        artifactSha256: "a".repeat(64),
      }),
    ).resolves.toBeNull();
  });
});
