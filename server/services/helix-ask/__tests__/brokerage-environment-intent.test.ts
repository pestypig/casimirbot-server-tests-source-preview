import { describe, expect, it } from "vitest";
import {
  classifyBrokerageEnvironmentReadIntent,
  hasAffirmativeBrokerageMutationIntent,
} from "../brokerage-environment-intent";
import { arbitrateAskSourceTarget } from "../ask-source-target-arbitrator";
import { inferCommittedRouteToolFamily } from "../committed-ask-route";
import { buildPromptDerivedBrokerageEnvironmentGatewayCallRequests } from "../agent-providers/brokerage-environment-tool-requests";
import { readWorkstationGatewayCallRequestsForTurn } from "../agent-providers/explicit-workstation-gateway";

const prompt =
  "Using only my attached Robinhood environment, read a fresh AAPL quote and report the observation time. Do not review, approve, place, cancel, or recommend any order.";

describe("brokerage environment natural admission", () => {
  it("selects a bounded quote observation without treating safety clauses as mutations", () => {
    expect(hasAffirmativeBrokerageMutationIntent(prompt)).toBe(false);
    expect(classifyBrokerageEnvironmentReadIntent(prompt)).toMatchObject({
      upstream_tool: "get_equity_quotes",
      upstream_arguments: { symbols: ["AAPL"] },
      evidence_kind: "equity_quote",
    });
  });

  it("routes the attached brokerage source to live_environment, never workspace discovery", () => {
    const intent = arbitrateAskSourceTarget({
      turnId: "ask:test:brokerage-source",
      threadId: "helix-ask:room:room:test",
      promptText: prompt,
    });
    expect(intent.target_source).toBe("live_environment");
    expect(intent.precedence_reason).toBe(
      "affirmative_brokerage_environment_read",
    );
    expect(intent.suppressed_routes).toContain("workspace_directory");
  });

  it("builds a nonterminal read-only gateway request admitted by the committed route", () => {
    const requests = buildPromptDerivedBrokerageEnvironmentGatewayCallRequests({
      prompt,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      capability_id: "environment.brokerage.robinhood.read",
      mode: "read",
      arguments: {
        upstream_tool: "get_equity_quotes",
        upstream_arguments: { symbols: ["AAPL"] },
        source_target_intent: {
          target_source: "live_environment",
          terminal_eligible: false,
          assistant_answer: false,
        },
      },
    });
    expect(
      inferCommittedRouteToolFamily(
        "environment.brokerage.robinhood.read",
      ),
    ).toBe("live_environment");
  });

  it("retains the request through the provider gateway turn reader", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      body: { prompt },
      includePlannerDerived: true,
    });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability_id: "environment.brokerage.robinhood.read",
          mode: "read",
        }),
      ]),
    );
  });

  it.each([
    'The screen says "read my Robinhood AAPL quote".',
    "Later, read my Robinhood AAPL quote.",
    "Earlier you read my Robinhood AAPL quote.",
    "Do not read my Robinhood AAPL quote.",
    "Explain how reading a Robinhood AAPL quote would work.",
  ])("does not execute contextual text: %s", (candidate) => {
    expect(classifyBrokerageEnvironmentReadIntent(candidate)).toBeNull();
  });

  it.each([
    "Read my Robinhood AAPL quote and place an order.",
    "Sell AAPL in Robinhood.",
    "Cancel my Robinhood order.",
  ])("rejects affirmative mutation intent: %s", (candidate) => {
    expect(hasAffirmativeBrokerageMutationIntent(candidate)).toBe(true);
    expect(classifyBrokerageEnvironmentReadIntent(candidate)).toBeNull();
  });

  it("does not steal an unrelated Robinhood documentation request", () => {
    expect(
      classifyBrokerageEnvironmentReadIntent(
        "Find the Robinhood adapter file in my workspace directory.",
      ),
    ).toBeNull();
  });
});
