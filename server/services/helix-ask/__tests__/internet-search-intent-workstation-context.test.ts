import { describe, expect, it } from "vitest";
import {
  buildToolUseRestatement,
  detectInternetSearchIntent,
  hasKnownWorkstationSurfaceScopeCue,
} from "../internet-search-intent";
import {
  hasWorkstationPanelScopeCue,
  isActiveWorkstationContextPrompt,
} from "../workstation-active-context-intent";
import { arbitrateAskSourceTarget } from "../ask-source-target-arbitrator";

describe("internet-search arbitration for workstation context", () => {
  it.each([
    "What panel is active right now?",
    "What panel am I looking at right now?",
    "What panel in the workstation is active?",
    "What panels are open and which panel is active?",
    "Tell me which workstation panel you are currently looking at.",
    "Use the workstation agent to verify which panel is active, then give me the verified result when it returns.",
    "Use the workstation agent to verify the active panel.",
    "You can use the workstation agent to verify the active panel.",
    "Could you ask the runtime agent to check the current workspace?",
  ])("keeps current panel state local: %s", (prompt) => {
    expect(hasWorkstationPanelScopeCue(prompt)).toBe(true);
    expect(isActiveWorkstationContextPrompt(prompt)).toBe(true);
    expect(buildToolUseRestatement(prompt).requiredToolFamilies).not.toContain(
      "internet_search",
    );
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:workstation-context",
        threadId: "thread:test",
        promptText: prompt,
      }).target_source,
    ).not.toBe("internet_search");
  });

  it("routes the reported first-person panel-view prompt to local workstation context", () => {
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:first-person-workstation-context",
        threadId: "thread:test",
        promptText: "What panel am I looking at right now?",
      }).target_source,
    ).toBe("workspace_panel");
  });

  it.each([
    "I am not asking what panel is active right now; explain that phrase.",
    "Do not answer what panel in the workstation is active; explain why that would need evidence.",
    "If we later ask what panel is active right now, explain what evidence would be needed.",
    "If we later ask what panel in the workstation is active, explain what evidence would be needed.",
    "Earlier I asked what panel in the workstation is active; summarize that request.",
    "The screen text says what panel is active right now; explain the wording.",
    'The button label reads "What panel in the workstation is active?"',
    "Do not use the workstation agent to verify the active panel; explain the phrase.",
    "Later, you can use the workstation agent to verify the active panel.",
    "Earlier, I asked the workstation agent to verify the active panel.",
    'The page says "Use the workstation agent to verify the active panel".',
    "Explain how to use the workstation agent to verify the active panel.",
  ])(
    "does not turn contextual panel language into web freshness: %s",
    (prompt) => {
      expect(hasWorkstationPanelScopeCue(prompt)).toBe(true);
      expect(isActiveWorkstationContextPrompt(prompt)).toBe(false);
      expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
    },
  );

  it("still admits an explicit web request alongside local panel context", () => {
    const prompt =
      "What panel is active right now, and search the web for the current OpenAI API status.";

    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(true);
  });

  it("keeps current Situation Room pipeline inspection in local workstation scope", () => {
    const prompt =
      "Inspect the current situation-room pipelines and summarize what is active or blocked.";

    expect(hasKnownWorkstationSurfaceScopeCue(prompt)).toBe(true);
    expect(buildToolUseRestatement(prompt).requiredToolFamilies).not.toContain(
      "internet_search",
    );
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:situation-room-context",
        threadId: "thread:test",
        promptText: prompt,
      }).target_source,
    ).not.toBe("internet_search");
  });

  it.each([
    "Inspect the current situation room pipelines.",
    "What is active in Stage Play Badge Graph right now?",
    "Summarize the current workstation task manager.",
    "Check the live answer environment status.",
  ])(
    "recognizes registered workstation surfaces as local scope: %s",
    (prompt) => {
      expect(hasKnownWorkstationSurfaceScopeCue(prompt)).toBe(true);
      expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
    },
  );

  it("still admits an explicit web request alongside Situation Room context", () => {
    const prompt =
      "Inspect the current situation-room pipelines and search the web for the current OpenAI API status.";

    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(true);
  });

  it("keeps a current Minecraft observation follow-up on the local evidence path", () => {
    const prompt =
      "Given the current Minecraft observations you just gathered, what should I fix first before moving? Be explicit about what the evidence does and does not prove.";

    expect(buildToolUseRestatement(prompt).requiredToolFamilies).not.toContain(
      "internet_search",
    );
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:minecraft-observation-followup",
        threadId: "thread:test",
        promptText: prompt,
      }).target_source,
    ).not.toBe("internet_search");
  });

  it("does not reinterpret current G6 room-ledger evidence as current web evidence", () => {
    const prompt =
      "In this room, inspect the canonical concurrent-reasoning ledger for G6 goal environment_durable_goal:ef49540b-0bab-4857-837f-c2f449b08585. Report the current canonical evidence.";

    expect(buildToolUseRestatement(prompt).requiredToolFamilies).not.toContain(
      "internet_search",
    );
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:g6-room-ledger",
        threadId: "helix-ask:room:room:g6",
        promptText: prompt,
      }).target_source,
    ).toBe("live_environment");
  });

  it("still admits an explicit web request from a Minecraft room", () => {
    const prompt =
      "In this Minecraft room, search the web for the current Fabric release notes.";

    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(true);
  });

  it("keeps a current Player Embodiment safety journey on local environment evidence", () => {
    const prompt =
      "Help me take one safe step as a player. First inspect a small region around me using current world evidence. If a direction has solid walkable support and safe headroom, use the paired Player Embodiment client to walk no more than one block, then make a fresh player-status check. Do not issue a server command.";
    const restatement = buildToolUseRestatement(prompt);

    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(restatement.freshnessRequired).toBe(false);
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
  });

  it.each([
    "What is my Minecraft status right now?",
    "Can you check my Minecraft health now?",
    "What Minecraft mobs are nearby, and am I in immediate danger?",
    "What is in my Minecraft inventory right now?",
  ])(
    "keeps affirmative current Minecraft probes on the live environment path: %s",
    (prompt) => {
      const restatement = buildToolUseRestatement(prompt);

      expect(restatement.requiredToolFamilies).not.toContain("internet_search");
      expect(restatement.freshnessRequired).toBe(false);
      expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
      expect(
        arbitrateAskSourceTarget({
          turnId: "ask:test:minecraft-live-environment",
          threadId: "thread:test",
          promptText: prompt,
        }).target_source,
      ).toBe("live_environment");
    },
  );

  it.each([
    "Do not check my Minecraft status right now; explain what the check would show.",
    "If I later ask you to check my Minecraft health, explain what evidence would be needed.",
    'Earlier I asked, "What is my Minecraft status right now?" Summarize that request.',
    'The room displays the prompt "What am I carrying in Minecraft right now?"',
  ])(
    "does not convert contextual Minecraft probe wording into a live or web request: %s",
    (prompt) => {
      expect(
        buildToolUseRestatement(prompt).requiredToolFamilies,
      ).not.toContain("internet_search");
      expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
      expect(
        arbitrateAskSourceTarget({
          turnId: "ask:test:minecraft-contextual-language",
          threadId: "thread:test",
          promptText: prompt,
        }).target_source,
      ).not.toBe("live_environment");
    },
  );

  it.each([
    "Search the web for the current status of Minecraft's online services.",
    "What is the current Minecraft server service status online?",
    "In this Minecraft room, search the internet for the latest Fabric release notes.",
  ])("preserves explicit current-web Minecraft requests: %s", (prompt) => {
    expect(buildToolUseRestatement(prompt).requiredToolFamilies).toContain(
      "internet_search",
    );
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(true);
  });

  it("admits an affirmative panel question after quoted screen-visible wording", () => {
    const prompt =
      'The button label reads "What panel in the workstation is active?", but what panel in the workstation is active?';

    expect(hasWorkstationPanelScopeCue(prompt)).toBe(true);
    expect(isActiveWorkstationContextPrompt(prompt)).toBe(true);
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
  });

  it("does not add general web search for a supplied scholarly URL", () => {
    const prompt =
      "Use https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013 as a supporting scholarly source for this claim.";

    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);
  });
});
