import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  HELIX_ASK_G0_AUTHORITY_INVENTORY,
  HELIX_ASK_G0_AUTHORITY_INVENTORY_SUMMARY,
} from "../services/helix-ask/runtime/codex-parity-g0-authority-inventory";
import {
  HELIX_ASK_LEGACY_CONSOLE_SLICE_PROGRESS,
  HELIX_ASK_LEGACY_CONSOLE_SLICES,
} from "../../client/src/components/helix/ask-console/HelixAskLegacyConsoleInventory";

const repoRoot = process.cwd();

describe("Helix Ask Codex parity G0 authority inventory", () => {
  it("keeps every inventory entry classified with an owner, predicate, disposition, and downstream gate", () => {
    expect(HELIX_ASK_G0_AUTHORITY_INVENTORY.length).toBeGreaterThanOrEqual(20);
    expect(new Set(HELIX_ASK_G0_AUTHORITY_INVENTORY.map((entry) => entry.id)).size).toBe(
      HELIX_ASK_G0_AUTHORITY_INVENTORY.length,
    );
    for (const entry of HELIX_ASK_G0_AUTHORITY_INVENTORY) {
      expect(entry.activationPredicate.trim()).not.toBe("");
      expect(entry.authorityOwner.trim()).not.toBe("");
      expect(entry.authoritativeSource.trim()).not.toBe("");
      expect(entry.disposition).toMatch(/^(retain|replace|quarantine|remove_after_parity)$/);
      expect(entry.downstreamGate).toMatch(/^G[12456]$/);
      expect(entry.currentClosureState).toBe("inventoried");
    }
    expect(HELIX_ASK_G0_AUTHORITY_INVENTORY_SUMMARY.unknownTrapdoorCount).toBe(0);
  });

  it("pins every entry to stable source symbols instead of line-number snapshots", () => {
    for (const entry of HELIX_ASK_G0_AUTHORITY_INVENTORY) {
      const absolutePath = path.resolve(repoRoot, entry.sourceFile);
      expect(fs.existsSync(absolutePath), `${entry.id}: missing ${entry.sourceFile}`).toBe(true);
      const source = fs.readFileSync(absolutePath, "utf8");
      for (const anchor of entry.sourceAnchors) {
        expect(source, `${entry.id}: missing source anchor ${anchor}`).toContain(anchor);
      }
    }
  });

  it("has no unknown legacy-console trapdoor slice", () => {
    expect(HELIX_ASK_LEGACY_CONSOLE_SLICE_PROGRESS.unknownTrapDoorSliceCount).toBe(0);
    expect(
      HELIX_ASK_LEGACY_CONSOLE_SLICES.filter(
        (slice) => slice.classification === "unknown_trap_door_quarantined",
      ),
    ).toEqual([]);
  });

  it("keeps runtime budgets distinct from presentation truncation", () => {
    const native = HELIX_ASK_G0_AUTHORITY_INVENTORY.find(
      (entry) => entry.id === "provider.codex_native_app_server",
    );
    const compatibility = HELIX_ASK_G0_AUTHORITY_INVENTORY.find(
      (entry) => entry.id === "provider.codex_exec_compatibility",
    );
    const presentation = HELIX_ASK_G0_AUTHORITY_INVENTORY.find(
      (entry) => entry.id === "presentation.procedural_timeline",
    );
    expect(native?.limits.join(" ")).toContain("No Helix continuation-step cap");
    expect(compatibility?.limits.join(" ")).toContain("12 steps");
    expect(presentation?.limits.join(" ")).toContain("display truncations");
  });
});

