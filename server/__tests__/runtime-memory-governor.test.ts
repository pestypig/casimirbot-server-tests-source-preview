import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runtimeMemoryGovernor,
  type RuntimeHostMemoryReader,
  type RuntimeMemoryReader,
} from "../services/runtime/runtime-memory-governor";

const mib = 1024 * 1024;

const memoryReader = (values: Partial<NodeJS.MemoryUsage>): RuntimeMemoryReader => () => ({
  rss: values.rss ?? 200 * mib,
  heapTotal: values.heapTotal ?? 120 * mib,
  heapUsed: values.heapUsed ?? 100 * mib,
  external: values.external ?? 10 * mib,
  arrayBuffers: values.arrayBuffers ?? 2 * mib,
});

const hostReader = (freeRatio = 0.5): RuntimeHostMemoryReader => () => ({
  freeMiB: 8000 * freeRatio,
  totalMiB: 8000,
  freeRatio,
});

describe("runtime memory governor", () => {
  beforeEach(() => {
    delete process.env.RUNTIME_MEMORY_GUARD;
    delete process.env.RUNTIME_MEMORY_MAX_HEAP_USED_MB;
    delete process.env.RUNTIME_MEMORY_MAX_RSS_MB;
    delete process.env.RUNTIME_MEMORY_RESUME_HEAP_USED_MB;
    delete process.env.RUNTIME_MEMORY_RESUME_RSS_MB;
    delete process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_MIN;
    delete process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_SOFT_MIN;
    delete process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_MIN_MB;
    delete process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_SOFT_MIN_MB;
    delete process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_MAX;
    delete process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_SOFT_MAX;
    delete process.env.HELIX_LOW_MEMORY_IDLE_GC;
    delete process.env.RUNTIME_MEMORY_V8_HEAP_SAFETY_RESERVE_MB;
    delete process.env.HELIX_HOST_COMMIT_REQUIRED;
    delete process.env.VOICE_TRANSCRIBE_MEMORY_GUARD;
    delete process.env.VOICE_TRANSCRIBE_MAX_HEAP_USED_MB;
    delete process.env.VOICE_TRANSCRIBE_MAX_RSS_MB;
    delete process.env.VOICE_TTS_MAX_HEAP_USED_MB;
    delete process.env.VOICE_TTS_MAX_RSS_MB;
    delete process.env.VOICE_TTS_RESUME_HEAP_USED_MB;
    delete process.env.VOICE_TTS_RESUME_RSS_MB;
    delete process.env.RUNTIME_TASK_VOICE_STT_BURST_LIMIT;
    delete process.env.RUNTIME_TASK_VOICE_STT_BURST_WINDOW_MS;
    delete process.env.STAGE_PLAY_MAIL_WAKE_PRESSURE_BYPASS_FOR_LOCAL;
    delete process.env.STAGE_PLAY_MAIL_WAKE_LOCAL_PRESSURE_BYPASS;
    delete process.env.STAGE_PLAY_MAIL_WAKE_LOCAL_BYPASS_MAX_HEAP_MB;
    delete process.env.STAGE_PLAY_MAIL_WAKE_LOCAL_BYPASS_MAX_RSS_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_MAX_HEAP_USED_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_MAX_RSS_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_RESUME_HEAP_USED_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_RESUME_RSS_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_MAX_CONCURRENT;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_BURST_LIMIT;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_BURST_WINDOW_MS;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_HEAP_USED_MB;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_RSS_MB;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_RESUME_HEAP_USED_MB;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_RESUME_RSS_MB;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_ESTIMATED_BURST_MB;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 100 * mib, rss: 200 * mib }),
      hostMemoryReader: hostReader(),
    });
  });

  afterEach(() => {
    delete process.env.RUNTIME_MEMORY_GUARD;
    delete process.env.RUNTIME_MEMORY_MAX_HEAP_USED_MB;
    delete process.env.RUNTIME_MEMORY_MAX_RSS_MB;
    delete process.env.RUNTIME_MEMORY_RESUME_HEAP_USED_MB;
    delete process.env.RUNTIME_MEMORY_RESUME_RSS_MB;
    delete process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_MIN;
    delete process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_SOFT_MIN;
    delete process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_MIN_MB;
    delete process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_SOFT_MIN_MB;
    delete process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_MAX;
    delete process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_SOFT_MAX;
    delete process.env.HELIX_LOW_MEMORY_IDLE_GC;
    delete process.env.RUNTIME_MEMORY_V8_HEAP_SAFETY_RESERVE_MB;
    delete process.env.HELIX_HOST_COMMIT_REQUIRED;
    delete process.env.VOICE_TRANSCRIBE_MEMORY_GUARD;
    delete process.env.VOICE_TRANSCRIBE_MAX_HEAP_USED_MB;
    delete process.env.VOICE_TRANSCRIBE_MAX_RSS_MB;
    delete process.env.VOICE_TTS_MAX_HEAP_USED_MB;
    delete process.env.VOICE_TTS_MAX_RSS_MB;
    delete process.env.VOICE_TTS_RESUME_HEAP_USED_MB;
    delete process.env.VOICE_TTS_RESUME_RSS_MB;
    delete process.env.RUNTIME_TASK_VOICE_STT_BURST_LIMIT;
    delete process.env.RUNTIME_TASK_VOICE_STT_BURST_WINDOW_MS;
    delete process.env.STAGE_PLAY_MAIL_WAKE_PRESSURE_BYPASS_FOR_LOCAL;
    delete process.env.STAGE_PLAY_MAIL_WAKE_LOCAL_PRESSURE_BYPASS;
    delete process.env.STAGE_PLAY_MAIL_WAKE_LOCAL_BYPASS_MAX_HEAP_MB;
    delete process.env.STAGE_PLAY_MAIL_WAKE_LOCAL_BYPASS_MAX_RSS_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_MAX_HEAP_USED_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_MAX_RSS_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_RESUME_HEAP_USED_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_RESUME_RSS_MB;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_MAX_CONCURRENT;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_BURST_LIMIT;
    delete process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_BURST_WINDOW_MS;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_HEAP_USED_MB;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_RSS_MB;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_RESUME_HEAP_USED_MB;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_RESUME_RSS_MB;
    delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_ESTIMATED_BURST_MB;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
  });

  it("admits voice_stt below heap and rss thresholds", () => {
    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

    expect(decision.admitted).toBe(true);
    expect(decision.action).toBe("admit");
    expect(decision.reason).toBe("ok");
    expect(decision.lease).toBeTruthy();
  });

  it("rejects voice_stt above heap threshold", () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 600 * mib, rss: 700 * mib }),
      hostMemoryReader: hostReader(),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

    expect(decision.admitted).toBe(false);
    expect(decision.action).toBe("reject_memory_pressure");
    expect(decision.reason).toBe("heap_used_limit");
  });

  it("rejects voice_stt above rss threshold", () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 300 * mib, rss: 1000 * mib }),
      hostMemoryReader: hostReader(),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toBe("rss_limit");
  });

  it("uses higher default voice STT headroom in development", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 1900 * mib, rss: 2400 * mib }),
        hostMemoryReader: hostReader(),
      });

      const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

      expect(decision.admitted).toBe(true);
      expect(decision.limits.maxHeapUsedMiB).toBe(2048);
      expect(decision.limits.maxRssMiB).toBe(3200);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("still rejects development voice STT when local runtime headroom is exhausted", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 2100 * mib, rss: 3300 * mib }),
        hostMemoryReader: hostReader(),
      });

      const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

      expect(decision.admitted).toBe(false);
      expect(decision.reason).toBe("heap_used_limit");
      expect(decision.limits.maxHeapUsedMiB).toBe(2048);
      expect(decision.limits.maxRssMiB).toBe(3200);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("keeps explicit voice STT env limits authoritative in development", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.VOICE_TRANSCRIBE_MAX_HEAP_USED_MB = "480";
      process.env.VOICE_TRANSCRIBE_MAX_RSS_MB = "900";
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 600 * mib, rss: 700 * mib }),
        hostMemoryReader: hostReader(),
      });

      const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

      expect(decision.admitted).toBe(false);
      expect(decision.reason).toBe("heap_used_limit");
      expect(decision.limits.maxHeapUsedMiB).toBe(480);
      expect(decision.limits.maxRssMiB).toBe(900);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("uses separate higher default voice TTS headroom in development", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 1500 * mib, rss: 1800 * mib }),
        hostMemoryReader: hostReader(),
      });

      const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_tts" });

      expect(decision.admitted).toBe(true);
      expect(decision.limits.maxHeapUsedMiB).toBe(2048);
      expect(decision.limits.maxRssMiB).toBe(3200);
      decision.lease?.release("completed");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("keeps explicit voice TTS env limits authoritative in development", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.VOICE_TTS_MAX_HEAP_USED_MB = "700";
      process.env.VOICE_TTS_MAX_RSS_MB = "1200";
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 800 * mib, rss: 900 * mib }),
        hostMemoryReader: hostReader(),
      });

      const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_tts" });

      expect(decision.admitted).toBe(false);
      expect(decision.reason).toBe("heap_used_limit");
      expect(decision.limits.maxHeapUsedMiB).toBe(700);
      expect(decision.limits.maxRssMiB).toBe(1200);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("allows guard disabled mode", () => {
    process.env.VOICE_TRANSCRIBE_MEMORY_GUARD = "0";
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 900 * mib, rss: 1200 * mib }),
      hostMemoryReader: hostReader(),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

    expect(decision.admitted).toBe(true);
    expect(decision.reason).toBe("guard_disabled");
  });

  it("pauses lower priority work under soft pressure", () => {
    let paused = false;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 430 * mib, rss: 760 * mib }),
      hostMemoryReader: hostReader(),
    });
    runtimeMemoryGovernor.registerPausableRuntimeTask({
      id: "stage-play-1",
      taskClass: "stage_play_refresh",
      priority: 35,
      isPaused: () => paused,
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

    expect(decision.admitted).toBe(true);
    expect(decision.action).toBe("pause_existing_background");
    expect(decision.reason).toBe("background_paused");
    expect(decision.pausedTaskCount).toBe(1);
  });

  it("resumes paused tasks below resume thresholds", async () => {
    let paused = false;
    let currentHeap = 430 * mib;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => memoryReader({ heapUsed: currentHeap, rss: 760 * mib })(),
      hostMemoryReader: hostReader(),
    });
    runtimeMemoryGovernor.registerPausableRuntimeTask({
      id: "repo-index-1",
      taskClass: "repo_indexing",
      priority: 20,
      isPaused: () => paused,
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
    });
    runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });
    expect(paused).toBe(true);

    currentHeap = 200 * mib;
    const resumed = await runtimeMemoryGovernor.maybeResumePausedTasks();

    expect(resumed).toBe(1);
    expect(paused).toBe(false);
  });

  it("lease release decrements active task count", () => {
    const admitted = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });
    expect(runtimeMemoryGovernor.getRuntimeMemorySnapshot().activeTasks).toHaveLength(1);

    admitted.lease?.release("completed");

    expect(runtimeMemoryGovernor.getRuntimeMemorySnapshot().activeTasks).toHaveLength(0);
  });

  it("rejects a second concurrent voice STT task before allocating another burst", () => {
    const first = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });
    expect(first.admitted).toBe(true);

    const second = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

    expect(second.admitted).toBe(false);
    expect(second.action).toBe("reject_runtime_capacity");
    expect(second.reason).toBe("concurrency_limit");
    expect(runtimeMemoryGovernor.getRuntimeTaskSnapshot().classes.find((entry) => entry.taskClass === "voice_stt")).toMatchObject({
      activeCount: 1,
      maxConcurrent: 1,
    });
    first.lease?.release("completed");
  });

  it("applies per-class burst budgets from env", () => {
    process.env.RUNTIME_TASK_VOICE_STT_BURST_LIMIT = "2";
    process.env.RUNTIME_TASK_VOICE_STT_BURST_WINDOW_MS = "60000";

    const first = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });
    expect(first.admitted).toBe(true);
    first.lease?.release("completed");
    const second = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });
    expect(second.admitted).toBe(true);
    second.lease?.release("completed");

    const third = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });

    expect(third.admitted).toBe(false);
    expect(third.action).toBe("reject_runtime_capacity");
    expect(third.reason).toBe("burst_limit");
  });

  it("queues deferrable tasks when their concurrency lane is occupied", () => {
    const first = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "stage_play_refresh" });
    expect(first.admitted).toBe(true);

    const second = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "stage_play_refresh" });

    expect(second.admitted).toBe(false);
    expect(second.action).toBe("queue");
    expect(second.reason).toBe("concurrency_limit");
    first.lease?.release("completed");
  });

  it("allows local stage play refresh pressure bypass without foreground or voice work", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.STAGE_PLAY_MAIL_WAKE_PRESSURE_BYPASS_FOR_LOCAL = "1";
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
        hostMemoryReader: hostReader(),
      });

      const decision = runtimeMemoryGovernor.admitRuntimeTask({
        taskClass: "stage_play_refresh",
        source: "stage_play_live_source_mail_wake",
      });

      expect(decision.admitted).toBe(true);
      expect(decision.action).toBe("admit");
      expect(decision.reason).toBe("local_stage_play_refresh_bypass");
      expect(decision.pressureLevel).toBe("hard_pressure");
      decision.lease?.release("completed");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("does not bypass stage play refresh pressure while an active user turn is running", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.STAGE_PLAY_MAIL_WAKE_PRESSURE_BYPASS_FOR_LOCAL = "1";
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
        hostMemoryReader: hostReader(),
      });
      const userTurn = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "active_user_turn" });
      expect(userTurn.admitted).toBe(true);

      const decision = runtimeMemoryGovernor.admitRuntimeTask({
        taskClass: "stage_play_refresh",
        source: "stage_play_live_source_mail_wake",
      });

      expect(decision.admitted).toBe(false);
      expect(decision.action).toBe("queue");
      expect(decision.reason).toBe("queue_deferrable");
      userTurn.lease?.release("completed");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("does not bypass stage play refresh pressure while voice work is running", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.STAGE_PLAY_MAIL_WAKE_PRESSURE_BYPASS_FOR_LOCAL = "1";
      let heapUsed = 100 * mib;
      let rss = 200 * mib;
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: () => memoryReader({ heapUsed, rss })(),
        hostMemoryReader: hostReader(),
      });
      const voice = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_tts" });
      expect(voice.admitted).toBe(true);
      heapUsed = 700 * mib;
      rss = 1200 * mib;

      const decision = runtimeMemoryGovernor.admitRuntimeTask({
        taskClass: "stage_play_refresh",
        source: "stage_play_live_source_mail_wake",
      });

      expect(decision.admitted).toBe(false);
      expect(decision.action).toBe("queue");
      expect(decision.reason).toBe("queue_deferrable");
      voice.lease?.release("completed");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("applies per-class memory limits to stage play refresh", () => {
    process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_MAX_HEAP_USED_MB = "1000";
    process.env.RUNTIME_TASK_STAGE_PLAY_REFRESH_MAX_RSS_MB = "1500";
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
      hostMemoryReader: hostReader(),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "stage_play_refresh" });

    expect(decision.admitted).toBe(true);
    expect(decision.reason).toBe("ok");
    expect(decision.limits.maxHeapUsedMiB).toBe(1000);
    expect(decision.limits.maxRssMiB).toBe(1500);
    decision.lease?.release("completed");
  });

  it("uses explicit active user turn memory headroom instead of generic fallback limits", () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
      hostMemoryReader: hostReader(),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "active_user_turn" });

    expect(decision.admitted).toBe(true);
    expect(decision.reason).toBe("ok");
    expect(decision.pressureLevel).toBe("normal");
    expect(decision.limits.maxHeapUsedMiB).toBe(2048);
    expect(decision.limits.maxRssMiB).toBe(3200);
    decision.lease?.release("completed");
  });

  it("rejects active user turns under configured hard memory pressure", () => {
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_HEAP_USED_MB = "600";
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_RSS_MB = "1000";
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
      hostMemoryReader: hostReader(),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "active_user_turn" });

    expect(decision.admitted).toBe(false);
    expect(decision.action).toBe("reject_memory_pressure");
    expect(decision.reason).toBe("heap_used_limit");
    expect(decision.pressureLevel).toBe("hard_pressure");
    expect(decision.limits.maxHeapUsedMiB).toBe(600);
    expect(decision.limits.maxRssMiB).toBe(1000);
  });

  it("admits active user turns under soft pressure after preserving foreground workload", () => {
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_HEAP_USED_MB = "1000";
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_RSS_MB = "1500";
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_RESUME_HEAP_USED_MB = "600";
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_RESUME_RSS_MB = "900";
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
      hostMemoryReader: hostReader(),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "active_user_turn" });

    expect(decision.admitted).toBe(true);
    expect(decision.action).toBe("admit");
    expect(decision.pressureLevel).toBe("soft_pressure");
    decision.lease?.release("completed");
  });

  it("classifies low host free ratio as soft pressure before the hard host limit", () => {
    process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_SOFT_MIN = "0.18";
    process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_MIN = "0.14";
    // Isolate the underlying pressure classifier from the separately tested
    // active-turn provider-burst reserve.
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_ESTIMATED_BURST_MB = "1";
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 100 * mib, rss: 200 * mib }),
      hostMemoryReader: hostReader(0.141),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "active_user_turn" });

    expect(decision.admitted).toBe(true);
    expect(decision.pressureLevel).toBe("soft_pressure");
    decision.lease?.release("completed");
  });

  it("resumes a paused local Stage Play wake after the foreground turn releases", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.STAGE_PLAY_MAIL_WAKE_PRESSURE_BYPASS_FOR_LOCAL = "1";
      process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_HEAP_USED_MB = "1000";
      process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_RSS_MB = "1500";
      process.env.RUNTIME_TASK_ACTIVE_USER_TURN_RESUME_HEAP_USED_MB = "600";
      process.env.RUNTIME_TASK_ACTIVE_USER_TURN_RESUME_RSS_MB = "900";
      let paused = false;
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
        hostMemoryReader: hostReader(),
      });
      runtimeMemoryGovernor.registerPausableRuntimeTask({
        id: "stage-play-wake-service",
        taskClass: "stage_play_refresh",
        priority: 35,
        isPaused: () => paused,
        pause: () => {
          paused = true;
        },
        resume: () => {
          paused = false;
        },
      });
      const userTurn = runtimeMemoryGovernor.admitRuntimeTask({
        taskClass: "active_user_turn",
      });
      expect(userTurn.admitted).toBe(true);
      expect(userTurn.action).toBe("pause_existing_background");
      expect(paused).toBe(true);
      userTurn.lease?.release("completed");
      await Promise.resolve();

      expect(paused).toBe(false);
      expect(runtimeMemoryGovernor.getRuntimeTaskSnapshot().pausedTasks).toHaveLength(0);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("rejects a foreground turn when Windows commit headroom is below the hard reserve", () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 100 * mib, rss: 200 * mib }),
      hostMemoryReader: () => ({
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
          sampledAtMs: Date.now(),
          ageMs: 0,
        },
      }),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "active_user_turn" });

    expect(decision).toMatchObject({
      admitted: false,
      action: "reject_memory_pressure",
      reason: "host_commit_pressure",
      pressureLevel: "hard_pressure",
    });
  });

  it("treats stale required Windows commit telemetry as a typed hard failure", () => {
    process.env.HELIX_HOST_COMMIT_REQUIRED = "1";
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 100 * mib, rss: 200 * mib }),
      hostMemoryReader: () => ({
        freeMiB: 4096,
        totalMiB: 16384,
        freeRatio: 0.25,
        commit: {
          status: "stale",
          source: "windows_wmic",
          platform: "win32",
          committedMiB: 10000,
          limitMiB: 20000,
          freeMiB: 10000,
          ratio: 0.5,
          sampledAtMs: 1,
          ageMs: 60_000,
        },
      }),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "active_user_turn" });

    expect(decision).toMatchObject({
      admitted: false,
      reason: "host_commit_telemetry_stale",
      pressureLevel: "hard_pressure",
    });
  });

  it("rechecks an active foreground turn against newly exhausted host commit", () => {
    let commitFreeMiB = 6000;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 100 * mib, rss: 200 * mib }),
      hostMemoryReader: () => ({
        freeMiB: 4096,
        totalMiB: 16384,
        freeRatio: 0.25,
        commit: {
          status: "available",
          source: "windows_wmic",
          platform: "win32",
          committedMiB: 20000 - commitFreeMiB,
          limitMiB: 20000,
          freeMiB: commitFreeMiB,
          ratio: (20000 - commitFreeMiB) / 20000,
          sampledAtMs: Date.now(),
          ageMs: 0,
        },
      }),
    });
    const admitted = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "active_user_turn" });
    expect(admitted.admitted).toBe(true);
    commitFreeMiB = 1500;

    const recheck = runtimeMemoryGovernor.recheckRuntimeTask(admitted.lease, {
      taskClass: "active_user_turn",
    });

    expect(recheck).toMatchObject({
      admitted: false,
      reason: "host_commit_pressure",
      pressureLevel: "hard_pressure",
    });
    expect(runtimeMemoryGovernor.getRuntimeMemorySnapshot().activeTasks).toHaveLength(0);
  });

  it("clamps configured heap admission below the actual V8 ceiling", () => {
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_HEAP_USED_MB = "100000";
    process.env.RUNTIME_MEMORY_V8_HEAP_SAFETY_RESERVE_MB = "384";

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "active_user_turn" });

    expect(decision.limits.processHeapLimitMiB).toBeGreaterThan(384);
    expect(decision.limits.maxHeapUsedMiB).toBeLessThanOrEqual(
      (decision.limits.processHeapLimitMiB ?? 0) - 384,
    );
    decision.lease?.release("completed");
  });

  it("rejects a low-memory active turn when its projected provider burst crosses the physical floor", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.HELIX_LOW_MEMORY_IDLE_GC = "1";
      process.env.HELIX_HOST_COMMIT_REQUIRED = "1";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_MIN_MB = "1024";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_SOFT_MIN_MB = "2048";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_MAX = "0.96";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_SOFT_MAX = "0.90";
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 450 * mib, rss: 1_100 * mib }),
        hostMemoryReader: () => ({
            freeMiB: 808,
            totalMiB: 16_143,
            freeRatio: 0.05,
          commit: {
            status: "available",
            source: "windows_wmic",
            platform: "win32",
            committedMiB: 20_300,
            limitMiB: 25_300,
            freeMiB: 5_000,
            ratio: 0.8024,
          },
        }),
      });

      const decision = runtimeMemoryGovernor.admitRuntimeTask({
        taskClass: "active_user_turn",
      });

      expect(decision.admitted).toBe(false);
      expect(decision.pressureLevel).toBe("hard_pressure");
      expect(decision.reason).toBe("host_memory_limit");
      expect(decision.limits.estimatedBurstMiB).toBe(1536);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("admits a low-memory active turn when the projected provider burst retains both hard reserves", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.HELIX_LOW_MEMORY_IDLE_GC = "1";
      process.env.HELIX_HOST_COMMIT_REQUIRED = "1";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_MIN_MB = "1024";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_SOFT_MIN_MB = "2048";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_MAX = "0.96";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_SOFT_MAX = "0.90";
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 450 * mib, rss: 1_100 * mib }),
        hostMemoryReader: () => ({
          freeMiB: 2_800,
          totalMiB: 16_143,
          freeRatio: 2_800 / 16_143,
          commit: {
            status: "available",
            source: "windows_wmic",
            platform: "win32",
            committedMiB: 22_000,
            limitMiB: 26_000,
            freeMiB: 4_000,
            ratio: 22_000 / 26_000,
          },
        }),
      });

      const decision = runtimeMemoryGovernor.admitRuntimeTask({
        taskClass: "active_user_turn",
      });

      expect(decision.admitted).toBe(true);
      expect(decision.pressureLevel).toBe("soft_pressure");
      expect(decision.limits.estimatedBurstMiB).toBe(1536);
      decision.lease?.release("completed");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("recovers one active-turn recheck from transient physical pressure before rejecting", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.HELIX_LOW_MEMORY_IDLE_GC = "1";
      process.env.HELIX_HOST_COMMIT_REQUIRED = "1";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_MIN_MB = "1024";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_SOFT_MIN_MB = "2048";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_MAX = "0.96";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_SOFT_MAX = "0.90";
      let freeRatio = 0.15;
      let recoveryCount = 0;
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: memoryReader({ heapUsed: 650 * mib, rss: 1_100 * mib }),
        hostMemoryReader: () => ({
          freeMiB: 16_143 * freeRatio,
          totalMiB: 16_143,
          freeRatio,
          commit: {
            status: "available",
            source: "windows_wmic",
            platform: "win32",
            committedMiB: 21_300,
            limitMiB: 25_300,
            freeMiB: 4_000,
            ratio: 0.8419,
          },
        }),
        foregroundMemoryRecovery: () => {
          recoveryCount += 1;
          freeRatio = 0.05;
        },
      });
      const admitted = runtimeMemoryGovernor.admitRuntimeTask({
        taskClass: "active_user_turn",
      });
      expect(admitted.admitted).toBe(true);
      freeRatio = 0.03;

      const recheck = runtimeMemoryGovernor.recheckRuntimeTask(admitted.lease, {
        taskClass: "active_user_turn",
      });

      expect(recoveryCount).toBe(1);
      expect(recheck.admitted).toBe(true);
      expect(recheck.pressureLevel).toBe("soft_pressure");
      recheck.lease?.release("completed");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("recovers one transient active-turn heap spike before rejecting in low-memory development", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      process.env.HELIX_LOW_MEMORY_IDLE_GC = "1";
      process.env.HELIX_HOST_COMMIT_REQUIRED = "1";
      process.env.RUNTIME_TASK_ACTIVE_USER_TURN_MAX_HEAP_USED_MB = "1344";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_MIN_MB = "1024";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_FREE_SOFT_MIN_MB = "2048";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_MAX = "0.96";
      process.env.RUNTIME_MEMORY_HOST_COMMIT_RATIO_SOFT_MAX = "0.90";
      let heapUsedMiB = 1_413;
      let recoveryCount = 0;
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
        memoryReader: () => ({
          rss: 1_660 * mib,
          heapTotal: 1_523 * mib,
          heapUsed: heapUsedMiB * mib,
          external: 8 * mib,
          arrayBuffers: 1 * mib,
        }),
        hostMemoryReader: () => ({
          freeMiB: 3_200,
          totalMiB: 16_143,
          freeRatio: 0.1982,
          commit: {
            status: "available",
            source: "windows_wmic",
            platform: "win32",
            committedMiB: 21_300,
            limitMiB: 25_300,
            freeMiB: 4_000,
            ratio: 0.8419,
          },
        }),
        foregroundMemoryRecovery: () => {
          recoveryCount += 1;
          heapUsedMiB = 1_310;
        },
      });

      const decision = runtimeMemoryGovernor.admitRuntimeTask({
        taskClass: "active_user_turn",
        source: "helix_ask_turn_stream",
        requestBytes: 40_200,
      });

      expect(recoveryCount).toBe(1);
      expect(decision.admitted).toBe(true);
      expect(decision.pressureLevel).toBe("soft_pressure");
      expect(decision.memory.heapUsedMiB).toBe(1_310);
      decision.lease?.release("completed");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("labels runtime memory headline pressure with the active user turn basis", () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
      hostMemoryReader: hostReader(),
    });

    const snapshot = runtimeMemoryGovernor.getRuntimeMemorySnapshot();

    expect(snapshot.pressureLevel).toBe("normal");
    expect(snapshot.pressureReason).toBe("ok");
    expect(snapshot.pressureBasis).toEqual({
      taskClass: "active_user_turn",
      reason: "headline_pressure_uses_active_user_turn_budget",
    });
    expect(snapshot.limits.maxHeapUsedMiB).toBe(2048);
    expect(snapshot.limits.maxRssMiB).toBe(3200);
  });

  it("reports the effective configured task-class burst estimate", () => {
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_ESTIMATED_BURST_MB = "768";
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
      hostMemoryReader: hostReader(),
    });

    const snapshot = runtimeMemoryGovernor.getRuntimeTaskSnapshot();
    const activeUserTurn = snapshot.classes.find(
      (entry) => entry.taskClass === "active_user_turn",
    );

    expect(activeUserTurn?.estimatedBurstMiB).toBe(768);
  });

  it("reports per-task-class pressure when headline pressure is normal", () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 700 * mib, rss: 1200 * mib }),
      hostMemoryReader: hostReader(),
    });

    const snapshot = runtimeMemoryGovernor.getRuntimeMemorySnapshot();
    const activeUserTurn = snapshot.taskClassPressure.find((entry) => entry.taskClass === "active_user_turn");
    const voiceStt = snapshot.taskClassPressure.find((entry) => entry.taskClass === "voice_stt");
    const stagePlayRefresh = snapshot.taskClassPressure.find((entry) => entry.taskClass === "stage_play_refresh");

    expect(activeUserTurn).toMatchObject({
      taskClass: "active_user_turn",
      pressureLevel: "normal",
      pressureReason: "ok",
    });
    expect(voiceStt).toMatchObject({
      taskClass: "voice_stt",
      pressureLevel: "hard_pressure",
      pressureReason: "heap_used_limit",
    });
    expect(stagePlayRefresh).toMatchObject({
      taskClass: "stage_play_refresh",
      pressureLevel: "hard_pressure",
      pressureReason: "heap_used_limit",
    });
  });

  it("reports registered pausable tasks and recent completions in the task snapshot", () => {
    let paused = false;
    runtimeMemoryGovernor.registerPausableRuntimeTask({
      id: "stage-play-service",
      taskClass: "stage_play_refresh",
      priority: 35,
      isPaused: () => paused,
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
    });
    const admitted = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "voice_stt" });
    admitted.lease?.release("completed");

    const snapshot = runtimeMemoryGovernor.getRuntimeTaskSnapshot();

    expect(snapshot.registeredPausableTasks).toContainEqual({
      id: "stage-play-service",
      taskClass: "stage_play_refresh",
      priority: 35,
      paused: false,
    });
    expect(snapshot.recentCompletions.at(-1)).toMatchObject({
      taskClass: "voice_stt",
      outcome: "completed",
    });
  });

  it("critical_resident bypasses memory pressure", () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader({ heapUsed: 900 * mib, rss: 1200 * mib }),
      hostMemoryReader: hostReader(),
    });

    const decision = runtimeMemoryGovernor.admitRuntimeTask({ taskClass: "critical_resident" });

    expect(decision.admitted).toBe(true);
    expect(decision.reason).toBe("critical_bypass");
  });
});
