import { describe, expect, it } from "vitest";
import { auditMinecraftNether1N0Readiness } from
  "../../scripts/audit-minecraft-nether1-n0-readiness";

describe("EH-MC-NETHER1 N0 readiness audit", () => {
  it("reconciles the post-G7 packet and exposes the general N0 capability course", () => {
    const result = auditMinecraftNether1N0Readiness();

    expect(result).toMatchObject({
      objective_id: "EH-MC-NETHER1",
      program_gate: "G8",
      maturity: "specified",
      ready_for_n0: true,
      live_acceptance_claimed: false,
      failures: [],
    });
    expect(result.capabilities_checked).toBeGreaterThanOrEqual(22);
    expect(result.action_kinds_checked).toBeGreaterThanOrEqual(12);
    expect(result.condition_kinds_checked).toBeGreaterThanOrEqual(16);
    expect(result.compositions_checked).toBe(4);
    expect(result.contract_files_checked).toBeGreaterThanOrEqual(9);
  });
});
