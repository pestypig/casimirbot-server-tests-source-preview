import { expect, it } from "vitest";
import { environmentActionStartDeadlineSupported } from "../action-broker";

it.each(["execute_sequence", "execute_reactive_program"])("requires a current feature for %s deadlines", kind => {
  const args = (nodes: Record<string, unknown>[]) => kind === "execute_sequence"
    ? { nodes } : { lanes: [{ nodes: [] }, { nodes }] };
  expect(environmentActionStartDeadlineSupported(kind, args([{}]))).toBe(true);
  // Zero is an explicit deadline, not absence.
  for (const deadline of [0, 10]) {
    const request = args([{ latest_start_tick: deadline }]);
    expect(environmentActionStartDeadlineSupported(kind, request)).toBe(false);
    expect(environmentActionStartDeadlineSupported(kind, request, [])).toBe(false);
    expect(environmentActionStartDeadlineSupported(kind, request, ["some_other_feature"])).toBe(false);
    expect(environmentActionStartDeadlineSupported(kind, request, ["latest_start_tick_v1"])).toBe(true);
  }
});

it("does not turn quoted argument text into a feature requirement", () => {
  expect(environmentActionStartDeadlineSupported("walk", { label: "latest_start_tick" })).toBe(true);
});
