import { describe, expect, it } from "vitest";

import { scanForbiddenTheoryClaims } from "../services/helix-ask/theory-congruence/forbidden-claims";

describe("Helix Ask theory congruence forbidden claim scan", () => {
  it("fails on direct overclaiming language", () => {
    const scan = scanForbiddenTheoryClaims("The badge graph proves physics and NHM2 validated the route.");
    expect(scan.status).toBe("fail");
    expect(scan.forbidden_terms_found).toEqual(
      expect.arrayContaining(["badge graph proves physics", "NHM2 validated"]),
    );
  });

  it("allows negated claim-boundary language", () => {
    const scan = scanForbiddenTheoryClaims("This does not mean NHM2 is validated, and sunquakes do not prove collapse.");
    expect(scan.status).toBe("pass");
  });

  it("catches objective-collapse overclaims from solar diagnostics", () => {
    const scan = scanForbiddenTheoryClaims("Nanoflares prove objective collapse.");
    expect(scan.status).toBe("fail");
    expect(scan.forbidden_terms_found).toContain("nanoflares prove objective collapse");
  });
});
