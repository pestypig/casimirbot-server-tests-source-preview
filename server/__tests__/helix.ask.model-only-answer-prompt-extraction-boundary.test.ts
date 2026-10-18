import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAskTurnModelOnlyAnswerPrompt } from "../services/helix-ask/model-only-answer-prompt";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/model-only-answer-prompt.ts");

describe("Helix Ask model-only answer prompt extraction boundary", () => {
  it("keeps model-only answer prompt construction out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/model-only-answer-prompt");
    expect(routeSource).not.toMatch(/const\s+buildAskTurnModelOnlyAnswerPrompt\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnModelOnlyAnswerPrompt\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves the no-context model-only prompt", () => {
    expect(buildAskTurnModelOnlyAnswerPrompt("  What is momentum?  ")).toBe([
      "You are Helix Ask answering a model-only conceptual question.",
      "Do not claim workspace/document evidence unless the user explicitly provided it.",
      "Ignore active documents, prior workspace state, notes, retrieval results, and file paths.",
      "",
      "If a draft would mention a /docs path or say it explained a document, discard that draft and answer only from general knowledge.",
      "Answer directly in clear scientific language when relevant.",
      "Keep the answer concise: 2-5 sentences or a short bullet list.",
      "Do not mention internal routing, retrieval, tools, policies, or debug state.",
      "",
      "",
      "",
      "User question: What is momentum?",
    ].join("\n"));
  });

  it("preserves admitted-memory prompt instructions", () => {
    const prompt = buildAskTurnModelOnlyAnswerPrompt("What did I paste?", "  ref:attachment-1  ");

    expect(prompt).toContain("Use the admitted conversation memory below when the user asks about previous pasted or attached text.");
    expect(prompt).toContain("Do not claim raw access beyond the shown compact previews, attachment refs, and admitted memory packet.");
    expect(prompt).toContain("Admitted conversation memory:\nref:attachment-1");
    expect(prompt).toContain("User question: What did I paste?");
  });
});
