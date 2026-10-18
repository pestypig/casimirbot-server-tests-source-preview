import { describe, expect, it } from "vitest";

import { buildHelixAskLanguageContract } from "../services/helix-ask/language-contract";

const normalizeLanguageTag = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("es")) return "es";
  if (normalized.startsWith("en")) return "en";
  return normalized;
};

describe("helix ask language contract", () => {
  it("detects simple Spanish typed prompts without forcing repo routing", () => {
    const contract = buildHelixAskLanguageContract({
      inputModality: "typed",
      sourceText: "\u00bfPuedes explicar la diferencia entre tiempo propio y tiempo coordenado?",
      normalizeLanguageTag,
    });

    expect(contract).toMatchObject({
      schema: "helix.ask_language_contract.v1",
      input_modality: "typed",
      dominant_language: "es",
      response_language: "es",
      language_detected: "es",
      code_mixed: false,
      translated: false,
    });
    expect(contract.source_language).toBe("es");
    expect(contract.language_confidence).not.toBeNull();
    expect(contract.reason_codes).toContain("spanish_language_cues");
  });

  it("keeps explicit Spanish response language separate from mixed English route text", () => {
    const contract = buildHelixAskLanguageContract({
      inputModality: "typed",
      sourceText:
        "Explain Helix Ask final answer language, pero responde en espa\u00f1ol y usa evidencia del c\u00f3digo.",
      normalizeLanguageTag,
    });

    expect(contract.dominant_language).toBe("mixed");
    expect(contract.response_language).toBe("es");
    expect(contract.requested_response_language).toBe("es");
    expect(contract.source_language).toBe("mixed");
    expect(contract.code_mixed).toBe(true);
    expect(contract.explicit_language_instruction).toBe(true);
    expect(contract.reason_codes).toEqual(
      expect.arrayContaining([
        "explicit_spanish_response_instruction",
        "spanish_language_cues",
        "mixed_prompt",
      ]),
    );
  });

  it("defaults mixed English/Chinese repo wording to English when no Chinese response is requested", () => {
    const contract = buildHelixAskLanguageContract({
      inputModality: "typed",
      sourceText:
        "Explain Helix Ask final answer \u8bed\u8a00\u9009\u62e9 using repo code evidence and cite file paths.",
      normalizeLanguageTag,
    });

    expect(contract.dominant_language).toBe("mixed");
    expect(contract.response_language).toBe("en");
    expect(contract.language_detected).toBe("mixed");
    expect(contract.code_mixed).toBe(true);
  });

  it("detects Chinese as the response language for primarily Chinese prompts", () => {
    const contract = buildHelixAskLanguageContract({
      inputModality: "typed",
      sourceText:
        "\u8bf7\u5728\u4ee3\u7801\u4ed3\u5e93\u4e2d\u67e5\u627e Helix Ask \u5982\u4f55\u51b3\u5b9a\u6700\u7ec8\u56de\u7b54\u8bed\u8a00\u3002\u8bf7\u5f15\u7528\u6587\u4ef6\u548c\u884c\u53f7\u4f5c\u4e3a\u8bc1\u636e\u3002",
      normalizeLanguageTag,
    });

    expect(contract.response_language).toBe("zh");
    expect(contract.language_detected).toBe("zh");
    expect(contract.code_mixed).toBe(true);
    expect(contract.reason_codes).toContain("chinese_language_cues");
  });
});
