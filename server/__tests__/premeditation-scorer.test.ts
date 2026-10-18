import { describe, it, expect } from "vitest";
import { scorePremeditation } from "../services/premeditation-scorer";

describe("premeditation scorer", () => {
  it("returns deterministic chosen candidate and optimism formula", () => {
    const result = scorePremeditation({
      lambda: 0.5,
      mu: 0.25,
      ideologyWeight: 0.1,
      coherenceWeight: 0.2,
      candidates: [
        {
          id: "a",
          valueLongevity: 0.9,
          risk: 0.4,
          entropy: 0.1,
          ideologyAlignment: 0.8,
          coherenceAlignment: 0.7,
        },
        {
          id: "b",
          valueLongevity: 0.8,
          risk: 0.1,
          entropy: 0.2,
          ideologyAlignment: 0.6,
          coherenceAlignment: 0.9,
        },
      ],
    });

    expect(result.chosenCandidateId).toBe("b");
    expect(result.scores.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(result.optimism).toBeCloseTo(0.94, 8);
    expect(result.entropy).toBeCloseTo(0.2, 8);
  });

  it("breaks ties by candidate id for replay stability", () => {
    const result = scorePremeditation({
      lambda: 1,
      mu: 1,
      candidates: [
        { id: "z", valueLongevity: 1, risk: 0.5, entropy: 0.5 },
        { id: "a", valueLongevity: 1, risk: 0.5, entropy: 0.5 },
      ],
    });

    expect(result.chosenCandidateId).toBe("a");
  });
});
