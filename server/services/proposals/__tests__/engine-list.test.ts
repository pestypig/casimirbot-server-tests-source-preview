import type { EssenceProposal } from "@shared/proposals";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listProposalsForDay: vi.fn(async () => [] as EssenceProposal[]),
  getProposalById: vi.fn(),
  getProposalByJobId: vi.fn(),
  recordProposalAction: vi.fn(),
  updateProposalFields: vi.fn(),
  upsertProposal: vi.fn(),
}));

vi.mock("../../../db/proposals", () => ({
  getProposalById: dbMocks.getProposalById,
  getProposalByJobId: dbMocks.getProposalByJobId,
  listProposalsForDay: dbMocks.listProposalsForDay,
  recordProposalAction: dbMocks.recordProposalAction,
  updateProposalFields: dbMocks.updateProposalFields,
  upsertProposal: dbMocks.upsertProposal,
}));

vi.mock("../panel-scanner", () => ({
  scanForUnregisteredPanels: vi.fn(() => []),
}));

vi.mock("../../jobs/token-budget", () => ({
  awardTokens: vi.fn(),
}));

vi.mock("../../jobs/engine", () => ({
  addUserJob: vi.fn(),
}));

vi.mock("../../essence/events", () => ({
  essenceHub: { emit: vi.fn() },
}));

vi.mock("../../essence/preferences", () => ({
  upsertUiPreference: vi.fn(),
}));

import { listProposals } from "../engine";

describe("proposal list owner scope", () => {
  beforeEach(() => {
    dbMocks.listProposalsForDay.mockClear();
  });

  it("scopes ordinary account proposal lists to the owner plus shared records", async () => {
    await listProposals("profile:user-1", "2026-07-07", { kind: "postulate" });

    const finalCall = dbMocks.listProposalsForDay.mock.calls.at(-1);
    expect(finalCall).toEqual([
      "2026-07-07",
      expect.objectContaining({
        kind: "postulate",
        ownerId: "profile:user-1",
      }),
    ]);
  });

  it("allows developer review lists to include all owners", async () => {
    await listProposals("profile:developer-1", "2026-07-07", {
      kind: "postulate",
      includeAllOwners: true,
    });

    const finalCall = dbMocks.listProposalsForDay.mock.calls.at(-1);
    expect(finalCall).toEqual([
      "2026-07-07",
      expect.objectContaining({
        kind: "postulate",
      }),
    ]);
    expect(finalCall?.[1]).not.toHaveProperty("ownerId");
    expect(finalCall?.[1]).not.toHaveProperty("includeAllOwners");
  });
});
