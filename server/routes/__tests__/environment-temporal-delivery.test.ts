import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import * as broker from "../../services/environment-connectors/actions/action-broker";
import { createEnvironmentActionRouter } from "../environment-action-routes";

afterEach(() => vi.restoreAllMocks());
const path = "/v1/authorities/authority/requests/temporal-successor";
const body = { resident_action_request_id: "resident", predecessor_plan_id: "predecessor",
  predecessor_plan_hash: "hash", checkpoint_id: "checkpoint" };
const store = { inspect: vi.fn() };
const app = () => express().use(createEnvironmentActionRouter(store));

it("reconciles without calling the lease path or returning executable content", async () => {
  const claim = { authorityId: "authority" };
  vi.spyOn(broker, "authenticateEnvironmentActionConnector").mockResolvedValue(claim as never);
  const lease = vi.spyOn(broker, "leasePendingEnvironmentTemporalSuccessor");
  const inspect = vi.spyOn(broker, "readEnvironmentTemporalDeliveryState").mockResolvedValue(null);
  const response = await request(app()).post(path + "/status").send(body);
  expect(response.status).toBe(200);
  expect(inspect).toHaveBeenCalledWith({ claim, bindingStore: store, residentActionRequestId: "resident",
    predecessorPlanId: "predecessor", predecessorPlanHash: "hash", checkpointId: "checkpoint" });
  expect(lease).not.toHaveBeenCalled();
  expect(response.body).toMatchObject({ delivery_state: null, absence_proves_no_effects: false,
    execution_authority: false, automatic_replay_allowed: false });
  expect(response.body).not.toHaveProperty("action_request");
  expect(response.headers["cache-control"]).toBe("no-store");
});

it.each(["bad-body", "unauthenticated"])("reconciliation fails closed for %s", async scenario => {
  const inspect = vi.spyOn(broker, "readEnvironmentTemporalDeliveryState");
  const auth = vi.spyOn(broker, "authenticateEnvironmentActionConnector");
  if (scenario === "unauthenticated") auth.mockRejectedValue(
    new broker.EnvironmentActionBrokerError("action_credential_invalid", 401, "Invalid fixture credential"));
  else auth.mockResolvedValue({ authorityId: "authority" } as never);
  const response = await request(app()).post(path + "/status").send(scenario === "bad-body" ? { ...body, ownerProfileId: "spoof" } : body);
  expect(response.status).toBe(scenario === "bad-body" ? 400 : 401);
  expect(inspect).not.toHaveBeenCalled();
});

it("mounts direct-client delivery without a reasoning binding store but grants no request by default", async () => {
  const claim = { authorityId: "authority" };
  vi.spyOn(broker, "authenticateEnvironmentActionConnector").mockResolvedValue(claim as never);
  const lease = vi.spyOn(broker, "leasePendingEnvironmentTemporalSuccessor").mockResolvedValue(null);
  const response = await request(express().use(createEnvironmentActionRouter())).post(path).send(body);
  expect(response.status).toBe(200);
  expect(lease).toHaveBeenCalledWith({ claim, bindingStore: undefined,
    residentActionRequestId: "resident", predecessorPlanId: "predecessor",
    predecessorPlanHash: "hash", checkpointId: "checkpoint" });
  expect(response.body).toMatchObject({ action_request: null, automatic_replay_allowed: false });
  const inspect = vi.spyOn(broker, "readEnvironmentTemporalDeliveryState").mockResolvedValue(null);
  const reconciled = await request(express().use(createEnvironmentActionRouter())).post(path + "/status").send(body);
  expect(reconciled.status).toBe(200);
  expect(inspect).toHaveBeenCalledWith({ claim, bindingStore: undefined,
    residentActionRequestId: "resident", predecessorPlanId: "predecessor",
    predecessorPlanHash: "hash", checkpointId: "checkpoint" });
});

it("keeps the temporal body limit ahead of the general connector parser", async () => {
  const lease = vi.spyOn(broker, "leasePendingEnvironmentTemporalSuccessor");
  const response = await request(app()).post(path).send({ ...body, padding: "x".repeat(9000) });
  expect(response.status).toBe(413);
  expect(lease).not.toHaveBeenCalled();
});

it("uses the authenticated claim and injected store, with no replay or answer authority", async () => {
  const claim = { authorityId: "authority" };
  const auth = vi.spyOn(broker, "authenticateEnvironmentActionConnector").mockResolvedValue(claim as never);
  const lease = vi.spyOn(broker, "leasePendingEnvironmentTemporalSuccessor").mockResolvedValue(null);
  const response = await request(app()).post(path).send(body);
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(auth).toHaveBeenCalledWith({ authorityId: "authority", authorization: undefined, requiredScope: "action.poll" });
  expect(lease).toHaveBeenCalledWith({ claim, bindingStore: store, residentActionRequestId: "resident",
    predecessorPlanId: "predecessor", predecessorPlanHash: "hash", checkpointId: "checkpoint" });
  expect(response.body).toMatchObject({ action_request: null, automatic_replay_allowed: false,
    answer_authority: false, terminal_eligible: false });
});

it.each([{ ...body, checkpoint_id: "" }, { ...body, predecessor_plan_hash: undefined },
  { ...body, bindingStore: {} }, { ...body, ownerProfileId: "spoofed" }])("rejects malformed or authority-injecting bodies", async input => {
  vi.spyOn(broker, "authenticateEnvironmentActionConnector").mockResolvedValue({ authorityId: "authority" } as never);
  const lease = vi.spyOn(broker, "leasePendingEnvironmentTemporalSuccessor");
  const response = await request(app()).post(path).send(input);
  expect(response.status).toBe(400);
  expect(lease).not.toHaveBeenCalled();
});

it("does not attempt delivery when connector authentication fails", async () => {
  vi.spyOn(broker, "authenticateEnvironmentActionConnector").mockRejectedValue(
    new broker.EnvironmentActionBrokerError("action_credential_invalid", 401, "Connector authentication failed."));
  const lease = vi.spyOn(broker, "leasePendingEnvironmentTemporalSuccessor");
  const response = await request(app()).post(path).send(body);
  expect(response.status).toBe(401);
  expect(lease).not.toHaveBeenCalled();
});
