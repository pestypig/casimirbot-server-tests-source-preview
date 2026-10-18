import { describe, expect, it } from "vitest";
import type { EssenceProposal } from "@shared/proposals";
import { canReadProposalForAccount, shouldListAllProposalOwnersForAccount } from "../access-policy";

const proposal = (input: Pick<EssenceProposal, "kind" | "status"> & { ownerId?: string | null }) =>
  input as Pick<EssenceProposal, "kind" | "ownerId" | "status">;

describe("proposal access policy", () => {
  it("keeps non-public postulates private to owners and developers", () => {
    const rejectedAnonymous = proposal({ kind: "postulate", status: "rejected", ownerId: null });
    const rejectedOwned = proposal({ kind: "postulate", status: "rejected", ownerId: "profile:owner" });

    expect(canReadProposalForAccount(rejectedAnonymous, null, "user")).toBe(false);
    expect(canReadProposalForAccount(rejectedOwned, "profile:other", "user")).toBe(false);
    expect(canReadProposalForAccount(rejectedOwned, "profile:owner", "user")).toBe(true);
    expect(canReadProposalForAccount(rejectedAnonymous, null, "developer")).toBe(true);
  });

  it("keeps accepted postulates public and preserves shared non-postulate proposal reads", () => {
    const acceptedPostulate = proposal({ kind: "postulate", status: "queued_for_graph_review", ownerId: null });
    const sharedPanel = proposal({ kind: "panel", status: "new", ownerId: null });

    expect(canReadProposalForAccount(acceptedPostulate, null, "user")).toBe(true);
    expect(canReadProposalForAccount(sharedPanel, null, "user")).toBe(true);
  });

  it("widens list queries only for developer review and postulate publication filtering", () => {
    expect(shouldListAllProposalOwnersForAccount("developer", "panel")).toBe(true);
    expect(shouldListAllProposalOwnersForAccount("user", "postulate")).toBe(true);
    expect(shouldListAllProposalOwnersForAccount("user", "panel")).toBe(false);
    expect(shouldListAllProposalOwnersForAccount("user", undefined)).toBe(false);
  });
});
