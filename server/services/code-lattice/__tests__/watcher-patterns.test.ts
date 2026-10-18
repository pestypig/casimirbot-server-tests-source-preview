import { describe, expect, it } from "vitest";
import {
  getLatticeWatchRoots,
  isIgnoredLatticePath,
  matchesLatticeWatchPatterns,
} from "../watcher-patterns";

describe("code lattice watcher glob compatibility", () => {
  it("watches concrete roots before the first glob segment", () => {
    expect(getLatticeWatchRoots("C:/repo", [
      "client/src/**/*.{ts,tsx}",
      "server/**/*.{ts,tsx}",
      "shared/**/*.{ts,tsx}",
    ])).toEqual([
      "C:\\repo\\client\\src",
      "C:\\repo\\server",
      "C:\\repo\\shared",
    ]);
  });

  it("preserves the TypeScript include patterns and excludes generated or declaration files", () => {
    const patterns = ["client/src/**/*.{ts,tsx}", "server/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}"];
    expect(matchesLatticeWatchPatterns("server/security/hull-guard.ts", patterns)).toBe(true);
    expect(matchesLatticeWatchPatterns("client/src/app/page.tsx", patterns)).toBe(true);
    expect(matchesLatticeWatchPatterns("client/src/app/page.css", patterns)).toBe(false);
    expect(isIgnoredLatticePath("server/_generated/code-lattice.json")).toBe(true);
    expect(isIgnoredLatticePath("client/src/app/page.d.ts")).toBe(true);
    expect(isIgnoredLatticePath("server/security/hull-guard.ts")).toBe(false);
  });
});
