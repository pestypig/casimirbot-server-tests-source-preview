import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAskTurnSimpleConversationAnswer } from "../services/helix-ask/simple-conversation-answer";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/simple-conversation-answer.ts");

describe("Helix Ask simple conversation answer extraction boundary", () => {
  it("keeps simple conversation answer text out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/simple-conversation-answer");
    expect(routeSource).not.toMatch(/const\s+buildAskTurnSimpleConversationAnswer\s*=\s*\(\s*transcript:\s*string\s*\)\s*:\s*string\s*=>/);
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnSimpleConversationAnswer\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves deterministic simple conversation answers", () => {
    expect(buildAskTurnSimpleConversationAnswer("hello")).toBe("Hello. What would you like to work on?");
    expect(buildAskTurnSimpleConversationAnswer("Are you there?")).toBe("Yes, Helix Ask is responding. What would you like to do next?");
    expect(buildAskTurnSimpleConversationAnswer("Please answer without tools")).toBe("Yes. I can answer directly here. What would you like to do next?");
    expect(buildAskTurnSimpleConversationAnswer("What can you help me do in this workspace?")).toContain("I can help you work across the Helix workspace:");
  });
});
