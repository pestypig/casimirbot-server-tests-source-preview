import { describe, expect, it } from "vitest";
import {
  derivePaperEntryFillTerms,
} from "../paper-execution-store";

const model = {
  kind: "quote_touch_v1" as const,
  deterministic_latency_ms: 100,
  deterministic_slippage_bps: 25,
  partial_fill_policy: {
    kind: "deterministic_fraction_bps" as const,
    fill_fraction_bps: 4_000,
  },
};

const base = {
  orderQuantityMicros: 1_000,
  filledQuantityMicros: 0,
  limitPriceMicros: 101_000_000,
  orderCreatedAt: "2026-08-28T14:00:00.000Z",
  executionModel: model,
  quoteAskMicros: 100_000_000,
  quoteObservedAt: "2026-08-28T14:00:00.100Z",
};

describe("paper reactive execution model", () => {
  it("enforces latency and limit eligibility before any fill", () => {
    expect(derivePaperEntryFillTerms({
      ...base,
      quoteObservedAt: "2026-08-28T14:00:00.099Z",
    })).toBeNull();
    expect(derivePaperEntryFillTerms({
      ...base,
      quoteAskMicros: 101_000_001,
    })).toBeNull();
  });

  it("applies deterministic original-order fractions and bounded slippage", () => {
    expect(derivePaperEntryFillTerms(base)).toEqual({
      quantityMicros: 400,
      priceMicros: 100_250_000,
    });
    expect(derivePaperEntryFillTerms({
      ...base,
      filledQuantityMicros: 800,
    })).toEqual({
      quantityMicros: 200,
      priceMicros: 100_250_000,
    });
    expect(derivePaperEntryFillTerms({
      ...base,
      limitPriceMicros: 100_100_000,
    })).toEqual({
      quantityMicros: 400,
      priceMicros: 100_100_000,
    });
  });

  it("preserves legacy full quote-touch behavior when no model is attached", () => {
    expect(derivePaperEntryFillTerms({
      ...base,
      executionModel: null,
    })).toEqual({ quantityMicros: 1_000, priceMicros: 100_000_000 });
  });
});
