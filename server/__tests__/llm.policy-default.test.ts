import { applyHullModeLlmPolicyDefault } from "../services/llm/policy-default";
import { describe, expect, it } from "vitest";

describe("applyHullModeLlmPolicyDefault", () => {
  it("does not infer local policy when hull mode is on and policy is unset", () => {
    const env = {} as NodeJS.ProcessEnv;
    applyHullModeLlmPolicyDefault(env, true);
    expect(env.LLM_POLICY).toBeUndefined();
  });

  it("preserves explicit http policy when hull mode is on", () => {
    const env = { LLM_POLICY: "http" } as NodeJS.ProcessEnv;
    applyHullModeLlmPolicyDefault(env, true);
    expect(env.LLM_POLICY).toBe("http");
  });

  it("preserves explicit local policy when hull mode is on", () => {
    const env = { LLM_POLICY: "local" } as NodeJS.ProcessEnv;
    applyHullModeLlmPolicyDefault(env, true);
    expect(env.LLM_POLICY).toBe("local");
  });

  it("does not mutate policy when hull mode is off", () => {
    const env = {} as NodeJS.ProcessEnv;
    applyHullModeLlmPolicyDefault(env, false);
    expect(env.LLM_POLICY).toBeUndefined();
  });
});
