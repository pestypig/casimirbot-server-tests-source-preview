import { expect, it } from "vitest";
import { EnvironmentSessionPreparationError } from "../preparation-error";
import { HelixReasoningTaskBindingError } from "../../../local-supervisor/reasoning-task-binding-store";
import { PairingStorageError } from "../../../local-supervisor/pairing-ledger-repository";
import { PairingDestinationRegistrationError } from "../../../local-supervisor/pairing-destination-registration";
import { HelixLocalSupervisorCoordinationError } from "../../../local-supervisor/local-supervisor-coordination";
import { HelixAgentApiServiceError } from "../../../helix-agent-api/errors";
import { EnvironmentDurableGoalError } from "../../goals/durable-goal-store";
import { BindingVerificationError } from "../../../local-supervisor/binding-verification-error";

it.each([
  [new Error("durable_snapshot_changed_during_confirmation"), "snapshot_changed"],
  [new Error("durable_database_unavailable"), "database_unavailable"],
  [new Error("durable_snapshot_table_unknown"), "snapshot_table_unknown"],
  [new TypeError("fixture-private-value"), "runtime_type_error"],
  [new ReferenceError("fixture-private-symbol"), "runtime_reference_error"],
  [Object.assign(new Error("fixture-private-value"), { reason: "snapshot_changed" }), "unexpected_failure"],
])("reports only a bounded binding failure category %#", (cause, reason) => {
  const binding = new BindingVerificationError("durability", cause);
  const error = new EnvironmentSessionPreparationError(binding, [], false, undefined, "task_binding");
  expect(error.status).toBe(503);
  expect(error.projection).toMatchObject({ error: "reasoning_binding_verification_failed",
    failure_phase: "task_binding", binding_failure_phase: "durability", binding_failure_reason: reason });
  expect(JSON.stringify(error.projection)).not.toContain("fixture-private");
});

it.each([
  [new HelixReasoningTaskBindingError("reasoning_binding_identity_mismatch", 403), 403, "reasoning_binding_identity_mismatch"],
  [new PairingStorageError("pairing_storage_unreadable"), 503, "pairing_storage_unreadable"],
  [new PairingDestinationRegistrationError("pairing_destination_mismatch", 403), 403, "pairing_destination_mismatch"],
  [new HelixLocalSupervisorCoordinationError("pairing_destination_mismatch", 403), 403, "pairing_destination_mismatch"],
  [new HelixAgentApiServiceError(403, "insufficient_scope", "fixture-private-detail"), 403, "insufficient_scope"],
  [new EnvironmentDurableGoalError("durable_goal_authority_stale", 409, "fixture-private-detail"), 409, "durable_goal_authority_stale"],
])("preserves a recognized rejection's status and code %#", (cause, status, code) => {
  const error = new EnvironmentSessionPreparationError(cause, [], false, undefined, "task_binding");
  expect(error.status).toBe(status);
  expect(error.projection).toMatchObject({ error: code, failure_phase: "task_binding", readiness_confirmed: false });
  expect(JSON.stringify(error.projection)).not.toContain("fixture-private-detail");
});

it("does not reflect an unknown exception's claimed code, message, stack or phase", () => {
  const cause = Object.assign(new Error("fixture-private-message"), {
    code: "fixture-private-code", failure_phase: "fixture-private-phase", status: 200,
  });
  const error = new EnvironmentSessionPreparationError(cause, [], false, undefined, "run_association");
  expect(error.status).toBe(500);
  expect(error.projection).toMatchObject({ error: "environment_session_preparation_failed", failure_phase: "run_association" });
  expect(JSON.stringify(error.projection)).not.toContain("fixture-private");
});
