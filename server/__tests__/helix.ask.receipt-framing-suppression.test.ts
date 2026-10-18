import { describe, expect, it } from "vitest";

import { suppressReceiptFramingInFinalAnswer } from "../services/helix-ask/receipt-framing-suppression";

describe("Helix Ask receipt framing suppression", () => {
  it("removes receipt provenance framing from normal final answers", () => {
    expect(
      suppressReceiptFramingInFinalAnswer({
        prompt: "Open the docs viewer.",
        text: "The docs viewer has been successfully opened, as indicated by the workspace action receipt.",
      }),
    ).toBe("The docs viewer has been successfully opened.");

    expect(
      suppressReceiptFramingInFinalAnswer({
        prompt: "Open the docs viewer.",
        text: "The docs viewer has been successfully opened according to the workspace action receipt.",
      }),
    ).toBe("The docs viewer has been successfully opened.");
  });

  it("preserves receipt provenance when the user explicitly asks for it", () => {
    expect(
      suppressReceiptFramingInFinalAnswer({
        prompt: "Show me the receipt for opening the docs viewer.",
        text: "The docs viewer has been successfully opened, as indicated by the workspace action receipt.",
      }),
    ).toBe("The docs viewer has been successfully opened, as indicated by the workspace action receipt.");
  });

  it("preserves markdown bullet boundaries while suppressing receipt framing", () => {
    expect(
      suppressReceiptFramingInFinalAnswer({
        prompt: "Explain in two bullets what evidence-only voice tool receipts mean.",
        text: [
          "The interim voice callout was queued, according to the workspace action receipt.",
          "",
          "- Evidence-only voice tool receipts record what the voice tool observed.",
          "- They can support the final answer, but cannot become terminal authority.",
        ].join("\n"),
      }),
    ).toBe([
      "The interim voice callout was queued.",
      "",
      "- Evidence-only voice tool receipts record what the voice tool observed.",
      "- They can support the final answer, but cannot become terminal authority.",
    ].join("\n"));
  });
});
