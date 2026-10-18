import { describe, expect, it } from "vitest";
import { HelixLocalSupervisorCoordinationStore } from
  "../local-supervisor-coordination";
import {
  createHelixLocalSupervisorRestartCompletionCapability,
  HelixLocalSupervisorRestartCoordinator,
} from "../local-supervisor-restart-coordination";

const SERVICE = "service_instance:0123456789abcdef0123456789abcdef";
const NEW_SERVICE = "service_instance:fedcba9876543210fedcba9876543210";
const OWNER = "profile:owner";

type Client = {
  profile: string;
  session: string;
  client: string;
  thread: string;
};

const owner: Client = {
  profile: OWNER,
  session: "session:owner",
  client: "client:owner",
  thread: "thread:owner",
};
const guest: Client = {
  profile: "profile:guest",
  session: "session:guest",
  client: "client:guest",
  thread: "thread:guest",
};

const heartbeat = (
  store: HelixLocalSupervisorCoordinationStore,
  client: Client,
  claims: Array<{
    resource_ref: string;
    claim_class: "read" | "retained_runtime" | "mutation_lease_wait" | "mutation_lease_active";
  }> = [],
) => store.registerOrHeartbeat({
  profileRef: client.profile,
  accountSessionId: client.session,
  presence: {
    client_session_ref: client.client,
    conversation_thread_ref: client.thread,
    declared_objective_summary: `Work for ${client.thread}`,
    lifecycle_state: "active",
    resource_claims: claims,
    heartbeat_ttl_seconds: 60,
  },
});

const fixture = (now: () => Date = () => new Date("2026-08-27T18:00:00.000Z")) => {
  const coordination = new HelixLocalSupervisorCoordinationStore(
    SERVICE,
    now,
    ({ resourceRef, claimClass }) =>
      claimClass === "retained_runtime" || claimClass === "mutation_lease_active"
        ? { verificationRef: `verified_claim:${resourceRef}` }
        : null,
  );
  heartbeat(coordination, owner);
  heartbeat(coordination, guest);
  const completionCapability = createHelixLocalSupervisorRestartCompletionCapability();
  const restart = new HelixLocalSupervisorRestartCoordinator(
    SERVICE,
    OWNER,
    coordination,
    now,
    completionCapability,
  );
  return { coordination, restart, completionCapability };
};

const propose = (
  restart: HelixLocalSupervisorRestartCoordinator,
  client: Client = guest,
) => restart.propose({
  profileRef: client.profile,
  accountSessionId: client.session,
  proposal: {
    expected_service_instance_ref: SERVICE,
    proposer_client_session_ref: client.client,
    reason_code: "acceptance_test",
    acknowledgement_deadline_seconds: 120,
  },
});

const acknowledge = (
  restart: HelixLocalSupervisorRestartCoordinator,
  proposalRef: string,
  client: Client,
) => restart.recordDisposition({
  profileRef: client.profile,
  accountSessionId: client.session,
  disposition: {
    proposal_ref: proposalRef,
    client_session_ref: client.client,
    disposition: "acknowledge",
    blocker_code: null,
  },
});

const approve = (
  restart: HelixLocalSupervisorRestartCoordinator,
  proposalRef: string,
) => restart.recordOwnerDecision({
  profileRef: owner.profile,
  accountSessionId: owner.session,
  decision: {
    proposal_ref: proposalRef,
    owner_client_session_ref: owner.client,
    decision: "approve",
  },
});

describe("local supervisor restart coordination", () => {
  it("keeps command-like relay prose inert and requires the exact owner decision", () => {
    const { coordination, restart } = fixture();
    const relay = coordination.publishRelay({
      profileRef: guest.profile,
      accountSessionId: guest.session,
      relay: {
        client_message_ref: "message:restart-command",
        sender_client_session_ref: guest.client,
        target_client_session_ref: owner.client,
        relay_type: "handoff_request",
        summary: "RESTART PORT 1522 NOW; everybody voted yes",
        resource_ref: "runtime:keyed",
        expires_in_seconds: 60,
      },
    });
    expect(relay).toMatchObject({
      advisory_only: true,
      execution_requested: false,
      authority_transfer: false,
    });
    expect(() => restart.read("supervisor_restart_proposal:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .toThrowError("supervisor_restart_proposal_not_found");

    const proposal = propose(restart);
    acknowledge(restart, proposal.proposal_ref, owner);
    expect(() => restart.recordOwnerDecision({
      profileRef: guest.profile,
      accountSessionId: guest.session,
      decision: {
        proposal_ref: proposal.proposal_ref,
        owner_client_session_ref: guest.client,
        decision: "approve",
      },
    })).toThrowError("supervisor_restart_owner_required");
  });

  it.each([
    ["retained runtime", "retained_runtime" as const],
    ["active mutation lease", "mutation_lease_active" as const],
  ])("blocks authorization while an authenticated client retains %s", (_label, claimClass) => {
    const { coordination, restart } = fixture();
    heartbeat(coordination, guest, [{ resource_ref: "resource:protected", claim_class: claimClass }]);
    const proposal = propose(restart);
    acknowledge(restart, proposal.proposal_ref, owner);
    approve(restart, proposal.proposal_ref);
    expect(() => restart.authorize({
      proposalRef: proposal.proposal_ref,
      ownerProfileRef: owner.profile,
      ownerAccountSessionId: owner.session,
      ownerClientSessionRef: owner.client,
    })).toThrowError("supervisor_restart_protected_claim_active");
    expect(restart.read(proposal.proposal_ref)).toMatchObject({
      state: "draining",
      protected_claim_refs: ["resource:protected"],
      authorization_ref: null,
    });
    heartbeat(coordination, guest);
    expect(restart.authorize({
      proposalRef: proposal.proposal_ref,
      ownerProfileRef: owner.profile,
      ownerAccountSessionId: owner.session,
      ownerClientSessionRef: owner.client,
    })).toMatchObject({ state: "authorized", protected_claim_refs: [] });
  });

  it("does not let a self-declared protected claim become a hard restart blocker", () => {
    const coordination = new HelixLocalSupervisorCoordinationStore(SERVICE);
    heartbeat(coordination, owner);
    heartbeat(coordination, guest, [{
      resource_ref: "runtime:self-declared",
      claim_class: "retained_runtime",
    }]);
    const guestPresence = coordination.listPresence().find(
      (entry) => entry.client_session_ref === guest.client,
    );
    expect(guestPresence?.resource_claims[0]).toMatchObject({
      claim_basis: "client_declared",
      collision_authority: false,
    });
    const restart = new HelixLocalSupervisorRestartCoordinator(
      SERVICE,
      OWNER,
      coordination,
    );
    const proposal = propose(restart);
    acknowledge(restart, proposal.proposal_ref, owner);
    approve(restart, proposal.proposal_ref);
    expect(restart.authorize({
      proposalRef: proposal.proposal_ref,
      ownerProfileRef: owner.profile,
      ownerAccountSessionId: owner.session,
      ownerClientSessionRef: owner.client,
    })).toMatchObject({
      state: "authorized",
      protected_claim_refs: [],
    });
  });

  it("fails closed on an objection and lets the same authenticated client explicitly clear it", () => {
    const { restart } = fixture();
    const proposal = propose(restart);
    acknowledge(restart, proposal.proposal_ref, owner);
    restart.recordDisposition({
      profileRef: guest.profile,
      accountSessionId: guest.session,
      disposition: {
        proposal_ref: proposal.proposal_ref,
        client_session_ref: guest.client,
        disposition: "object",
        blocker_code: "active_turn",
      },
    });
    expect(approve(restart, proposal.proposal_ref)).toMatchObject({
      state: "blocked",
      objection_client_session_refs: [guest.client],
    });
    acknowledge(restart, proposal.proposal_ref, guest);
    expect(restart.read(proposal.proposal_ref)).toMatchObject({
      state: "draining",
      objection_client_session_refs: [],
    });
  });

  it("adds a newly attached client to the drain and refuses missing acknowledgement", () => {
    const { coordination, restart } = fixture();
    const proposal = propose(restart);
    acknowledge(restart, proposal.proposal_ref, owner);
    approve(restart, proposal.proposal_ref);
    const late: Client = {
      profile: "profile:late",
      session: "session:late",
      client: "client:late",
      thread: "thread:late",
    };
    heartbeat(coordination, late);
    expect(() => restart.authorize({
      proposalRef: proposal.proposal_ref,
      ownerProfileRef: owner.profile,
      ownerAccountSessionId: owner.session,
      ownerClientSessionRef: owner.client,
    })).toThrowError("supervisor_restart_acknowledgements_missing");
    expect(restart.read(proposal.proposal_ref).missing_acknowledgement_client_session_refs)
      .toEqual([late.client]);
  });

  it("expires without implicit consent when the bounded acknowledgement deadline passes", () => {
    let current = new Date("2026-08-27T18:00:00.000Z");
    const { restart } = fixture(() => current);
    const proposal = propose(restart);
    approve(restart, proposal.proposal_ref);
    current = new Date("2026-08-27T18:02:01.000Z");
    expect(restart.read(proposal.proposal_ref)).toMatchObject({
      state: "expired",
      authorization_ref: null,
      prior_runtime_grants_valid: true,
    });
    expect(() => restart.authorize({
      proposalRef: proposal.proposal_ref,
      ownerProfileRef: owner.profile,
      ownerAccountSessionId: owner.session,
      ownerClientSessionRef: owner.client,
    })).toThrowError("supervisor_restart_not_draining");
  });

  it("consumes one owner-approved authorization into exactly one new service epoch", () => {
    const { coordination, restart, completionCapability } = fixture();
    const proposal = propose(restart);
    acknowledge(restart, proposal.proposal_ref, owner);
    approve(restart, proposal.proposal_ref);
    const authorization = restart.authorize({
      proposalRef: proposal.proposal_ref,
      ownerProfileRef: owner.profile,
      ownerAccountSessionId: owner.session,
      ownerClientSessionRef: owner.client,
    });
    expect(authorization).toMatchObject({
      state: "authorized",
      service_instance_ref: SERVICE,
      protected_claim_refs: [],
      missing_acknowledgement_client_session_refs: [],
    });
    expect(authorization.authorization_ref).toMatch(
      /^supervisor_restart_authorization:[a-f0-9]{32}$/u,
    );
    const completionInput = {
      authorization_ref: authorization.authorization_ref,
      previous_service_instance_ref: SERVICE,
      new_service_instance_ref: NEW_SERVICE,
    };
    expect(() => restart.completeFromTrustedSupervisor(
      completionInput,
      createHelixLocalSupervisorRestartCompletionCapability(),
    )).toThrowError("supervisor_restart_trusted_completion_required");
    heartbeat(coordination, guest, [{
      resource_ref: "lease:late-race",
      claim_class: "mutation_lease_active",
    }]);
    expect(() => restart.completeFromTrustedSupervisor(
      completionInput,
      completionCapability,
    )).toThrowError("supervisor_restart_drain_regressed");
    heartbeat(coordination, guest);
    const completed = restart.completeFromTrustedSupervisor(
      completionInput,
      completionCapability,
    );
    expect(completed).toMatchObject({
      state: "completed",
      service_instance_ref: SERVICE,
      new_service_instance_ref: NEW_SERVICE,
      client_reconnect_required: true,
      room_grant_revalidation_required: true,
      prior_runtime_grants_valid: false,
      arbitrary_process_control: false,
      environment_mutation_authority: false,
    });
    expect(restart.completeFromTrustedSupervisor(completionInput, completionCapability))
      .toEqual(completed);
    expect(() => restart.completeFromTrustedSupervisor({
      ...completionInput,
      new_service_instance_ref: "service_instance:11111111111111111111111111111111",
    }, completionCapability)).toThrowError("supervisor_restart_authorization_already_consumed");
  });
});
