import { describe, expect, it } from "vitest";
import {
  PATHMIND_INTEROP_POLICY,
  PATHMIND_RESEARCH_NODE_CATALOG,
} from "../services/situation-room/pathmind-node-catalog-research-adapter";

describe("Pathmind research mapping guard", () => {
  it("keeps Pathmind as non-executing research vocabulary", () => {
    expect(PATHMIND_RESEARCH_NODE_CATALOG.length).toBeGreaterThan(0);
    expect(PATHMIND_INTEROP_POLICY.imports_pathmind_code).toBe(false);
    expect(PATHMIND_INTEROP_POLICY.execution_enabled).toBe(false);
    expect(PATHMIND_INTEROP_POLICY.may_execute_live_actions).toBe(false);
    expect(PATHMIND_INTEROP_POLICY.default_enabled).toBe(false);
    expect(PATHMIND_INTEROP_POLICY.assistant_answer).toBe(false);
  });
});
