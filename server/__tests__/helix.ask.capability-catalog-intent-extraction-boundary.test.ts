import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isAskCapabilityCatalogPrompt,
  isAskTurnCapabilityCatalogAvailabilityPrompt,
  isAskTurnCapabilityHelpIntent,
} from "../services/helix-ask/capability-catalog-intent";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/capability-catalog-intent.ts");

describe("Helix Ask capability catalog intent extraction boundary", () => {
  it("keeps Ask-turn capability help classifiers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/capability-catalog-intent");
    expect(routeSource).not.toMatch(/const\s+isAskTurnCapabilityCatalogAvailabilityPrompt\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnCapabilityHelpIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskCapabilityCatalogPrompt\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnCapabilityCatalogAvailabilityPrompt\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnCapabilityHelpIntent\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves capability catalog and help classifier behavior", () => {
    expect(isAskCapabilityCatalogPrompt("What tools are available for the Helix Ask to use?")).toBe(true);
    expect(isAskTurnCapabilityCatalogAvailabilityPrompt("What tools are available for the Helix Ask to use?")).toBe(true);
    expect(isAskTurnCapabilityHelpIntent("How can Helix Ask help me?")).toBe(true);
    expect(isAskTurnCapabilityHelpIntent("What can this workspace agent do?")).toBe(true);
    expect(
      isAskTurnCapabilityHelpIntent(
        "What can this workstation do with a scientific document I have open?",
      ),
    ).toBe(true);
    expect(isAskTurnCapabilityHelpIntent("Summarize this document")).toBe(false);
  });

  it("routes an immediate scholarly parsing and Image Lens behavior question to capability help", () => {
    const prompt =
      "Does your tool for research papers allow you to pick papers you are able to parse? Or do you check what papers are openable to then use Image Lens?";

    expect(isAskCapabilityCatalogPrompt(prompt)).toBe(true);
    expect(isAskTurnCapabilityCatalogAvailabilityPrompt(prompt)).toBe(true);
    expect(isAskTurnCapabilityHelpIntent(prompt)).toBe(true);
  });

  it.each([
    "Does the scientific calculator support symbolic variables?",
    "Can Docs Viewer open Markdown files by path?",
    "How does your repo search tool select matching files?",
    "Does the internet search tool return source links?",
    "Can the Moral Graph tool inspect a situation without changing it?",
    "Does Image Lens read equations from selected regions?",
    "Can the workstation notes tool append instead of creating a note?",
    "How does your workspace diagnostic tool check status?",
    "Does the live-source tool read mail before recording a decision?",
    "Can the narrator tool return a receipt without speaking automatically?",
    "Does the Postulate Board workflow create a review before submission?",
  ])("routes cross-family behavior questions through capability help: %s", (prompt) => {
    expect(isAskCapabilityCatalogPrompt(prompt)).toBe(true);
    expect(isAskTurnCapabilityHelpIntent(prompt)).toBe(true);
  });

  it.each([
    "Earlier I asked: does your tool for research papers allow you to pick papers you are able to parse?",
    "The screen says 'does your tool for research papers allow you to pick papers you are able to parse?'",
    "Do not answer whether your tool for research papers can pick openable papers.",
    "Later, tell me what this workstation can do with a scientific document.",
    "The document says 'what can this workstation do with a scientific document?' Explain that wording.",
    "Do not list what this workstation can do with a scientific document.",
  ])("does not execute capability help from contextual or negated wording: %s", (prompt) => {
    expect(isAskCapabilityCatalogPrompt(prompt)).toBe(false);
    expect(isAskTurnCapabilityHelpIntent(prompt)).toBe(false);
  });
});
