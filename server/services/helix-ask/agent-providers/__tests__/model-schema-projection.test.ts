import { describe, expect, it } from "vitest";
import { deduplicateCodexModelInputSchema } from "../model-schema-projection";

describe("Codex model schema projection", () => {
  it("deduplicates repeated schema alternatives without changing required fields", () => {
    const repeatedAction = {
      type: "object",
      properties: {
        action_kind: { const: "walk" },
        duration_ms: { type: "integer", minimum: 50, maximum: 10_000 },
        direction: { type: "string", enum: ["forward", "backward"] },
      },
      required: ["action_kind", "duration_ms", "direction"],
      additionalProperties: false,
      description: "A repeated exact action contract long enough to project.",
    };
    const schema = {
      type: "object",
      properties: {
        first: repeatedAction,
        second: repeatedAction,
      },
      required: ["first", "second"],
      additionalProperties: false,
    };
    const projected = deduplicateCodexModelInputSchema(schema, 100);
    expect(projected.required).toEqual(["first", "second"]);
    expect(projected.$defs).toBeTruthy();
    expect((projected.properties as Record<string, unknown>).first).toEqual({
      $ref: "#/$defs/shared_1",
    });
    expect((projected.properties as Record<string, unknown>).second).toEqual({
      $ref: "#/$defs/shared_1",
    });
    expect(JSON.stringify(projected).length).toBeLessThan(
      JSON.stringify(schema).length,
    );
  });

  it("does not replace non-schema metadata maps with refs", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["safe", "safe"] },
      },
      required: ["mode", "mode"],
    };
    const projected = deduplicateCodexModelInputSchema(schema, 1);
    expect(projected.required).toEqual(["mode", "mode"]);
    expect(
      (projected.properties as Record<string, unknown>).mode,
    ).toMatchObject({ type: "string" });
  });
});
