import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import { migration041 } from "../../../db/migrations/041_casimir_theory_execution_state";
import {
  createInMemoryCasimirTheoryExecutionStateStoreV1,
  createPostgresCasimirTheoryExecutionStateStoreV1,
} from "../casimir-theory-execution-state-store";

describe("Casimir theory execution state store", () => {
  it("defensively clones volatile records", async () => {
    const store = createInMemoryCasimirTheoryExecutionStateStoreV1();
    const record = { nested: { status: "prepared" } };
    await store.put("prepared", "prepared:1", record);
    record.nested.status = "mutated";

    const first = await store.get<typeof record>(
      "prepared",
      "prepared:1",
    );
    expect(first).toEqual({ nested: { status: "prepared" } });
    if (first) first.nested.status = "mutated-again";
    await expect(
      store.get("prepared", "prepared:1"),
    ).resolves.toEqual({ nested: { status: "prepared" } });
  });

  it("round-trips lifecycle state across store instances and isolates execution lanes", async () => {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = database.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await migration041.run(client, { enablePgvector: false });
    } finally {
      client.release();
    }

    const formalWriter =
      createPostgresCasimirTheoryExecutionStateStoreV1(
        "formal_v2",
        pool as never,
      );
    const formalAfterRestart =
      createPostgresCasimirTheoryExecutionStateStoreV1(
        "formal_v2",
        pool as never,
      );
    const numerical =
      createPostgresCasimirTheoryExecutionStateStoreV1(
        "independent_numerical_v1",
        pool as never,
      );

    await formalWriter.put("prepared", "prepared:formal", {
      ownerKey: "developer:profile",
      sealedInputSha256: "a".repeat(64),
    });
    await formalWriter.put("plan", "plan:formal", {
      ownerKey: "developer:profile",
      preparedRequestId: "prepared:formal",
    });
    await formalWriter.put("job", "job:formal", {
      status: "running",
      issues: [],
    });
    await numerical.put("job", "job:numerical", {
      status: "completed",
      issues: [],
    });

    await expect(
      formalAfterRestart.get("prepared", "prepared:formal"),
    ).resolves.toMatchObject({
      ownerKey: "developer:profile",
      sealedInputSha256: "a".repeat(64),
    });
    await expect(formalAfterRestart.list("plan")).resolves.toEqual([
      expect.objectContaining({
        preparedRequestId: "prepared:formal",
      }),
    ]);
    await expect(
      formalAfterRestart.get("job", "job:numerical"),
    ).resolves.toBeNull();

    await formalAfterRestart.put("job", "job:formal", {
      status: "failed",
      issues: ["formal_job_interrupted_by_server_restart"],
    });
    await expect(
      formalWriter.get("job", "job:formal"),
    ).resolves.toEqual({
      status: "failed",
      issues: ["formal_job_interrupted_by_server_restart"],
    });

    await formalAfterRestart.clear();
    await expect(formalWriter.list("prepared")).resolves.toEqual([]);
    await expect(numerical.list("job")).resolves.toEqual([
      { status: "completed", issues: [] },
    ]);
    await pool.end();
  });
});
