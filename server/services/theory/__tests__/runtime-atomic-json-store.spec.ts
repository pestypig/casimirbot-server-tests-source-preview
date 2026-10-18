import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTheoryRuntimeJsonFile,
  readTheoryRuntimeJsonFile,
  writeTheoryRuntimeJsonFile,
} from "../runtime-atomic-json-store";

let tempRoot: string;
let target: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "theory-runtime-atomic-store-"));
  target = path.join(tempRoot, "nested", "job.json");
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("theory runtime atomic JSON store", () => {
  it("serializes repeated and concurrent replacements on Windows-compatible paths", async () => {
    await writeTheoryRuntimeJsonFile(target, { version: 1 });
    await writeTheoryRuntimeJsonFile(target, { version: 2 });
    await Promise.all([
      writeTheoryRuntimeJsonFile(target, { version: 3 }),
      writeTheoryRuntimeJsonFile(target, { version: 4 }),
    ]);

    expect(JSON.parse(await readTheoryRuntimeJsonFile(target))).toEqual({ version: 4 });
  });

  it("recovers a readable target from an interrupted backup swap", async () => {
    await writeTheoryRuntimeJsonFile(target, { durable: true });
    await fs.rename(target, `${target}.bak`);

    expect(JSON.parse(await readTheoryRuntimeJsonFile(target))).toEqual({ durable: true });
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({ durable: true });
  });

  it("creates deterministic identities exactly once without replacing prior bytes", async () => {
    await createTheoryRuntimeJsonFile(target, { attempt: 1, status: "failed" });
    const original = await fs.readFile(target);

    await expect(
      createTheoryRuntimeJsonFile(target, { attempt: 2, status: "created" }),
    ).rejects.toMatchObject({ code: "EEXIST" });

    expect(await fs.readFile(target)).toEqual(original);
  });

  it("allows exactly one concurrent creator for the same identity", async () => {
    const attempts = await Promise.allSettled([
      createTheoryRuntimeJsonFile(target, { attempt: "left" }),
      createTheoryRuntimeJsonFile(target, { attempt: "right" }),
    ]);

    expect(attempts.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect(["left", "right"]).toContain(
      JSON.parse(await fs.readFile(target, "utf8")).attempt,
    );
  });
});
