import { describe, expect, it, afterEach } from "vitest";
import {
  buildHelixAskTurnAdmissionPayload,
  getHelixAskTurnAdmissionSnapshot,
  reserveHelixAskTurnAdmission,
  resetHelixAskTurnAdmissionForTests,
} from "../ask-turn-admission";
import type { RuntimeAdmissionDecision, RuntimeTaskLease } from "../../runtime/runtime-memory-governor";

const makeRuntimeAdmission = (overrides: Partial<RuntimeAdmissionDecision> = {}): RuntimeAdmissionDecision => {
  const lease: RuntimeTaskLease = {
    id: `lease-${Math.random().toString(16).slice(2)}`,
    taskClass: "active_user_turn",
    admittedAtMs: Date.now(),
    release: () => undefined,
  };
  return {
    action: "admit",
    admitted: true,
    reason: "ok",
    pressureLevel: "normal",
    memory: {
      heapUsedMiB: 100,
      heapTotalMiB: 200,
      rssMiB: 300,
      externalMiB: 0,
      arrayBuffersMiB: 0,
    },
    host: {
      freeMiB: 4096,
      totalMiB: 8192,
      freeRatio: 0.5,
    },
    limits: {
      maxHeapUsedMiB: 2048,
      maxRssMiB: 7100,
      resumeHeapUsedMiB: 1700,
      resumeRssMiB: 6000,
    },
    pausedTaskCount: 0,
    activeTaskCount: 0,
    lease,
    ...overrides,
  };
};

describe("ask turn admission", () => {
  afterEach(() => {
    delete process.env.HELIX_ASK_ACTIVE_FULL_WORKLOADS_MAX;
    delete process.env.HELIX_ASK_CONCURRENCY_MAX;
    delete process.env.HELIX_ASK_QUEUE_MAX;
    resetHelixAskTurnAdmissionForTests();
  });

  it("admits one foreground workload and releases it", () => {
    process.env.HELIX_ASK_ACTIVE_FULL_WORKLOADS_MAX = "1";
    const admission = reserveHelixAskTurnAdmission({
      sessionId: "session-a",
      turnId: "ask:one",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission(),
    });

    expect(admission.status).toBe("admitted");
    expect(admission.assistant_answer).toBe(false);
    expect(admission.terminal_eligible).toBe(false);
    expect(admission.raw_content_included).toBe(false);
    expect(getHelixAskTurnAdmissionSnapshot().active_workloads).toBe(1);

    if (admission.status === "admitted") admission.release("completed");
    expect(getHelixAskTurnAdmissionSnapshot().active_workloads).toBe(0);
  });

  it("queues a second turn for the same session", () => {
    const first = reserveHelixAskTurnAdmission({
      sessionId: "session-a",
      turnId: "ask:one",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission(),
    });
    expect(first.status).toBe("admitted");

    const second = reserveHelixAskTurnAdmission({
      sessionId: "session-a",
      turnId: "ask:two",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission(),
    });

    expect(second).toMatchObject({
      status: "queued",
      reason: "session_busy",
      queue_position: 1,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(getHelixAskTurnAdmissionSnapshot().queued_turn_count).toBe(1);
    if (first.status === "admitted") first.release("completed");
  });

  it("queues a second global workload when full workload slots are consumed", () => {
    process.env.HELIX_ASK_ACTIVE_FULL_WORKLOADS_MAX = "1";
    const first = reserveHelixAskTurnAdmission({
      sessionId: "session-a",
      turnId: "ask:one",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission(),
    });
    expect(first.status).toBe("admitted");

    const second = reserveHelixAskTurnAdmission({
      sessionId: "session-b",
      turnId: "ask:two",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission(),
    });

    expect(second).toMatchObject({
      status: "queued",
      reason: "instance_capacity",
      queue_position: 1,
    });
    if (first.status === "admitted") first.release("completed");
  });

  it("rejects when the queue is full", () => {
    process.env.HELIX_ASK_ACTIVE_FULL_WORKLOADS_MAX = "1";
    process.env.HELIX_ASK_QUEUE_MAX = "1";
    const first = reserveHelixAskTurnAdmission({
      sessionId: "session-a",
      turnId: "ask:one",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission(),
    });
    expect(first.status).toBe("admitted");
    expect(reserveHelixAskTurnAdmission({
      sessionId: "session-b",
      turnId: "ask:two",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission(),
    }).status).toBe("queued");

    const third = reserveHelixAskTurnAdmission({
      sessionId: "session-c",
      turnId: "ask:three",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission(),
    });

    expect(third).toMatchObject({
      status: "rejected",
      reason: "queue_full",
      pressure_level: "hard_pressure",
    });
    if (first.status === "admitted") first.release("completed");
  });

  it("rejects hard pressure before same-session queueing", () => {
    const first = reserveHelixAskTurnAdmission({
      sessionId: "session-a",
      turnId: "ask:one",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission(),
    });
    expect(first.status).toBe("admitted");

    const second = reserveHelixAskTurnAdmission({
      sessionId: "session-a",
      turnId: "ask:two",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission({
        admitted: false,
        action: "reject_memory_pressure",
        reason: "rss_limit",
        pressureLevel: "hard_pressure",
        lease: undefined,
      }),
    });

    expect(second).toMatchObject({
      status: "rejected",
      reason: "memory_hard_pressure",
      pressure_level: "hard_pressure",
    });
    expect(getHelixAskTurnAdmissionSnapshot().queued_turn_count).toBe(0);
    if (first.status === "admitted") first.release("completed");
  });

  it("preserves host commit exhaustion as an actionable typed rejection", () => {
    const admission = reserveHelixAskTurnAdmission({
      sessionId: "session-a",
      turnId: "ask:commit-pressure",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission({
        admitted: false,
        action: "reject_memory_pressure",
        reason: "host_commit_pressure",
        pressureLevel: "hard_pressure",
        host: {
          freeMiB: 4096,
          totalMiB: 16384,
          freeRatio: 0.25,
          commit: {
            status: "available",
            source: "windows_wmic",
            platform: "win32",
            committedMiB: 18200,
            limitMiB: 20000,
            freeMiB: 1800,
            ratio: 0.91,
            sampledAtMs: 1234,
            ageMs: 0,
          },
        },
        lease: undefined,
      }),
    });

    expect(admission).toMatchObject({
      status: "rejected",
      reason: "host_commit_pressure",
      pressure_level: "hard_pressure",
      runtime_reason: "host_commit_pressure",
      host_commit: {
        status: "available",
        freeMiB: 1800,
        limitMiB: 20000,
        ratio: 0.91,
      },
    });
    if (admission.status !== "rejected") throw new Error("expected rejected admission");
    expect(buildHelixAskTurnAdmissionPayload({ admission })).toMatchObject({
      response_type: "capacity_rejected",
      final_status: "final_failure",
      route_reason_code: "ask_turn_admission / host_commit_pressure",
      ask_turn_admission: {
        runtime_reason: "host_commit_pressure",
        host_commit: {
          freeMiB: 1800,
          limitMiB: 20000,
          ratio: 0.91,
        },
      },
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("builds non-terminal typed queue payloads", () => {
    const admission = reserveHelixAskTurnAdmission({
      sessionId: "session-a",
      turnId: "ask:one",
      route: "/ask/turn",
      runtimeAdmission: makeRuntimeAdmission({
        admitted: false,
        action: "queue",
        pressureLevel: "soft_pressure",
        lease: undefined,
      }),
    });
    expect(admission.status).toBe("queued");
    if (admission.status !== "queued") throw new Error("expected queued admission");

    const payload = buildHelixAskTurnAdmissionPayload({ admission });
    expect(payload).toMatchObject({
      response_type: "queued",
      final_status: "pending_input",
      terminal_artifact_kind: "ask_turn_admission",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });
});
