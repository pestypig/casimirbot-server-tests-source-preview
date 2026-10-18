import { describe, expect, it } from "vitest";

import { signInLocalAccountSession } from "../services/helix-account/account-session-store";
import { attachResearchLibraryOwnerContext } from "../services/helix-ask/research-library-owner-context";

describe("Research Library owner context", () => {
  it("removes a caller-supplied owner when no authenticated session exists", async () => {
    const body: Record<string, unknown> = {
      research_library_owner_id: "profile:spoofed",
    };

    await attachResearchLibraryOwnerContext({ headers: {} }, body);

    expect(body).not.toHaveProperty("research_library_owner_id");
  });

  it("replaces a caller-supplied owner with the authenticated profile", async () => {
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:trusted-owner",
      display_name: "Trusted Research Owner",
    });
    expect(receipt.ok).toBe(true);
    expect(receipt.session?.session_id).toEqual(expect.any(String));
    const body: Record<string, unknown> = {
      research_library_owner_id: "profile:spoofed",
    };

    await attachResearchLibraryOwnerContext({
      headers: {
        cookie: `helix_session=${encodeURIComponent(receipt.session?.session_id ?? "")}`,
      },
    }, body);

    expect(body.research_library_owner_id).toBe("profile:trusted-owner");
  });
});
