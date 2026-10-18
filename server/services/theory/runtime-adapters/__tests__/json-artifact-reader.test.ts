import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJsonArtifactFile, readJsonlArtifactFile } from "../json-artifact-reader";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-artifact-reader-"));
});

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe("json artifact reader", () => {
  it("parses UTF-8 JSON artifacts with BOM", async () => {
    const filePath = path.join(tempDir, "bom.json");
    await fs.writeFile(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"ok":true}', "utf8")]));

    await expect(readJsonArtifactFile(filePath)).resolves.toEqual({ ok: true });
  });

  it("parses UTF-16LE JSON artifacts with BOM", async () => {
    const filePath = path.join(tempDir, "utf16.json");
    await fs.writeFile(filePath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"kind":"receipt"}', "utf16le")]));

    await expect(readJsonArtifactFile(filePath)).resolves.toEqual({ kind: "receipt" });
  });

  it("parses JSONL artifacts after decoding", async () => {
    const filePath = path.join(tempDir, "trace.jsonl");
    await fs.writeFile(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}\n{"b":2}\n', "utf8")]));

    await expect(readJsonlArtifactFile(filePath)).resolves.toEqual([{ a: 1 }, { b: 2 }]);
  });
});
