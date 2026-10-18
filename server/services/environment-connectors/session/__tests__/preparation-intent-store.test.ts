import { describe, expect, it, vi } from "vitest";
import type { HelixLocalSupervisorPresence } from "@shared/helix-local-supervisor-coordination";
import { EnvironmentSessionPreparationIntentStore } from "../preparation-intent-store";

const setup = () => {
  let now = Date.parse("2026-09-08T00:00:00Z");
  const row = { active: true, service_instance_ref: "service:a", authenticated_profile_ref: "profile:a",
    authenticated_mcp_client_ref: "client:a", client_session_ref: "session:a", conversation_thread_ref: "task:a",
    observed_at: new Date(now).toISOString(), heartbeat_expires_at: new Date(now + 180000).toISOString(),
  } as HelixLocalSupervisorPresence;
  const presence = { serviceInstanceRef: "service:a", listPresence: () => [row] };
  const verify = vi.fn(async () => {});
  const store = new EnvironmentSessionPreparationIntentStore(presence, verify, () => now);
  const request = { requestId: "request:a", profileRef: "profile:a", clientSessionRef: "session:a",
    continuationRef: "task:a", roomId: "room:a", helixConversationId: "chat:a", requestedDurationSeconds: 28800 };
  const target = { profileRef: "profile:a", authenticatedMcpClientRef: "client:a", clientSessionRef: "session:a", continuationRef: "task:a" };
  return { store, request, target, presence, row, verify, advance: (ms: number) => { now += ms; } };
};

describe("structured session preparation intent", () => {
  it("prepares once across concurrent retries, retaining a partial run after attachment failure", async () => {
    const f = setup(); const intent = await f.store.request(f.request);
    const ports = { discover: vi.fn(async () => []), create: vi.fn(async () => "run:new"),
      attach: vi.fn(async () => {}), verify: vi.fn(async () => {}) };
    ports.attach.mockRejectedValueOnce(new Error("attachment_temporarily_unavailable"));
    const prepare = () => f.store.prepareRun(f.target, intent.intentId, { objective: "Prepare session" }, ports);
    await expect(prepare()).rejects.toThrow("attachment_temporarily_unavailable");
    expect(f.store.read(f.target)).toHaveLength(1);
    const results = await Promise.all([prepare(), prepare(), prepare()]);
    expect(results.every(row => row.preparedRunId === "run:new" && !row.execution_authority)).toBe(true);
    expect(ports.create).toHaveBeenCalledTimes(1);
    expect(ports.create).toHaveBeenCalledWith({ idempotencyKey: expect.stringMatching(/^preparation:/),
      objective: "Prepare session", durationSeconds: 28800 });
    expect(ports.discover).toHaveBeenCalledTimes(1);
    await expect(f.store.prepareRun(f.target, intent.intentId, { objective: "Changed" }, ports))
      .rejects.toThrow("preparation_request_conflict");
  });
  it("requires explicit existing-run selection and never creates a replacement on failed verification", async () => {
    const f = setup(); const intent = await f.store.request(f.request);
    const ports = { discover: vi.fn(async () => [{ runId: "run:existing" }]), create: vi.fn(async () => "bad"),
      attach: vi.fn(async () => {}), verify: vi.fn(async () => {}) };
    await expect(f.store.prepareRun(f.target, intent.intentId, { objective: "Prepare" }, ports))
      .rejects.toThrow("preparation_run_selection_required");
    const prepare = () => f.store.prepareRun(f.target, intent.intentId, { runId: "run:existing" }, ports);
    await prepare();
    ports.verify.mockRejectedValueOnce(new Error("run_revoked"));
    await expect(prepare()).rejects.toThrow("run_revoked");
    expect(ports.create).not.toHaveBeenCalled();
  });
  it("retains creation identity when presence expires before attachment and stops foreign callers", async () => {
    const f = setup(); const intent = await f.store.request(f.request);
    const ports = { discover: vi.fn(async () => []), create: vi.fn(async () => { f.row.active = false; return "run:partial"; }),
      attach: vi.fn(async () => {}), verify: vi.fn(async () => {}) };
    const prepare = () => f.store.prepareRun(f.target, intent.intentId, { objective: "Prepare" }, ports);
    await expect(prepare()).rejects.toThrow("preparation_target_unavailable");
    expect(ports.attach).not.toHaveBeenCalled();
    f.row.active = true;
    await expect(f.store.prepareRun({ ...f.target, authenticatedMcpClientRef: "foreign" }, intent.intentId,
      { objective: "Prepare" }, ports)).rejects.toThrow("preparation_target_mismatch");
    expect((await prepare()).preparedRunId).toBe("run:partial");
    expect(ports.create).toHaveBeenCalledTimes(1);
  });
  it("retires a verified preparation from pickup without granting session readiness or changing aliases", async () => {
    const f = setup(); const intent = await f.store.request(f.request);
    await f.store.request({ ...f.request, requestId: "alias" });
    const verify = vi.fn(async () => {});
    const first = await f.store.acknowledgeRun(f.target, intent.intentId, "run:a", verify);
    expect(first).toMatchObject({ status: "run_prepared", preparedRunId: "run:a", execution_authority: false,
      task_binding_authority: false, answer_authority: false, terminal_eligible: false });
    expect(f.store.read(f.target)).toEqual([]);
    expect(await f.store.request({ ...f.request, requestId: "alias" })).toEqual(first);
    expect(await f.store.acknowledgeRun(f.target, intent.intentId, "run:a", verify)).toEqual(first);
    expect(verify).toHaveBeenCalledTimes(2);
    await expect(f.store.acknowledgeRun(f.target, intent.intentId, "run:b", verify)).rejects.toThrow("preparation_run_conflict");
    verify.mockRejectedValueOnce(new Error("run_revoked"));
    await expect(f.store.acknowledgeRun(f.target, intent.intentId, "run:a", verify)).rejects.toThrow("run_revoked");
  });
  it("keeps pickup pending when run verification fails and rejects target loss during validation", async () => {
    const f = setup(); const intent = await f.store.request(f.request);
    await expect(f.store.acknowledgeRun(f.target, intent.intentId, "run:a", async () => { throw new Error("wrong_room"); }))
      .rejects.toThrow("wrong_room");
    expect(f.store.read(f.target)).toHaveLength(1);
    await expect(f.store.acknowledgeRun(f.target, intent.intentId, "run:a", async () => { f.row.active = false; }))
      .rejects.toThrow("preparation_target_unavailable");
    f.row.active = true;
    expect(f.store.read(f.target)[0].status).toBe("pending");
  });
  it("coalesces concurrent identical selections across windows without extending expiry", async () => {
    const f = setup();
    const intents = await Promise.all(["window:a", "window:b", "window:c"].map(requestId =>
      f.store.request({ ...f.request, requestId })));
    expect(new Set(intents.map(intent => intent.intentId)).size).toBe(1);
    expect(f.store.read(f.target)).toHaveLength(1);
    f.advance(10000);
    expect(await f.store.request({ ...f.request, requestId: "window:b" })).toEqual(intents[0]);
    await expect(f.store.request({ ...f.request, requestId: "window:b", requestedDurationSeconds: 3600 }))
      .rejects.toThrow("preparation_request_conflict");
  });
  it("does not coalesce different chat, room or duration selections", async () => {
    const f = setup(); await f.store.request(f.request);
    await f.store.request({ ...f.request, requestId: "request:b", helixConversationId: "chat:b" });
    await f.store.request({ ...f.request, requestId: "request:c", roomId: "room:b" });
    await f.store.request({ ...f.request, requestId: "request:d", requestedDurationSeconds: 3600 });
    expect(f.store.read(f.target)).toHaveLength(4);
  });
  it("does not revive expired aliases when a new explicit request is made", async () => {
    const f = setup();
    const old = await f.store.request(f.request);
    await f.store.request({ ...f.request, requestId: "alias" });
    f.advance(600000); f.row.heartbeat_expires_at = "2026-09-08T01:00:00Z";
    const next = await f.store.request({ ...f.request, requestId: "new" });
    expect(next.intentId).not.toBe(old.intentId);
    expect(f.store.read(f.target)).toEqual([next]);
    await expect(f.store.request({ ...f.request, requestId: "alias" })).rejects.toThrow("preparation_intent_expired");
  });
  it("deduplicates retries and preserves non-authority without creating or completing work", async () => {
    const f = setup();
    const first = await f.store.request(f.request);
    for (let i = 0; i < 3; i++) expect(await f.store.request(f.request)).toEqual(first);
    expect(f.store.read(f.target)).toEqual([first]);
    expect(first).toMatchObject({ origin: "authenticated_browser_setup", status: "pending",
      execution_authority: false, task_binding_authority: false, answer_authority: false });
    first.roomId = "poison";
    expect(f.store.read(f.target)[0].roomId).toBe("room:a");
  });
  it.each(["profileRef", "authenticatedMcpClientRef", "clientSessionRef", "continuationRef"] as const)("rejects foreign %s", async key => {
    const f = setup(); await f.store.request(f.request);
    expect(() => f.store.read({ ...f.target, [key]: "foreign" })).toThrow();
  });
  it("rejects changed payload under a reused request ID", async () => {
    const f = setup(); await f.store.request(f.request);
    await expect(f.store.request({ ...f.request, roomId: "room:other" })).rejects.toThrow("preparation_request_conflict");
  });
  it("requires browser selection verification and rechecks presence after it", async () => {
    const f = setup(); f.verify.mockRejectedValueOnce(new Error("chat_not_owned"));
    await expect(f.store.request(f.request)).rejects.toThrow("chat_not_owned");
    expect(f.store.read(f.target)).toEqual([]);
    f.verify.mockImplementationOnce(async () => { f.row.active = false; });
    await expect(f.store.request(f.request)).rejects.toThrow("preparation_target_unavailable");
  });
  it("rejects stale presence and cannot replay intents across service restart", async () => {
    const f = setup(); await f.store.request(f.request);
    f.advance(180000);
    expect(() => f.store.read(f.target)).toThrow("preparation_target_unavailable");
    f.row.heartbeat_expires_at = "2026-09-08T01:00:00Z";
    f.presence.serviceInstanceRef = "service:b"; f.row.service_instance_ref = "service:b";
    expect(f.store.read(f.target)).toEqual([]);
    await expect(f.store.request(f.request)).rejects.toThrow("preparation_service_changed");
  });
  it("does not revive an expired intent using a refreshed heartbeat", async () => {
    const f = setup(); await f.store.request(f.request); f.advance(600000);
    f.row.heartbeat_expires_at = "2026-09-08T01:00:00Z";
    expect(f.store.read(f.target)).toEqual([]);
    await expect(f.store.request(f.request)).rejects.toThrow("preparation_intent_expired");
  });
});
