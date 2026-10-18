import { expect } from "vitest";

import {
  CODEX_PARITY_AGENT_SPINE_CLASSES,
  CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS,
  CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES,
  CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA,
  CODEX_PARITY_AGENT_SPINE_REENTRY_STATUSES,
  CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS,
  CODEX_PARITY_AGENT_SPINE_STRING_OR_NULL_FIELDS,
  isCodexParityAgentSpineRailFailureCode,
} from "../../services/helix-ask/codex-parity-agent-spine-contract";

type RecordLike = Record<string, unknown>;

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const getPath = (value: unknown, pathParts: string[]): unknown =>
  pathParts.reduce<unknown>((current, key) => {
    const record = readRecord(current);
    return record ? record[key] : undefined;
  }, value);

export const expectSolverTrace = (body: unknown): RecordLike => {
  const trace = readRecord(getPath(body, ["ask_turn_solver_trace"]));
  expect(trace, "interpretation failure: ask_turn_solver_trace missing").toBeTruthy();
  expect(trace?.schema, "interpretation failure: wrong solver trace schema").toBe("helix.ask_turn_solver_trace.v1");
  expect(trace?.assistant_answer, "terminal authority failure: trace must not be an assistant answer").toBe(false);
  expect(trace?.raw_content_included, "terminal authority failure: trace must not include raw content").toBe(false);
  expect(readRecord(trace?.prompt_interpretation), "interpretation failure: prompt_interpretation missing").toBeTruthy();
  expect(Array.isArray(trace?.intent_hypotheses), "interpretation failure: intent_hypotheses missing").toBe(true);
  expect(readRecord(trace?.intent_arbitration), "interpretation failure: intent_arbitration missing").toBeTruthy();
  expect(readRecord(trace?.evidence_reentry_gate), "evidence re-entry failure: evidence_reentry_gate missing").toBeTruthy();
  expect(readRecord(trace?.followup_reasoning_gate), "follow-up reasoning failure: followup_reasoning_gate missing").toBeTruthy();
  return trace as RecordLike;
};

export const expectCodexParityRailTable = (body: unknown): RecordLike => {
  const railTable = readRecord(getPath(body, ["codex_parity_agent_spine_rail_table"]));
  expect(railTable, "Codex parity failure: codex_parity_agent_spine_rail_table missing").toBeTruthy();
  expect(railTable?.schema, "Codex parity failure: wrong rail table schema").toBe(CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA);
  expect(railTable?.assistant_answer, "terminal authority failure: rail table must not be an assistant answer").toBe(false);
  expect(railTable?.terminal_eligible, "terminal authority failure: rail table must not be terminal eligible").toBe(false);
  expect(railTable?.raw_content_included, "terminal authority failure: rail table must not include raw content").toBe(false);
  for (const key of CODEX_PARITY_AGENT_SPINE_STRING_OR_NULL_FIELDS) {
    expect(railTable, `Codex parity failure: rail table field ${key} missing`).toHaveProperty(key);
    expect(
      railTable?.[key] === null || typeof railTable?.[key] === "string",
      `Codex parity failure: rail table field ${key} must be string or null`,
    ).toBe(true);
  }
  expect(Array.isArray(railTable?.visible_tool_surface), "Codex parity failure: visible_tool_surface missing").toBe(true);
  expect(
    (railTable?.visible_tool_surface as unknown[]).every((entry) => typeof entry === "string" && entry.trim().length > 0),
    "Codex parity failure: visible_tool_surface contains non-string entries",
  ).toBe(true);
  expect(railTable?.normalized_codex_parity_classes).toEqual([...CODEX_PARITY_AGENT_SPINE_CLASSES]);
  expect(CODEX_PARITY_AGENT_SPINE_CLASSES).toContain(railTable?.codex_parity_class as never);
  expect(CODEX_PARITY_AGENT_SPINE_REENTRY_STATUSES).toContain(railTable?.reentry_status as never);
  expect(CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES).toContain(railTable?.rail_status as never);
  expect(railTable?.rail_status === "complete").toBe(railTable?.codex_parity_class === "complete");
  if (railTable?.rail_status === "complete") {
    expect(railTable.first_broken_rail).toBeNull();
    expect(railTable.rail_failure_code).toBeNull();
    expect(railTable.repair_target).toBeNull();
  } else {
    expect(CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS).toContain(railTable?.first_broken_rail as never);
    expect(isCodexParityAgentSpineRailFailureCode(railTable?.rail_failure_code)).toBe(true);
    expect(CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS).toContain(railTable?.repair_target as never);
  }
  if (railTable?.selected_capability || railTable?.executed_capability) {
    expect(typeof railTable.admitted_capability, "Codex parity failure: selected/executed capability lacks admission proof").toBe("string");
    expect(String(railTable.admitted_capability).length).toBeGreaterThan(0);
    expect(railTable.admission_proven, "Codex parity failure: selected/executed capability was not admission-proven").toBe(true);
  }
  if (railTable?.reentry_status === "reentered") {
    expect(railTable.reentry_proven).toBe(true);
    expect(typeof railTable.reentry_proof_source).toBe("string");
    expect(String(railTable.reentry_proof_source).length).toBeGreaterThan(0);
  }
  if (railTable?.selected_terminal_kind) {
    expect(railTable.terminal_authority_proven).toBe(true);
    expect(typeof railTable.terminal_authority_proof_source).toBe("string");
    expect(String(railTable.terminal_authority_proof_source).length).toBeGreaterThan(0);
  }
  if (railTable?.visible_terminal_kind) {
    expect(railTable.visible_projection_proven).toBe(true);
    expect(typeof railTable.visible_projection_source).toBe("string");
    expect(String(railTable.visible_projection_source).length).toBeGreaterThan(0);
  }
  return railTable as RecordLike;
};

export const expectPrimaryIntent = (body: unknown, oneOfKinds: string[]): void => {
  const trace = expectSolverTrace(body);
  expect(
    oneOfKinds,
    `interpretation failure: selected_primary_intent=${readString(trace.selected_primary_intent) ?? "missing"}`,
  ).toContain(readString(trace.selected_primary_intent));
};

export const expectContextualToolMention = (body: unknown, cue: string): void => {
  const trace = expectSolverTrace(body);
  const mentions = Array.isArray(getPath(trace, ["prompt_interpretation", "contextual_tool_mentions"]))
    ? getPath(trace, ["prompt_interpretation", "contextual_tool_mentions"]) as unknown[]
    : [];
  const found = mentions
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry))
    .some((entry) => `${readString(entry.verb_or_cue) ?? ""} ${readString(entry.text) ?? ""}`.toLowerCase().includes(cue.toLowerCase()));
  expect(found, `interpretation failure: contextual tool mention ${cue} missing`).toBe(true);
};

export const expectNegativeConstraint = (body: unknown, pattern: RegExp): void => {
  const trace = expectSolverTrace(body);
  const constraints = readStringArray(getPath(trace, ["prompt_interpretation", "negative_constraints"]));
  expect(
    constraints.some((entry) => pattern.test(entry)),
    `interpretation failure: negative constraint ${pattern} missing`,
  ).toBe(true);
};

export const expectNoMutatingToolCalls = (body: unknown): void => {
  const trace = expectSolverTrace(body);
  const bodyRecord = readRecord(body);
  const debug = readRecord(bodyRecord?.debug);
  const loopTrace = readRecord(getPath(body, ["loop_parity_trace"]));
  const actualCalls = Array.isArray(loopTrace?.actual_tool_calls) ? loopTrace.actual_tool_calls : [];
  const mutating = actualCalls
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry))
    .filter((entry) => entry.mutating === true || /set_rate|start|stop|click|open|repair|run|write|delete|update/i.test(readString(entry.tool_id) ?? ""));
  const commandCount = Array.isArray(getPath(trace, ["prompt_interpretation", "executable_operator_commands"]))
    ? (getPath(trace, ["prompt_interpretation", "executable_operator_commands"]) as unknown[]).length
    : 0;
  const gatewayResults = [
    ...(Array.isArray(bodyRecord?.workstation_gateway_call_results)
      ? bodyRecord.workstation_gateway_call_results
      : []),
    ...(Array.isArray(debug?.workstation_gateway_call_results)
      ? debug.workstation_gateway_call_results
      : []),
  ].map(readRecord).filter((entry): entry is RecordLike => Boolean(entry));
  const laneResults = [
    ...(Array.isArray(bodyRecord?.capability_lane_call_results)
      ? bodyRecord.capability_lane_call_results
      : []),
    ...(Array.isArray(debug?.capability_lane_call_results)
      ? debug.capability_lane_call_results
      : []),
  ].map(readRecord).filter((entry): entry is RecordLike => Boolean(entry));
  const successfulExecutionCapabilities = [
    ...gatewayResults
      .filter((entry) => entry.ok === true)
      .map((entry) => readString(entry.capability_id)),
    ...laneResults
      .filter(
        (entry) =>
          entry.ok === true &&
          readString(entry.delegation_status) === "gateway_executed",
      )
      .map((entry) =>
        readString(entry.delegated_capability_id) ?? readString(entry.capability),
      ),
    ...[bodyRecord, debug]
      .map((scope) => readRecord(scope?.capability_result))
      .filter(
        (entry): entry is RecordLike =>
          Boolean(
            entry &&
            /^(?:succeeded|completed|success|ok)$/i.test(
              readString(entry.status) ?? "",
            ),
          ),
      )
      .map((entry) => readString(entry.executed_capability)),
  ].filter((entry): entry is string => Boolean(entry));
  const mutatingExecutionCapabilities = successfulExecutionCapabilities.filter(
    (capability) =>
      /set_rate|start|stop|click|open|repair|run|write|delete|update/i.test(
        capability,
      ),
  );
  expect(mutating, "admission failure: unexpected mutating tool calls").toEqual([]);
  expect(commandCount, "admission failure: executable operator commands present").toBe(0);
  // A capability identifier may legitimately be visible in a manifest,
  // proposal allowlist, or debug catalog. Those are affordances, not proof of
  // execution. Assert only against execution-bearing call/result fields.
  expect(
    mutatingExecutionCapabilities,
    "admission failure: mutating gateway capability executed",
  ).toEqual([]);
};

export const expectNoTerminalArtifact = (body: unknown, artifacts: string[]): void => {
  const terminalArtifactKind =
    readString(getPath(body, ["terminal_artifact_kind"])) ??
    readString(getPath(body, ["ask_turn_solver_trace", "final_arbitration", "terminal_artifact_kind"]));
  const finalAnswerSource =
    readString(getPath(body, ["final_answer_source"])) ??
    readString(getPath(body, ["ask_turn_solver_trace", "final_arbitration", "final_answer_source"]));
  for (const artifact of artifacts) {
    expect(terminalArtifactKind, `terminal authority failure: forbidden terminal artifact ${artifact}`).not.toBe(artifact);
    expect(finalAnswerSource, `terminal authority failure: forbidden final answer source ${artifact}`).not.toBe(artifact);
  }
};

export const expectRouteNotSelected = (body: unknown, routes: string[]): void => {
  const selectedRoute =
    readString(getPath(body, ["route_reason_code"])) ??
    readString(getPath(body, ["route"])) ??
    readString(getPath(body, ["ask_turn_solver_trace", "final_arbitration", "selected_route"]));
  for (const route of routes) {
    expect(selectedRoute, `admission failure: forbidden route selected ${route}`).not.toBe(route);
  }
};

export const expectRouteAuthorityOk = (body: unknown): void => {
  const trace = expectSolverTrace(body);
  const routeAuthority = readRecord(getPath(body, ["route_authority_audit"]));
  expect(
    trace.route_authority_ok === true || routeAuthority?.route_authority_ok === true,
    "terminal authority failure: route authority did not pass",
  ).toBe(true);
};

export const expectTerminalAuthorityOk = (body: unknown): void => {
  const trace = expectSolverTrace(body);
  const terminalAuthority = readRecord(getPath(body, ["terminal_answer_authority"]));
  expect(
    trace.terminal_authority_ok === true || terminalAuthority?.server_authoritative === true,
    "terminal authority failure: terminal authority did not pass",
  ).toBe(true);
};

export const expectNoShortCircuitFlags = (body: unknown): void => {
  const trace = expectSolverTrace(body);
  const loopTrace = readRecord(getPath(body, ["loop_parity_trace"]));
  expect(readStringArray(loopTrace?.short_circuit_risk_flags), "evidence re-entry failure: loop short-circuit flags present").toEqual([]);
  expect(readStringArray(trace.solver_risk_flags), "follow-up reasoning failure: solver risk flags present").toEqual([]);
};

export const expectAnswerMentionsAny = (body: unknown, patterns: RegExp[], label: string): void => {
  const text = [
    readString(getPath(body, ["answer"])),
    readString(getPath(body, ["text"])),
    readString(getPath(body, ["selected_final_answer"])),
  ].filter(Boolean).join("\n");
  expect(
    patterns.some((pattern) => pattern.test(text)),
    `follow-up reasoning failure: answer did not mention ${label}`,
  ).toBe(true);
};

export const expectArbitrationSuppressesRoute = (body: unknown, route: string): void => {
  const trace = expectSolverTrace(body);
  const suppressed = Array.isArray(getPath(trace, ["intent_arbitration", "route_candidates_suppressed"]))
    ? getPath(trace, ["intent_arbitration", "route_candidates_suppressed"]) as unknown[]
    : [];
  const found = suppressed
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry))
    .some((entry) => readString(entry.route) === route);
  expect(found, `admission failure: route ${route} was not suppressed by intent arbitration`).toBe(true);
};
