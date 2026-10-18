import { describe, expect, it } from "vitest";

import { formatDistilledAnswer } from "../services/helix-ask/live-answer-style-policy";

describe("Helix Ask answer style policy", () => {
  it("uses operator brief space without procedure-log filler", () => {
    const answer = formatDistilledAnswer({
      conciseAnswer:
        "I'm seeing a File Explorer workspace. The useful signal is likely reviewing visible workstation files. Visible objects include folder view and file entries.",
      caveat: "No audio/user steering corroboration.",
      style: "brief",
      expansionAvailable: true,
    });

    expect(answer).toContain("The useful signal is");
    expect(answer).toContain("Visible objects include");
    expect(answer).toContain("Caveat:");
    expect(answer).not.toContain("Details are saved in the procedure log");
  });

  it("keeps voice answers downstream of authorized text without generation caps", () => {
    const detailedObjects =
      "Visible objects include changed files, terminal output, a project sidebar, branch metadata, conversation context, review notes, and a route-authority test plan that should remain available to the final answer.";
    const answer = formatDistilledAnswer({
      conciseAnswer:
        `I'm seeing a development workspace. The useful signal is Helix Ask terminal authority debugging. ${detailedObjects}`,
      caveat: "Confidence is moderate because the answer is from compact visual evidence.",
      style: "voice",
      expansionAvailable: true,
    });

    expect(answer).toContain("Helix Ask terminal authority debugging");
    expect(answer).toContain("route-authority test plan");
    expect(answer).not.toContain("Source refs:");
    expect(answer).not.toContain("procedure log");
  });
});
