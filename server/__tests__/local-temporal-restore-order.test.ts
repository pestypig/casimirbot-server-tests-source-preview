import { describe, expect, it } from "vitest";
import { orderLocalTemporalAdmissions } from "../db/local-temporal-restore-order";

describe("local temporal restore ordering", () => {
  const root = { plan_id: "root", plan_hash: "hash:root", previous_plan_id: null, previous_plan_hash: null };
  it("orders exact parent links without mutating input", () => {
    const child = { plan_id: "child", plan_hash: "hash:child", previous_plan_id: "root", previous_plan_hash: "hash:root" };
    const input = [child, root];
    expect(orderLocalTemporalAdmissions(input)).toEqual([root, child]);
    expect(input).toEqual([child, root]);
  });
  it("does not repair missing, wrong-hash or cyclic predecessors", () => {
    const wrongHash = { plan_id: "wrong", plan_hash: "hash:wrong", previous_plan_id: "root", previous_plan_hash: "other" };
    const missing = { plan_id: "missing", plan_hash: "hash:missing", previous_plan_id: "absent", previous_plan_hash: "hash:absent" };
    const cycle = { plan_id: "cycle", plan_hash: "hash:cycle", previous_plan_id: "cycle", previous_plan_hash: "hash:cycle" };
    expect(orderLocalTemporalAdmissions([wrongHash, missing, cycle, root])).toEqual([root, wrongHash, missing, cycle]);
  });
  it("handles long reversed chains without recursion", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ plan_id: String(i), plan_hash: String(i),
      previous_plan_id: i ? String(i - 1) : null, previous_plan_hash: i ? String(i - 1) : null }));
    expect(orderLocalTemporalAdmissions([...rows].reverse())).toEqual(rows);
  });
});
