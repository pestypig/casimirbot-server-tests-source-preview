import { afterEach, expect, it, vi } from "vitest";
import * as database from "../../../helix-ask/realtime-room/room-store/database";
import * as probes from "../../probe/durable-broker";
import { environmentDurableGoalStore } from "../../goals/durable-goal-store";
import { readExactEnvironmentPerceptionEvidence } from "../../temporal-plans/temporal-perception-context";
import { TEMPORAL_OBSERVATION_MAX_AGE_MS } from "../../temporal-plans/temporal-observation-window";

afterEach(() => vi.restoreAllMocks());

it.each(["fresh", "missing_source", "missing_evidence", "wrong_schema"])(
  "reads recovery perception without treating recovery as active (%s)", async scenario => {
    const activeGoal = vi.spyOn(environmentDurableGoalStore, "resolveTemporalAdmissionContext")
      .mockRejectedValue(new Error("goal remains in recovery"));
    const query = vi.fn().mockResolvedValue({ rows: scenario === "missing_source" ? [] : [{ producer_epoch_ref: "epoch:observation" }] });
    vi.spyOn(database, "readSharedRealtimeRoomDatabase").mockResolvedValue({ query } as never);
    const probe = vi.spyOn(probes, "readDurableEnvironmentProbeContinuationEvidence").mockResolvedValue(
      scenario === "missing_evidence" ? null : { observation: { evidence_ref: "evidence:a", result: {
        snapshot_schema: scenario === "wrong_schema" ? "other" : "helix.minecraft_perception_snapshot.v1",
      } } } as never);
    const identity = { environment_binding_id: "environment:a", room_id: "room:a", source_id: "source:a",
      world_id: "world:a", room_source_binding_id: "source_binding:a", subject_binding_id: "subject:a",
      subject_native_id: "player:a" } as Parameters<typeof readExactEnvironmentPerceptionEvidence>[0]["identity"];
    const result = readExactEnvironmentPerceptionEvidence({ identity, probeRequestId: "probe:a", priorTurnId: "turn:a" });
    if (scenario === "fresh") {
      await expect(result).resolves.toMatchObject({ observation_producer_epoch_ref: "epoch:observation",
        execution_authority: false, answer_authority: false, terminal_eligible: false });
    } else await expect(result).rejects.toThrow();
    expect(activeGoal).not.toHaveBeenCalled();
    if (scenario === "missing_source") expect(probe).not.toHaveBeenCalled();
    else expect(probe).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "probe:a", expectedPriorTurnId: "turn:a", expectedRoomId: "room:a",
      maxAgeMs: TEMPORAL_OBSERVATION_MAX_AGE_MS,
      expectedEnvironmentIdentity: { environmentBindingId: "environment:a", sourceId: "source:a",
        worldId: "world:a", subjectBindingId: "subject:a", subjectNativeId: "player:a",
        observationProducerEpochRef: "epoch:observation" },
    }));
  },
);
