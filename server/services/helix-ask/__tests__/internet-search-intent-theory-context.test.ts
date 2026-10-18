import { describe, expect, it } from "vitest";

import {
  buildToolUseRestatement,
  detectInternetSearchIntent,
} from "../internet-search-intent";
import { arbitrateAskSourceTarget } from "../ask-source-target-arbitrator";

describe("internet-search intent for Theory Badge Graph context", () => {
  it("does not turn current graph-state language into a web-freshness request", () => {
    const prompt =
      "Looking at the current Theory Badge Graph arrangement I set up, what do these selected badges imply together? Identify their connection trace, intermediate badges, and the possibilities currently available next. Distinguish my chosen arrangement from what established physics supports.";

    const restatement = buildToolUseRestatement(prompt);
    const intent = detectInternetSearchIntent(prompt);

    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(restatement.freshnessRequired).toBe(false);
    expect(intent.searchRequested).toBe(false);
  });

  it("still admits an explicit web request alongside current graph context", () => {
    const prompt =
      "Search the web for current sources, then compare them with these selected badges in the Theory Badge Graph.";

    expect(detectInternetSearchIntent(prompt)).toMatchObject({
      searchRequested: true,
      strength: "hard",
    });
  });

  it("treats current-turn evidence language as procedure lifecycle scope", () => {
    const prompt =
      "Re-prepare that same bounded procedure for study.casimir_dp.evidence_map_stage3 and advection_diffusion_full_1d so the evidence is current for this turn. Which semantic, boundary-condition, formal, numerical, and observable requirements are still missing? Do not start any downstream job.";
    const restatement = buildToolUseRestatement(prompt);

    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(restatement.freshnessRequired).toBe(false);
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
    expect(arbitrateAskSourceTarget({
      turnId: "ask:test:current-turn-procedure-evidence",
      threadId: "thread:test",
      promptText: prompt,
    }).target_source).not.toBe("internet_search");
  });

  it("still admits an explicit current web request alongside procedure preparation", () => {
    const prompt =
      "Re-prepare that same bounded procedure for study.casimir_dp.evidence_map_stage3 and advection_diffusion_full_1d, then search the web for the current OpenAI API status.";
    const restatement = buildToolUseRestatement(prompt);

    expect(restatement.requiredToolFamilies).toContain("internet_search");
    expect(restatement.freshnessRequired).toBe(true);
    expect(detectInternetSearchIntent(prompt)).toMatchObject({
      searchRequested: true,
      strength: "hard",
    });
  });

  it("keeps genuine current web facts on the internet-search path", () => {
    const prompt = "What is the current OpenAI API status?";
    const restatement = buildToolUseRestatement(prompt);

    expect(restatement.requiredToolFamilies).toContain("internet_search");
    expect(restatement.freshnessRequired).toBe(true);
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(true);
  });

  it("does not treat an unrelated current graph as Theory Badge Graph workspace state", () => {
    const prompt = "What does the current graph of global temperatures show?";

    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(true);
  });
});
