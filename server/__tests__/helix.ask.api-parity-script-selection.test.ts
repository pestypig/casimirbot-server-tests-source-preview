import { describe, expect, it } from "vitest";

import {
  extractApiParitySessionCookie,
  isApiParityTransportFailure,
  selectApiParityScenarios,
  seedBodyFor,
} from "../../scripts/helix-ask-api-parity-probe";
import {
  API_PARITY_SCENARIOS,
  getEnabledApiParityScenarios,
} from "../services/helix-ask/api-parity-matrix";

describe("Helix Ask API parity script scenario selection", () => {
  it("binds capability-catalog parity to the canonical reusable source target", () => {
    const scenario = API_PARITY_SCENARIOS.find(
      (entry) => entry.id === "capability_catalog_runtime",
    );

    expect(scenario).toMatchObject({
      expected: {
        source_target: "capability_catalog",
        terminal_artifact_kind: "capability_help_summary",
      },
    });
  });

  it("selects enabled scenarios by default", () => {
    const selection = selectApiParityScenarios([]);

    expect(selection.requestedIds).toEqual([]);
    expect(selection.unknownIds).toEqual([]);
    expect(selection.scenarios.map((scenario) => scenario.id)).toEqual(
      getEnabledApiParityScenarios(false).map((scenario) => scenario.id),
    );
  });

  it("preserves explicit scenario filters and removes duplicates", () => {
    const selection = selectApiParityScenarios([
      " capability_catalog_runtime ",
      "capability_catalog_runtime",
    ]);

    expect(selection.requestedIds).toEqual(["capability_catalog_runtime"]);
    expect(selection.unknownIds).toEqual([]);
    expect(selection.scenarios.map((scenario) => scenario.id)).toEqual([
      "capability_catalog_runtime",
    ]);
  });

  it("reports unknown scenario filters instead of silently selecting zero scenarios", () => {
    const selection = selectApiParityScenarios([
      "missing_scenario",
      "capability_catalog_runtime",
    ]);

    expect(selection.requestedIds).toEqual([
      "missing_scenario",
      "capability_catalog_runtime",
    ]);
    expect(selection.unknownIds).toEqual(["missing_scenario"]);
    expect(selection.scenarios.map((scenario) => scenario.id)).toEqual([
      "capability_catalog_runtime",
    ]);
  });

  it("can include disabled scenarios when requested by operator config", () => {
    const disabledScenario = API_PARITY_SCENARIOS.find(
      (scenario) => !scenario.enabled,
    );
    const defaultSelection = selectApiParityScenarios([]);
    const inclusiveSelection = selectApiParityScenarios([], true);

    if (!disabledScenario) {
      expect(defaultSelection.scenarios.map((scenario) => scenario.id)).toEqual(
        API_PARITY_SCENARIOS.map((scenario) => scenario.id),
      );
      expect(
        inclusiveSelection.scenarios.map((scenario) => scenario.id),
      ).toEqual(defaultSelection.scenarios.map((scenario) => scenario.id));
      return;
    }

    expect(
      defaultSelection.scenarios.map((scenario) => scenario.id),
    ).not.toContain(disabledScenario!.id);
    expect(defaultSelection.availableIds).toContain(disabledScenario!.id);
    expect(
      inclusiveSelection.scenarios.map((scenario) => scenario.id),
    ).toContain(disabledScenario!.id);
  });

  it("classifies transport failures separately from parity contract failures", () => {
    expect(isApiParityTransportFailure(new Error("fetch failed"))).toBe(true);
    expect(
      isApiParityTransportFailure(
        new Error("connect ECONNREFUSED 127.0.0.1:5050"),
      ),
    ).toBe(true);
    expect(
      isApiParityTransportFailure(new Error("terminal_authority_mismatch")),
    ).toBe(false);
  });

  it("extracts only the opaque Helix session cookie for keyed developer parity", () => {
    expect(
      extractApiParitySessionCookie(
        "helix_session=opaque-session-value; Path=/; HttpOnly; SameSite=Lax",
      ),
    ).toBe("helix_session=opaque-session-value");
    expect(extractApiParitySessionCookie("other=value; Path=/")).toBeNull();
    expect(extractApiParitySessionCookie(null)).toBeNull();
  });

  it("maps wrong-environment live-source parity to the dedicated runtime seed", () => {
    const scenario = API_PARITY_SCENARIOS.find(
      (entry) => entry.id === "live_source_identity_wrong_environment",
    );

    expect(seedBodyFor(scenario!, "thread:test")).toMatchObject({
      scenario: "live_source_identity_wrong_environment",
      thread_id: "thread:test",
      source_id: "visual_source:live_source_identity_wrong_environment:bound",
    });
  });

  it("maps identity-gap live-source parity to dedicated runtime seeds", () => {
    for (const scenarioId of [
      "live_source_identity_missing_environment_source",
      "live_source_identity_no_situation_run",
      "live_source_identity_no_field_evaluations",
      "live_source_identity_stale_interpretation",
    ]) {
      const scenario = API_PARITY_SCENARIOS.find(
        (entry) => entry.id === scenarioId,
      );
      const seed = seedBodyFor(scenario!, "thread:test");

      expect(seed).toMatchObject({
        scenario: scenarioId,
        thread_id: "thread:test",
        source_id: `visual_source:${scenarioId}:bound`,
      });
    }
  });
});
