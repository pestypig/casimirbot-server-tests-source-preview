import { describe, expect, it } from "vitest";
import { runBoundedProviderSelectedContinuation } from "../bounded-provider-continuation";

type Request = {
  capability: string;
};

type Result = {
  request: Request | null;
  answer?: string;
};

describe("bounded provider-selected continuation", () => {
  it("re-enters tool A and tool B observations before accepting final synthesis", async () => {
    const executed: string[] = [];
    const result = await runBoundedProviderSelectedContinuation<
      Result,
      Request,
      { capability: string; ok: true }
    >({
      initialResult: {
        request: { capability: "tool.a" },
      },
      maxSteps: 4,
      requestFromResult: (entry) => entry.request,
      requestFingerprint: (request) => request.capability,
      admitRequest: () => true,
      executeAndReenter: async (request) => {
        executed.push(request.capability);
        return {
          observation: {
            capability: request.capability,
            ok: true,
          },
          result:
            request.capability === "tool.a"
              ? { request: { capability: "tool.b" } }
              : { request: null, answer: "Grounded final synthesis." },
        };
      },
    });

    expect(executed).toEqual(["tool.a", "tool.b"]);
    expect(result).toMatchObject({
      stop_reason: "no_next_request",
      pending_request: null,
      result: {
        request: null,
        answer: "Grounded final synthesis.",
      },
    });
    expect(result.steps.map((step) => step.observation.capability)).toEqual([
      "tool.a",
      "tool.b",
    ]);
  });

  it("carries a Minecraft inventory observation into a later model synthesis", async () => {
    const result = await runBoundedProviderSelectedContinuation<
      Result,
      Request,
      { capability: string; slots: number }
    >({
      initialResult: {
        request: {
          capability: "com.casimirbot.minecraft.inventory.check",
        },
      },
      maxSteps: 2,
      requestFromResult: (entry) => entry.request,
      requestFingerprint: (request) => request.capability,
      admitRequest: (request) =>
        request.capability ===
        "com.casimirbot.minecraft.inventory.check",
      executeAndReenter: async (request) => ({
        observation: {
          capability: request.capability,
          slots: 9,
        },
        result: {
          request: null,
          answer: "The current inventory observation contains nine slots.",
        },
      }),
    });

    expect(result.stop_reason).toBe("no_next_request");
    expect(result.steps).toEqual([
      {
        iteration: 1,
        request: {
          capability: "com.casimirbot.minecraft.inventory.check",
        },
        observation: {
          capability: "com.casimirbot.minecraft.inventory.check",
          slots: 9,
        },
      },
    ]);
    expect(result.result.answer).toContain("nine slots");
  });

  it("fails boundedly without executing duplicate or over-budget requests", async () => {
    const duplicate = await runBoundedProviderSelectedContinuation<
      Result,
      Request,
      { ok: true }
    >({
      initialResult: { request: { capability: "tool.a" } },
      maxSteps: 2,
      requestFromResult: (entry) => entry.request,
      requestFingerprint: (request) => request.capability,
      priorRequestFingerprints: ["tool.a"],
      admitRequest: () => true,
      executeAndReenter: async () => {
        throw new Error("duplicate request must not execute");
      },
    });
    expect(duplicate.stop_reason).toBe("duplicate_request");

    const exhausted = await runBoundedProviderSelectedContinuation<
      Result,
      Request,
      { ok: true }
    >({
      initialResult: { request: { capability: "tool.a" } },
      maxSteps: 1,
      requestFromResult: (entry) => entry.request,
      requestFingerprint: (request) => request.capability,
      admitRequest: () => true,
      executeAndReenter: async () => ({
        observation: { ok: true },
        result: { request: { capability: "tool.b" } },
      }),
    });
    expect(exhausted).toMatchObject({
      stop_reason: "budget_exhausted",
      pending_request: { capability: "tool.b" },
    });
  });

  it("re-enters one duplicate rejection so the provider can synthesize a final answer", async () => {
    const reentered: string[] = [];
    const result = await runBoundedProviderSelectedContinuation<
      Result,
      Request,
      { ok: true }
    >({
      initialResult: { request: { capability: "tool.a" } },
      maxSteps: 2,
      requestFromResult: (entry) => entry.request,
      requestFingerprint: (request) => request.capability,
      priorRequestFingerprints: ["tool.a"],
      admitRequest: () => true,
      executeAndReenter: async () => {
        throw new Error("duplicate request must not execute");
      },
      reenterRejection: async (request, reason) => {
        reentered.push(`${reason}:${request.capability}`);
        return {
          request: null,
          answer: "Final synthesis after the duplicate was rejected.",
        };
      },
    });

    expect(reentered).toEqual(["duplicate_request:tool.a"]);
    expect(result).toMatchObject({
      stop_reason: "no_next_request",
      pending_request: null,
      rejections: [
        {
          iteration: 1,
          request: { capability: "tool.a" },
          reason: "duplicate_request",
        },
      ],
      result: {
        request: null,
        answer: "Final synthesis after the duplicate was rejected.",
      },
    });
  });

  it("gives a repeated duplicate one bounded completeness review before stopping", async () => {
    const executed: string[] = [];
    let reviews = 0;
    const result = await runBoundedProviderSelectedContinuation<
      Result,
      Request,
      { capability: string; ok: true }
    >({
      initialResult: { request: { capability: "tool.inspect" } },
      maxSteps: 5,
      maxTerminalReviews: 1,
      requestFromResult: (entry) => entry.request,
      requestFingerprint: (request) => request.capability,
      priorRequestFingerprints: ["tool.inspect"],
      admitRequest: () => true,
      reenterRejection: async () => ({
        request: { capability: "tool.inspect" },
      }),
      reviewTerminalCandidate: async (currentResult) => {
        reviews += 1;
        return currentResult.answer === "Mutation and verification complete."
          ? currentResult
          : { request: { capability: "tool.mutate" } };
      },
      executeAndReenter: async (request) => {
        executed.push(request.capability);
        return {
          observation: { capability: request.capability, ok: true },
          result: {
            request: null,
            answer: "Mutation and verification complete.",
          },
        };
      },
    });

    expect(executed).toEqual(["tool.mutate"]);
    expect(reviews).toBe(2);
    expect(result).toMatchObject({
      stop_reason: "no_next_request",
      pending_request: null,
      terminal_reviewed: true,
      terminal_review_count: 2,
      result: { answer: "Mutation and verification complete." },
    });
  });

  it("gives a compound terminal candidate one bounded provider-owned completeness review", async () => {
    const executed: string[] = [];
    let reviews = 0;
    const result = await runBoundedProviderSelectedContinuation<
      Result,
      Request,
      { capability: string; ok: true }
    >({
      initialResult: {
        request: null,
        answer: "The first observation succeeded, but the procedure is incomplete.",
      },
      maxSteps: 3,
      requestFromResult: (entry) => entry.request,
      requestFingerprint: (request) => request.capability,
      admitRequest: (request) => request.capability === "tool.restore",
      reviewTerminalCandidate: async (currentResult) => {
        reviews += 1;
        return currentResult.answer === "The procedure is now complete."
          ? currentResult
          : { request: { capability: "tool.restore" } };
      },
      executeAndReenter: async (request) => {
        executed.push(request.capability);
        return {
          observation: { capability: request.capability, ok: true },
          result: { request: null, answer: "The procedure is now complete." },
        };
      },
    });

    expect(reviews).toBe(2);
    expect(executed).toEqual(["tool.restore"]);
    expect(result).toMatchObject({
      stop_reason: "no_next_request",
      pending_request: null,
      terminal_reviewed: true,
      terminal_review_count: 2,
      result: { request: null, answer: "The procedure is now complete." },
    });
  });

  it("uses the configured bounded review count when the first review still terminalizes early", async () => {
    let reviews = 0;
    const result = await runBoundedProviderSelectedContinuation<
      Result,
      Request,
      { capability: string; ok: true }
    >({
      initialResult: {
        request: null,
        answer: "Only the first observation exists.",
      },
      maxSteps: 3,
      maxTerminalReviews: 2,
      requestFromResult: (entry) => entry.request,
      requestFingerprint: (request) => request.capability,
      admitRequest: () => true,
      reviewTerminalCandidate: async (currentResult) => {
        reviews += 1;
        if (currentResult.answer === "Restored and verified.") {
          return currentResult;
        }
        return reviews === 1
          ? { request: null, answer: "The first review still stopped early." }
          : { request: { capability: "tool.restore" } };
      },
      executeAndReenter: async (request) => ({
        observation: { capability: request.capability, ok: true },
        result: { request: null, answer: "Restored and verified." },
      }),
    });

    expect(reviews).toBe(4);
    expect(result).toMatchObject({
      stop_reason: "no_next_request",
      terminal_reviewed: true,
      terminal_review_count: 4,
      max_terminal_reviews: 2,
      terminal_review_limit_exhausted: true,
      steps: [{ request: { capability: "tool.restore" } }],
      result: { answer: "Restored and verified." },
    });
  });

  it("renews the bounded completeness review after each successful observation", async () => {
    const executed: string[] = [];
    let reviews = 0;
    const nextRequests = ["tool.mutate", "tool.restore", "tool.verify"];
    const result = await runBoundedProviderSelectedContinuation<
      Result,
      Request,
      { capability: string; ok: true }
    >({
      initialResult: {
        request: null,
        answer: "Only the initial query has been observed.",
      },
      maxSteps: 3,
      maxTerminalReviews: 1,
      requestFromResult: (entry) => entry.request,
      requestFingerprint: (request) => request.capability,
      admitRequest: () => true,
      reviewTerminalCandidate: async () => {
        const capability = nextRequests[reviews] ?? null;
        reviews += 1;
        return capability
          ? { request: { capability } }
          : { request: null, answer: "Complete." };
      },
      executeAndReenter: async (request) => {
        executed.push(request.capability);
        return {
          observation: { capability: request.capability, ok: true },
          result: {
            request: null,
            answer:
              request.capability === "tool.verify"
                ? "Restored and verified."
                : "The procedure is still incomplete.",
          },
        };
      },
    });

    expect(executed).toEqual([
      "tool.mutate",
      "tool.restore",
      "tool.verify",
    ]);
    expect(reviews).toBe(3);
    expect(result).toMatchObject({
      stop_reason: "no_next_request",
      terminal_review_count: 3,
      steps: [
        { request: { capability: "tool.mutate" } },
        { request: { capability: "tool.restore" } },
        { request: { capability: "tool.verify" } },
      ],
      result: { answer: "Restored and verified." },
    });
  });
});
