import { describe, expect, it } from "vitest";
import {
  OPERATOR_CALLOUT_V1_KIND,
  validateOperatorCalloutV1,
} from "../services/helix-ask/operator-contract-v1";

describe("validateOperatorCalloutV1", () => {
  it("passes a valid helix.operator_callout.v1 payload", () => {
    const result = validateOperatorCalloutV1({
      kind: OPERATOR_CALLOUT_V1_KIND,
      deterministic: true,
      suppressed: false,
      text: {
        certainty: "reasoned",
        message: "Text callout certainty is reasoned.",
      },
      voice: {
        certainty: "reasoned",
        message: "Voice mirrors text certainty.",
      },
    });

    expect(result.ok).toBe(true);
  });


  it("omits suppression_reason key when suppressed is false", () => {
    const result = validateOperatorCalloutV1({
      kind: OPERATOR_CALLOUT_V1_KIND,
      deterministic: true,
      suppressed: false,
      text: {
        certainty: "reasoned",
        message: "Text callout certainty is reasoned.",
      },
      voice: {
        certainty: "reasoned",
        message: "Voice mirrors text certainty.",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected successful validation");
    }

    expect("suppression_reason" in result.value).toBe(false);
  });

  it("fails deterministically when required fields are missing", () => {
    const result = validateOperatorCalloutV1({
      kind: OPERATOR_CALLOUT_V1_KIND,
      suppressed: false,
      text: {
        certainty: "reasoned",
      },
      voice: {
        message: "missing certainty",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected deterministic failure");
    }

    expect(result.errors).toEqual([
      {
        code: "MISSING_REQUIRED_FIELD",
        path: "deterministic",
        message: "deterministic must be a boolean",
      },
      {
        code: "MISSING_REQUIRED_FIELD",
        path: "voice.certainty",
        message: "voice.certainty must be one of unknown, hypothesis, reasoned, confirmed",
      },
      {
        code: "MISSING_REQUIRED_FIELD",
        path: "text.message",
        message: "text.message must be a non-empty string",
      },
    ]);
  });

  it("fails when voice certainty is stronger than text certainty", () => {
    const result = validateOperatorCalloutV1({
      kind: OPERATOR_CALLOUT_V1_KIND,
      deterministic: true,
      suppressed: false,
      text: {
        certainty: "hypothesis",
        message: "Text confidence is still exploratory.",
      },
      voice: {
        certainty: "confirmed",
        message: "Voice overstates certainty.",
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "VOICE_CERTAINTY_EXCEEDS_TEXT",
          path: "voice.certainty",
          message: "voice certainty must not exceed text certainty",
        },
      ],
    });
  });

  it("fails suppressed payloads that omit suppression reason", () => {
    const result = validateOperatorCalloutV1({
      kind: OPERATOR_CALLOUT_V1_KIND,
      deterministic: true,
      suppressed: true,
      text: {
        certainty: "reasoned",
        message: "Suppressed callout payload.",
      },
      voice: {
        certainty: "reasoned",
        message: "Suppressed voice payload.",
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "SUPPRESSION_REASON_REQUIRED",
          path: "suppression_reason",
          message: "suppression_reason must be a stable suppression reason when suppressed is true",
        },
      ],
    });
  });

  it("fails when suppression_reason is present while suppressed is false", () => {
    const result = validateOperatorCalloutV1({
      kind: OPERATOR_CALLOUT_V1_KIND,
      deterministic: true,
      suppressed: false,
      suppression_reason: "operator_noise_filter",
      text: {
        certainty: "reasoned",
        message: "Unsuppressed payload.",
      },
      voice: {
        certainty: "reasoned",
        message: "Unsuppressed voice payload.",
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "INVALID_FIELD_VALUE",
          path: "suppression_reason",
          message: "suppression_reason must be undefined when suppressed is false",
        },
      ],
    });
  });

  it("fails when payload is an array", () => {
    const result = validateOperatorCalloutV1([]);

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "INVALID_FIELD_TYPE",
          path: "payload",
          message: "payload must be an object",
        },
      ],
    });
  });

  it("fails when text is an array", () => {
    const result = validateOperatorCalloutV1({
      kind: OPERATOR_CALLOUT_V1_KIND,
      deterministic: true,
      suppressed: false,
      text: [],
      voice: {
        certainty: "reasoned",
        message: "Voice payload.",
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "INVALID_FIELD_TYPE",
          path: "text",
          message: "text must be an object",
        },
        {
          code: "MISSING_REQUIRED_FIELD",
          path: "text.certainty",
          message: "text.certainty must be one of unknown, hypothesis, reasoned, confirmed",
        },
        {
          code: "MISSING_REQUIRED_FIELD",
          path: "text.message",
          message: "text.message must be a non-empty string",
        },
      ],
    });
  });

  it("fails when voice is an array", () => {
    const result = validateOperatorCalloutV1({
      kind: OPERATOR_CALLOUT_V1_KIND,
      deterministic: true,
      suppressed: false,
      text: {
        certainty: "reasoned",
        message: "Text payload.",
      },
      voice: [],
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "INVALID_FIELD_TYPE",
          path: "voice",
          message: "voice must be an object",
        },
        {
          code: "MISSING_REQUIRED_FIELD",
          path: "voice.certainty",
          message: "voice.certainty must be one of unknown, hypothesis, reasoned, confirmed",
        },
        {
          code: "MISSING_REQUIRED_FIELD",
          path: "voice.message",
          message: "voice.message must be a non-empty string",
        },
      ],
    });
  });
});
