import { describe, expect, it } from "vitest";
import { summarizeHelixAskRuntimeError } from "../runtime-error-diagnostic";

describe("summarizeHelixAskRuntimeError", () => {
  it("retains only an error class and bundled stack site", () => {
    const error = new TypeError("private prompt and credential");
    error.stack = [
      "TypeError: private prompt and credential",
      "    at dispatch (C:\\private\\dist\\service.mjs:123:45)",
    ].join("\n");

    const summary = summarizeHelixAskRuntimeError(error);

    expect(summary).toEqual({
      error_class: "TypeError",
      stack_site: "dist/service.mjs:123:45",
    });
    expect(JSON.stringify(summary)).not.toContain("private");
  });

  it("does not print arbitrary thrown text or paths", () => {
    expect(summarizeHelixAskRuntimeError("private prompt")).toEqual({
      error_class: "string",
      stack_site: null,
    });
    const error = new Error("private credential");
    error.stack = "Error: private credential\n    at /private/provider.ts:9:1";
    expect(summarizeHelixAskRuntimeError(error)).toEqual({
      error_class: "Error",
      stack_site: null,
    });
  });
});
