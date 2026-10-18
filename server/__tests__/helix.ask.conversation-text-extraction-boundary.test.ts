import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  clipConversationText,
  HELIX_CONVERSATION_LEADING_FILLER_RE,
  HELIX_CONVERSATION_QUESTION_PUNCT_RE,
  sanitizeConversationBriefText,
} from "../services/helix-ask/conversation-text";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/conversation-text.ts");

describe("Helix Ask conversation text extraction boundary", () => {
  it("keeps conversation text helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/conversation-text");
    expect(routeSource).not.toMatch(/const\s+clipConversationText\s*=\s*\(\s*value:\s*string,\s*maxChars\s*=\s*320\s*\)/);
    expect(routeSource).not.toMatch(/const\s+sanitizeConversationBriefText\s*=\s*\(\s*value:\s*string,\s*maxChars\s*=\s*520\s*\)/);
    expect(serviceSource).toMatch(/export\s+const\s+clipConversationText\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+sanitizeConversationBriefText\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves deterministic conversation text normalization", () => {
    expect(clipConversationText("  Hello    there  ", 20)).toBe("Hello there");
    expect(clipConversationText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefg...");
    expect(sanitizeConversationBriefText("One?   Two??", 40)).toBe("One. Two.");
    expect("ok, what now".replace(HELIX_CONVERSATION_LEADING_FILLER_RE, "").trim()).toBe("what now");
    expect(HELIX_CONVERSATION_QUESTION_PUNCT_RE.test("ready?")).toBe(true);
  });
});
