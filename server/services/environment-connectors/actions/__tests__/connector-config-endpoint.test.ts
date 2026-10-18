import { describe, expect, it } from "vitest";
import { buildEnvironmentActionConnectorEndpoint } from "../action-broker";

describe("environment action connector endpoint", () => {
  it("preserves the canonical authority ID as one Express path segment", () => {
    expect(
      buildEnvironmentActionConnectorEndpoint(
        "http://127.0.0.1:1522/",
        "environment_action_authority:one",
      ),
    ).toBe(
      "http://127.0.0.1:1522/api/environment-action/v1/authorities/environment_action_authority:one",
    );
  });
});
