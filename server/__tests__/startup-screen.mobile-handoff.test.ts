import { describe, expect, it } from "vitest";
import { renderRootBootHtml, renderRootRedirectHtml } from "../startup-screen";

describe("startup screen mobile handoff", () => {
  it("client-checks device signals before the ready redirect", () => {
    const html = renderRootRedirectHtml("/desktop");
    expect(html).toContain("function helixResolveClientTarget(target)");
    expect(html).toContain("compactTouchDevice");
    expect(html).toContain('helixHandoffTo(helixResolveClientTarget("/desktop"))');
  });

  it("client-checks device signals while waiting for server readiness", () => {
    const html = renderRootBootHtml("/desktop");
    expect(html).toContain('var target = helixResolveClientTarget("/desktop")');
  });
});
