import { describe, expect, it } from "vitest";

import { resolveCompoundCoverageRouteScope } from "../compound-coverage-route-scope";

describe("compound coverage route scope", () => {
  it("keeps live environments source-targeted even when source strength is not hard", () => {
    expect(
      resolveCompoundCoverageRouteScope({
        goalKind: "live_environment",
        targetSource: "live_environment",
        sourceStrength: "soft",
      }),
    ).toBe("source_targeted");
  });

  it("keeps explicit model-only goals model-only", () => {
    expect(
      resolveCompoundCoverageRouteScope({
        goalKind: "conversation",
        answerScope: "model_only",
        targetSource: "live_environment",
        sourceStrength: "soft",
      }),
    ).toBe("model_only");
  });

  it("fails unknown hard source targets into source-targeted coverage", () => {
    expect(
      resolveCompoundCoverageRouteScope({
        goalKind: "unknown",
        targetSource: "future_environment",
        sourceStrength: "hard",
      }),
    ).toBe("source_targeted");
  });
});
