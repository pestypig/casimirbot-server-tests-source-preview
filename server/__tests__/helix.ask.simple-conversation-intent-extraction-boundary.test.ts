import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isAskTurnSimpleConversationStatusCheck } from "../services/helix-ask/simple-conversation-intent";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/simple-conversation-intent.ts");

describe("Helix Ask simple conversation intent extraction boundary", () => {
  it("keeps simple conversation intent detection out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/simple-conversation-intent");
    expect(routeSource).not.toMatch(/const\s+isAskTurnSimpleConversationStatusCheck\s*=\s*\(\s*transcript:\s*string\s*\)\s*:\s*boolean\s*=>/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnSimpleConversationStatusCheck\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves deterministic simple conversation status classification", () => {
    expect(isAskTurnSimpleConversationStatusCheck("hello")).toBe(true);
    expect(isAskTurnSimpleConversationStatusCheck("Are you there?")).toBe(true);
    expect(isAskTurnSimpleConversationStatusCheck("hello, can you hear me")).toBe(true);
    expect(isAskTurnSimpleConversationStatusCheck("Please answer without tools")).toBe(true);
    expect(isAskTurnSimpleConversationStatusCheck("open the active doc")).toBe(false);
  });
});
