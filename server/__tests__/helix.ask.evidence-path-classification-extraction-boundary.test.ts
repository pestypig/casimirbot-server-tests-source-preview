import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeHelixAskStage0CodeFloorPathCounts,
  computeHelixAskTreeCitationStats,
  isHelixAskCodeEvidencePath,
  isHelixAskDocEvidencePath,
  isHelixAskTreeJsonCitationPath,
  normalizeHelixAskEvidencePathKey,
} from "../services/helix-ask/surface/evidence-path-classification";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(
  repoRoot,
  "server/services/helix-ask/surface/evidence-path-classification.ts",
);

describe("Helix Ask evidence path classification extraction boundary", () => {
  it("keeps evidence path classifiers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain(
      "../services/helix-ask/surface/evidence-path-classification",
    );
    expect(routeSource).not.toMatch(/^const\s+TREE_JSON_CITATION_RE\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+DOC_EVIDENCE_PATH_RE\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+CODE_EVIDENCE_PATH_RE\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+NON_SIGNAL_EVIDENCE_PATH_RE\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+STAGE0_CODE_FLOOR_CODE_PATH_RE\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+isTreeJsonCitationPath\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+isDocEvidencePath\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+isCodeEvidencePath\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+computeStage0CodeFloorPathCounts\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+computeTreeCitationStats\s*=/m);

    expect(serviceSource).toMatch(/export\s+const\s+normalizeHelixAskEvidencePathKey\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isHelixAskTreeJsonCitationPath\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isHelixAskDocEvidencePath\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isHelixAskCodeEvidencePath\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+computeHelixAskStage0CodeFloorPathCounts\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+computeHelixAskTreeCitationStats\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves evidence path classification behavior", () => {
    expect(normalizeHelixAskEvidencePathKey("DOCS\\Knowledge\\Tile-Tree.json")).toBe(
      "docs/knowledge/tile-tree.json",
    );
    expect(isHelixAskTreeJsonCitationPath("docs/knowledge/tile-tree.json")).toBe(true);
    expect(isHelixAskTreeJsonCitationPath("docs/research/nhm2.md")).toBe(false);
    expect(isHelixAskDocEvidencePath("docs/research/nhm2.md")).toBe(true);
    expect(isHelixAskDocEvidencePath("server/routes/agi.plan.ts")).toBe(false);
    expect(isHelixAskCodeEvidencePath("server/routes/agi.plan.ts")).toBe(true);
    expect(isHelixAskCodeEvidencePath("docs/research/nhm2.md")).toBe(false);
    expect(isHelixAskCodeEvidencePath("client/src/logo.svg")).toBe(false);
    expect(isHelixAskCodeEvidencePath("tests/helix-ask.spec")).toBe(true);
  });

  it("preserves code-floor and tree citation counts", () => {
    expect(
      computeHelixAskStage0CodeFloorPathCounts([
        "docs/research/nhm2.md",
        "server/routes/agi.plan.ts",
        "server/routes/agi.plan.ts",
        "client/src/components/helix/HelixAskPill.tsx",
      ]),
    ).toEqual({
      codePathCount: 2,
      docPathCount: 1,
    });

    expect(
      computeHelixAskTreeCitationStats([
        "docs/knowledge/tile-tree.json",
        "docs/research/nhm2.md",
        "docs/knowledge/tile-tree.json",
      ]),
    ).toEqual({
      total: 2,
      tree: 1,
      nonTree: 1,
      share: 0.5,
    });
  });
});
