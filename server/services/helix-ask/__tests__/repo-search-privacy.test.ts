import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isRepoSearchPrivatePath, runRepoSearch } from "../repo-search";

const privateFixturePath = path.resolve(process.cwd(), ".cal", "repo-search-private-fixture.txt");

afterEach(() => {
  try {
    fs.rmSync(privateFixturePath, { force: true });
  } catch {
    // Best-effort cleanup only.
  }
});

describe("repo search privacy boundaries", () => {
  it("classifies local account and credential paths as private", () => {
    expect(isRepoSearchPrivatePath(".cal/local-pg-mem.json")).toBe(true);
    expect(isRepoSearchPrivatePath(".env.local")).toBe(true);
    expect(isRepoSearchPrivatePath("server/service-account.json")).toBe(true);
    expect(isRepoSearchPrivatePath("server/services/helix-ask/repo-search.ts")).toBe(false);
  });

  it("does not return evidence from .cal even when requested directly", async () => {
    fs.mkdirSync(path.dirname(privateFixturePath), { recursive: true });
    fs.writeFileSync(privateFixturePath, "helix-private-fixture-account-email@example.com\n", "utf8");

    const result = await runRepoSearch({
      rawQuestion: "helix-private-fixture-account-email",
      terms: ["helix-private-fixture-account-email"],
      paths: [".cal"],
      explicit: true,
      reason: "privacy_test",
      mode: "explicit",
      intentDomain: "repo",
      topicTags: [],
    });

    expect(result.hits).toEqual([]);
    expect(result.error).toBe("repo_search_private_paths_excluded");
  });
});
