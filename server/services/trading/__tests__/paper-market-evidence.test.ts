import { describe, expect, it } from "vitest";
import { extractPaperQuote } from "../paper-market-evidence";

describe("paper quote evidence normalization", () => {
  it("extracts exact decimal micros from bounded Robinhood quote shapes", () => {
    expect(extractPaperQuote({
      symbol: "TEST",
      data: {
        results: [{
          symbol: "TEST",
          best_bid: { price: "$10.001234" },
          bestAsk: { price: "10.011235" },
        }],
      },
    })).toEqual({ bidMicros: 10_001_234, askMicros: 10_011_235 });
  });

  it("selects the exact symbol and fails closed on crossed or missing quotes", () => {
    expect(extractPaperQuote({
      symbol: "RIGHT",
      data: { quotes: [
        { symbol: "WRONG", bid: "99", ask: "100" },
        { ticker: "RIGHT", bid_price: "4.25", ask_price: "4.26" },
      ] },
    })).toEqual({ bidMicros: 4_250_000, askMicros: 4_260_000 });
    expect(() => extractPaperQuote({
      symbol: "RIGHT",
      data: { symbol: "RIGHT", bid: "5", ask: "4" },
    })).toThrow(/valid quote/u);
  });
});
