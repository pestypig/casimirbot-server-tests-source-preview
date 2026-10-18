import { expect, it } from "vitest";
import {
  measureTemporalProposalReceipt,
  readTemporalPublicationClock,
} from "../temporal-publication-clock";

it("measures only a same-origin public interval without claiming sampling or execution", () => {
  expect(
    measureTemporalProposalReceipt(
      { origin_id: "process", elapsed_ms: 10 },
      { origin_id: "process", elapsed_ms: 110 },
    ),
  ).toMatchObject({
    frontier_publication_to_proposal_receipt_ms: 100,
    provider_sampling_latency_ms: null,
    execution_authority: false,
    live_acceptance: false,
  });
  const first = readTemporalPublicationClock();
  const second = readTemporalPublicationClock();
  expect(second.origin_id).toBe(first.origin_id);
  expect(second.elapsed_ms).toBeGreaterThanOrEqual(first.elapsed_ms);
});

it.each([
  [
    { origin_id: "old-process", elapsed_ms: 10 },
    { origin_id: "new-process", elapsed_ms: 100 },
  ],
  [
    { origin_id: "", elapsed_ms: 10 },
    { origin_id: "", elapsed_ms: 100 },
  ],
  [
    { origin_id: "process", elapsed_ms: 110 },
    { origin_id: "process", elapsed_ms: 100 },
  ],
  [
    { origin_id: "process", elapsed_ms: NaN },
    { origin_id: "process", elapsed_ms: 100 },
  ],
  [
    { origin_id: "process", elapsed_ms: -1 },
    { origin_id: "process", elapsed_ms: 100 },
  ],
])(
  "keeps restart, missing and invalid clocks unavailable",
  (published, received) => {
    expect(measureTemporalProposalReceipt(published, received)).toMatchObject({
      frontier_publication_to_proposal_receipt_ms: null,
      reason_code: "publication_clock_unavailable",
    });
  },
);
