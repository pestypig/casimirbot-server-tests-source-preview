import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const runMock = vi.hoisted(() => vi.fn());
const recordMock = vi.hoisted(() => vi.fn());
const traceRecordMock = vi.hoisted(() => vi.fn());

vi.mock("../gr/gr-agent-loop.js", () => ({
  runGrAgentLoop: (...args: unknown[]) => runMock(...args),
}));

vi.mock("../services/observability/gr-agent-loop-store.js", () => ({
  recordGrAgentLoopRun: (...args: unknown[]) => recordMock(...args),
}));

vi.mock("../services/observability/training-trace-store.js", async () => {
  const actual = await vi.importActual<typeof import("../services/observability/training-trace-store")>(
    "../services/observability/training-trace-store",
  );
  return {
    ...actual,
    recordTrainingTrace: (...args: unknown[]) => traceRecordMock(...args),
  };
});

type AdapterRouterModule = typeof import("../routes/agi.adapter");

let app: express.Express;

const mockResult = {
  accepted: false,
  acceptedIteration: undefined,
  attempts: [
    {
      iteration: 0,
      proposal: { label: "baseline", params: { dutyCycle: 0.004 } },
      evaluation: {
        constraints: [
          {
            id: "H_constraint",
            severity: "HARD",
            status: "fail",
            value: 0.12,
            limit: "H_rms <= 0.01",
          },
        ],
        certificate: {
          certificateHash: "cert-hash",
          certificateId: "cert-id",
          integrityOk: true,
        },
      },
    },
  ],
} as any;

const loadModules = async (): Promise<AdapterRouterModule> => {
  process.env.TRAINING_TRACE_PERSIST = "0";
  process.env.CONSTRAINT_PACK_POLICY_PERSIST = "0";
  process.env.CASIMIR_AUTO_TELEMETRY = "0";
  await vi.resetModules();
  return import("../routes/agi.adapter");
};

beforeAll(async () => {
  const routes = await loadModules();
  app = express();
  app.use(express.json());
  app.use("/api/agi/adapter", routes.adapterRouter);
});

beforeEach(() => {
  runMock.mockReset();
  recordMock.mockReset();
  runMock.mockResolvedValue(mockResult);
  recordMock.mockReturnValue({ id: "run-1" });
  traceRecordMock.mockReset();
  traceRecordMock.mockImplementation((input: any) => ({
    kind: "training-trace",
    version: 1,
    id: "trace-rec-1",
    seq: 1,
    ts: new Date().toISOString(),
    pass: input?.pass ?? false,
    deltas: input?.deltas ?? [],
    ...input,
  }));
});

describe("agi adapter API", () => {
  it("runs adapter and returns verdict payload", async () => {
    const response = await request(app)
      .post("/api/agi/adapter/run")
      .send({
        traceId: "trace-1",
        actions: [{ id: "a1", params: { dutyCycle: 0.004 } }],
        budget: { maxIterations: 1 },
      })
      .expect(200);

    expect(response.body?.traceId).toBe("trace-1");
    expect(response.body?.runId).toBe("run-1");
    expect(response.body?.verdict).toBe("FAIL");
    expect(response.body?.pass).toBe(false);
    expect(response.body?.firstFail?.id).toBe("H_constraint");
    expect(response.body?.failReason).toBe("H_constraint");
    expect(Array.isArray(response.body?.deltas)).toBe(true);
    expect(response.body?.artifacts).toEqual(
      expect.arrayContaining([
        { kind: "gr-agent-loop-run", ref: "run-1" },
        { kind: "gr-agent-loop-run-url", ref: "/api/helix/gr-agent-loop/run-1" },
        { kind: "training-trace-export", ref: "/api/agi/training-trace/export" },
        { kind: "warp-certificate-hash", ref: "cert-hash" },
      ]),
    );
    expect(response.body?.certificate?.certificateHash).toBe("cert-hash");
    expect(response.body?.certificate?.integrityOk).toBe(true);
  });




  it("fails closed in strict verify mode when certificate evidence is missing", async () => {
    runMock.mockResolvedValue({
      accepted: true,
      acceptedIteration: 0,
      attempts: [
        {
          iteration: 0,
          proposal: { label: "baseline", params: { dutyCycle: 0.004 } },
          evaluation: {
            constraints: [],
            certificate: null,
          },
        },
      ],
    } as any);

    const response = await request(app)
      .post("/api/agi/adapter/run")
      .send({
        traceId: "trace-strict-fail-closed-1",
        actions: [{ id: "a1", params: { dutyCycle: 0.004 } }],
        policy: { verify: { mode: "strict" } },
      })
      .expect(200);

    expect(response.body?.verdict).toBe("FAIL");
    expect(response.body?.pass).toBe(false);
    expect(response.body?.firstFail?.id).toBe("ADAPTER_CERTIFICATE_MISSING");
    expect(response.body?.failReason).toBe("ADAPTER_CERTIFICATE_MISSING");
  });

  it("returns premeditation scoring for deterministic candidate selection", async () => {
    const response = await request(app)
      .post("/api/agi/adapter/run")
      .send({
        traceId: "trace-premeditation-1",
        actions: [{ id: "a1", params: { dutyCycle: 0.004 } }],
        budget: { maxIterations: 1 },
        premeditation: {
          lambda: 0.5,
          mu: 0.25,
          ideologyWeight: 0.1,
          coherenceWeight: 0.2,
          candidates: [
            {
              id: "a",
              valueLongevity: 0.9,
              risk: 0.4,
              entropy: 0.1,
              ideologyAlignment: 0.8,
              coherenceAlignment: 0.7,
            },
            {
              id: "b",
              valueLongevity: 0.8,
              risk: 0.1,
              entropy: 0.2,
              ideologyAlignment: 0.6,
              coherenceAlignment: 0.9,
            },
          ],
        },
      })
      .expect(200);

    expect(response.body?.premeditation?.chosenCandidateId).toBe("b");
    expect(response.body?.premeditation?.optimism).toBeCloseTo(0.94, 8);
    expect(response.body?.premeditation?.entropy).toBeCloseTo(0.2, 8);
  });

  it("fails covered actions missing legal/ethos keys before execution", async () => {
    const response = await request(app)
      .post("/api/agi/adapter/run")
      .send({
        traceId: "trace-premeditation-ideology-veto-1",
        actions: [{ id: "a1", params: { dutyCycle: 0.004 } }],
        premeditation: {
          candidates: [
            {
              id: "covered-missing-legal",
              valueLongevity: 0.9,
              risk: 0.1,
              entropy: 0.1,
              tags: ["covered-action", "ethos-key", "jurisdiction-floor-ok"],
            },
          ],
        },
      })
      .expect(200);

    expect(response.body?.verdict).toBe("FAIL");
    expect(response.body?.pass).toBe(false);
    expect(response.body?.firstFail?.id).toBe("IDEOLOGY_MISSING_LEGAL_KEY");
    expect(response.body?.premeditation?.chosenCandidateId).toBeUndefined();
    expect(runMock).not.toHaveBeenCalled();
  });



  it("rejects direct motor actuation commands from adapter actions", async () => {
    const response = await request(app)
      .post("/api/agi/adapter/run")
      .send({
        traceId: "trace-boundary-1",
        actions: [{ kind: "motor-command", params: { torqueNm: 12 } }],
      })
      .expect(400);

    expect(response.body?.error).toBe("controller-boundary-violation");
  });

  it("vetoes execution on failing HARD robotics safety envelope", async () => {
    const response = await request(app)
      .post("/api/agi/adapter/run")
      .send({
        traceId: "trace-robotics-veto-1",
        actions: [{ id: "intent-move", kind: "intent", params: { heading: 10 } }],
        roboticsSafety: {
          collisionMargin_m: 0.01,
          collisionMarginMin_m: 0.05,
          torqueUsageRatio: 0.7,
          torqueUsageMax: 0.8,
          speedUsageRatio: 0.6,
          speedUsageMax: 0.9,
          stabilityMargin: 0.4,
          stabilityMarginMin: 0.3,
        },
      })
      .expect(200);

    expect(response.body?.verdict).toBe("FAIL");
    expect(response.body?.pass).toBe(false);
    expect(response.body?.firstFail?.id).toBe("ROBOTICS_SAFETY_COLLISION_MARGIN");
    expect(response.body?.failReason).toBe("ROBOTICS_SAFETY_COLLISION_MARGIN");
    expect(response.body?.certificate?.integrityOk).toBe(true);
    expect(runMock).not.toHaveBeenCalled();
    expect(traceRecordMock).toHaveBeenCalledTimes(1);
    const traceInput = traceRecordMock.mock.calls[0]?.[0];
    expect(traceInput?.payload?.kind).toBe("movement_episode");
    expect(traceInput?.payload?.data?.provenanceClass).toBe("robotics.demonstration");
    expect(traceInput?.payload?.data?.sensorChannelCoverage).toEqual([
      "collision",
      "torque",
      "speed",
      "stability",
    ]);
    expect(traceInput?.payload?.data?.certificateRefs).toEqual(
      expect.arrayContaining([response.body?.certificate?.certificateHash, response.body?.certificate?.certificateId]),
    );
  });


  it("records deterministic action -> gate -> certificate -> replay summary linkage", async () => {
    runMock.mockResolvedValue({
      ...mockResult,
      accepted: true,
      attempts: [
        {
          ...mockResult.attempts[0],
          evaluation: {
            constraints: [],
            certificate: {
              certificateHash: "cert-link-hash",
              certificateId: "cert-link-id",
              integrityOk: true,
            },
          },
        },
      ],
    });

    await request(app)
      .post("/api/agi/adapter/run")
      .send({
        traceId: "trace-linkage-1",
        actions: [{ id: "move-1", kind: "intent", params: { heading: 10 } }],
        premeditation: {
          candidates: [
            {
              id: "cand-link",
              valueLongevity: 0.9,
              risk: 0.1,
              entropy: 0.2,
            },
          ],
        },
      })
      .expect(200);

    expect(traceRecordMock).toHaveBeenCalledTimes(2);
    const movement = traceRecordMock.mock.calls[0]?.[0];
    const replay = traceRecordMock.mock.calls[1]?.[0];
    expect(movement?.payload?.kind).toBe("movement_episode");
    expect(movement?.payload?.data?.primitivePath).toEqual(["cand-link"]);
    expect(movement?.certificate?.certificateHash).toBe("cert-link-hash");
    expect(replay?.payload?.kind).toBe("trajectory_replay_summary");
    expect(replay?.payload?.data?.failReason).toBe("NONE");
    expect(replay?.notes).toContain("fail_reason=NONE");
    expect(replay?.payload?.provenance?.certificateRefs).toContain("cert-link-hash");
    expect(replay?.payload?.provenance?.certificateRefs).toContain("cert-link-id");
    expect(replay?.payload?.provenance?.sensorChannelCoverage).toEqual([
      "controller.intent",
      "trajectory.replay",
    ]);
  });

  it("evaluates constraint pack runs via adapter", async () => {
    const response = await request(app)
      .post("/api/agi/adapter/run")
      .send({
        traceId: "pack-trace-1",
        mode: "constraint-pack",
        pack: {
          id: "repo-convergence",
          telemetry: {
            build: { status: "pass", durationMs: 420000 },
            tests: { failed: 0, total: 12 },
            schema: { contracts: true },
            deps: { coherence: true },
          },
        },
      })
      .expect(200);

    expect(response.body?.traceId).toBe("pack-trace-1");
    expect(response.body?.verdict).toBe("PASS");
    expect(response.body?.pass).toBe(true);
    expect(runMock).not.toHaveBeenCalled();
    expect(response.body?.artifacts).toEqual(
      expect.arrayContaining([
        { kind: "constraint-pack", ref: "repo-convergence" },
        { kind: "training-trace-export", ref: "/api/agi/training-trace/export" },
      ]),
    );
    expect(response.body?.certificate?.certificateHash).toBeTruthy();
    expect(response.body?.certificate?.integrityOk).toBe(true);
  });

});
