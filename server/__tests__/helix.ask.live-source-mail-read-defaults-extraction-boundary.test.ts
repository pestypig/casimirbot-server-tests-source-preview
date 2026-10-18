import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createAskTurnLiveSourceMailReadDefaultsBuilder,
  readAskTurnPositiveIntegerEnv,
} from "../services/helix-ask/live-source/mail-read-defaults";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/live-source/mail-read-defaults.ts");

const envKeys = [
  "STAGE_PLAY_MAIL_READ_LATEST_SCENE_LIMIT",
  "STAGE_PLAY_MAIL_READ_CURRENT_TURN_MICRO_BATCH_LIMIT",
  "STAGE_PLAY_MAIL_READ_SALIENCE_WINDOW_LIMIT",
  "STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT",
] as const;

const originalEnv = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of envKeys) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
  originalEnv.clear();
});

const setEnv = (key: typeof envKeys[number], value: string): void => {
  if (!originalEnv.has(key)) originalEnv.set(key, process.env[key]);
  process.env[key] = value;
};

describe("Helix Ask live-source mail read defaults extraction boundary", () => {
  it("keeps mail read default helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/live-source/mail-read-defaults");
    expect(routeSource).not.toMatch(/const\s+readAskTurnPositiveIntegerEnv\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildAskTurnLiveSourceMailReadDefaults\s*=\s*\(transcript/);
    expect(routeSource).toContain("createAskTurnLiveSourceMailReadDefaultsBuilder({");
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnPositiveIntegerEnv\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnLiveSourceMailReadDefaultsBuilder\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves env fallback, truncate, and clamp behavior", () => {
    setEnv("STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT", "9.8");
    expect(readAskTurnPositiveIntegerEnv("STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT", 3, 1, 12)).toBe(9);

    setEnv("STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT", "500");
    expect(readAskTurnPositiveIntegerEnv("STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT", 3, 1, 12)).toBe(12);

    setEnv("STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT", "not-a-number");
    expect(readAskTurnPositiveIntegerEnv("STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT", 3, 1, 12)).toBe(3);

    setEnv("STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT", "-5");
    expect(readAskTurnPositiveIntegerEnv("STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT", 3, 1, 12)).toBe(1);
  });

  it("preserves mail read default decision order", () => {
    setEnv("STAGE_PLAY_MAIL_READ_LATEST_SCENE_LIMIT", "2");
    setEnv("STAGE_PLAY_MAIL_READ_CURRENT_TURN_MICRO_BATCH_LIMIT", "6");
    setEnv("STAGE_PLAY_MAIL_READ_SALIENCE_WINDOW_LIMIT", "7");
    setEnv("STAGE_PLAY_MAIL_READ_DEFAULT_LIMIT", "4");

    const buildDefaults = createAskTurnLiveSourceMailReadDefaultsBuilder({
      hasLiveSourceMailInterpretationCue: (text) => /\binterpret\b/i.test(text),
    });

    expect(buildDefaults("What does the latest visual update show?")).toEqual({
      limit: 2,
      batchCap: 2,
      reason: "latest_scene_answer",
    });
    expect(buildDefaults("Only tell me if there is danger.")).toEqual({
      limit: 7,
      batchCap: 7,
      reason: "salience_window",
    });
    expect(buildDefaults("interpret current mail")).toEqual({
      limit: 6,
      batchCap: 6,
      reason: "current_turn_micro_batch",
    });
    expect(buildDefaults("read the mailbox")).toEqual({
      limit: 4,
      batchCap: 4,
      reason: "default_mail_read",
    });
  });
});
