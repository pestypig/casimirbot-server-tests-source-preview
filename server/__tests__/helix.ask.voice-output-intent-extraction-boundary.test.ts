import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAskTurnDocsReadAloudIntentReader,
  isAskTurnDottieVoiceReadoutIntent,
} from "../services/helix-ask/voice-output-intent";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/voice-output-intent.ts");

describe("Helix Ask voice output intent extraction boundary", () => {
  it("keeps Dottie voice readout intent out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/voice-output-intent");
    expect(routeSource).not.toMatch(/const\s+isAskTurnDottieVoiceReadoutIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocsReadAloudIntent\s*=\s*\(transcript/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDottieVoiceReadoutIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnDocsReadAloudIntentReader\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
  });

  it("preserves Dottie voice readout prompt classification", () => {
    expect(isAskTurnDottieVoiceReadoutIntent("Have Auntie Dottie read that out loud.")).toBe(true);
    expect(isAskTurnDottieVoiceReadoutIntent("Dottie, narrate this to me.")).toBe(true);
    expect(isAskTurnDottieVoiceReadoutIntent("Read this out loud with Dottie.")).toBe(true);
    expect(isAskTurnDottieVoiceReadoutIntent("Do not ask Dottie to read this aloud.")).toBe(false);
    expect(isAskTurnDottieVoiceReadoutIntent("What is Auntie Dottie in this app?")).toBe(false);
  });

  it("preserves docs read-aloud intent through the route-owned voice classifier", () => {
    const readers = createAskTurnDocsReadAloudIntentReader({
      classifyAskTurnVoiceOutputIntent: (prompt) => ({
        kind: /\bread\s+this\s+document\b/i.test(prompt) || /\bdottie\b/i.test(prompt)
          ? "document_read"
          : "none",
      }),
    });

    expect(readers.isAskTurnDocsReadAloudIntent("read this document aloud")).toBe(true);
    expect(readers.isAskTurnDocsReadAloudIntent("Dottie read this document aloud")).toBe(false);
    expect(readers.isAskTurnDocsReadAloudIntent("summarize this document")).toBe(false);
  });
});
