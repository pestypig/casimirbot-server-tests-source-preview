import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeHelixAskTurnContractText } from "../services/helix-ask/contracts/turn-contract-text";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-text.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract text extraction boundary", () => {
  it("keeps turn-contract text normalization out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-text");
    expect(routeSource).not.toMatch(/const\s+normalizeHelixAskTurnContractText\s*=\s*\(/);
    expect(routeSource).not.toContain("HELIX_ASK_TURN_CONTRACT_PATH_FRAGMENT_RE");
    expect(serviceSource).toMatch(/export\s+const\s+normalizeHelixAskTurnContractText\s*=/);
    expect(serviceSource).toContain("HELIX_ASK_TURN_CONTRACT_PATH_FRAGMENT_RE");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves path/source cleanup and clipping behavior", () => {
    expect(
      normalizeHelixAskTurnContractText("Sources: docs/research/foo.md `Claim`  #One", 80),
    ).toBe("Claim One");
    expect(normalizeHelixAskTurnContractText("abcdef", 3)).toBe("abc...");
    expect(normalizeHelixAskTurnContractText("", 10)).toBe("");
  });
});
