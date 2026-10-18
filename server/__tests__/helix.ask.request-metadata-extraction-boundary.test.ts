import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskRequestMetadata,
  deriveHelixAskReplayIndex,
} from "../services/helix-ask/request-metadata";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/request-metadata.ts");

describe("Helix Ask request metadata extraction boundary", () => {
  it("keeps request metadata assembly out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/request-metadata");
    expect(routeSource).toContain("buildHelixAskRequestMetadata");
    expect(routeSource).not.toMatch(/type\s+HelixAskRequestMetadata\s*=/);
    expect(routeSource).not.toMatch(/const\s+deriveHelixAskReplayIndex\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskRequestMetadata\s*=/);

    expect(serviceSource).toMatch(/export\s+type\s+HelixAskRequestMetadata\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+deriveHelixAskReplayIndex\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskRequestMetadata\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves replay and language metadata normalization", () => {
    expect(deriveHelixAskReplayIndex("ask-r3-turn")).toBe(3);
    expect(deriveHelixAskReplayIndex("ask-turn")).toBeNull();

    expect(
      buildHelixAskRequestMetadata({
        seed: 7,
        traceId: "ask-r2-trace",
        turnId: "turn-1",
        sessionId: "session-1",
        sourceLanguage: "EN-US",
        languageConfidence: 2,
        responseLanguage: "ES",
      }),
    ).toMatchObject({
      seed: 7,
      episode: "ask-r2-trace",
      replay: { index: 2, isReplay: true },
      turn_id: "turn-1",
      trace_id: "ask-r2-trace",
      session_id: "session-1",
      source_language: "en-us",
      language_detected: "en-us",
      language_confidence: 1,
      response_language: "es",
    });
  });
});
