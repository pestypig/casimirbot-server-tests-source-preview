import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  buildHelixEnvironmentTemporalPlan,
  serializeHelixEnvironmentPlanHashContent,
  canonicalEnvironmentTimeValue,
} from "@shared/helix-environment-time";
import { compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact } from "../minecraft-environment-time-compiler";

it("compiles a four-plan continuous chain with movement covering each committed handoff", () => {
  const template = JSON.parse(readFileSync(
    "minecraft/helix-fabric-player-agent/src/test/resources/compiled-rolling-walk.json", "utf8"));
  const { plan_hash: ignored, ...draft } = template.source;
  const chain: Array<Record<string, any>> = [];
  for (let index = 0; index < 4; index++) {
    const start = index * 21;
    const previous = chain.at(-1)?.source;
    const source = buildHelixEnvironmentTemporalPlan({ ...draft,
      plan_id: `plan:continuous:${index}`, previous_plan_id: previous?.plan_id ?? null,
      previous_plan_hash: previous?.plan_hash ?? null,
      identity: { ...draft.identity, environment_id: "env", source_id: "source", subject_id: "subject",
        authority_id: "authority", authority_revision: 1, goal_id: "goal", goal_revision: 1,
        observation_revision: draft.identity.observation_revision + index,
        affordance_revision: draft.identity.affordance_revision + index },
      // The terminal plan has no reserved successor to extend its stop window.
      // Permit its zero-effect completion tick before the outer safety stop.
      watermarks: { ...draft.watermarks, decision_unit: start,
        stop_unit: start + (index === 3 ? 22 : 20), committed_through_unit: start + (index === 3 ? 23 : 21) },
      nodes: draft.nodes.map((node: any) => node.kind === "action" ? { ...node,
        arguments: { ...node.arguments, duration_ms: 1050 },
        // The next tick verifies completed motion without another movement
        // effect; it must fit the typed workflow timeout at the handoff.
        timing: { earliest_start_unit: start, latest_start_unit: start, maximum_duration_units: 22 },
      } : node),
    });
    const artifact = compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({ plan: source,
      mutation_scope: template.artifact.arguments.mutation_scope,
      resource_bindings: { "resource:locomotion": "locomotion" } });
    const { compilation_hash, ...content } = artifact;
    expect(artifact.arguments.nodes.find(node => node.node_kind === "workflow_action"))
      .toMatchObject({ earliest_tick: start, latest_start_tick: start, action: { duration_ms: 1050 } });
    chain.push({ source, artifact, plan_canonical_json: serializeHelixEnvironmentPlanHashContent(source),
      compilation_canonical_json: JSON.stringify(canonicalEnvironmentTimeValue(content)) });
  }
  for (let index = 1; index < chain.length; index++) {
    expect(chain[index].source.previous_plan_hash).toBe(chain[index - 1].source.plan_hash);
    expect(chain[index].source.watermarks.decision_unit).toBe(chain[index - 1].source.watermarks.committed_through_unit);
  }
  mkdirSync("minecraft/helix-fabric-player-agent/build", { recursive: true });
  writeFileSync("minecraft/helix-fabric-player-agent/build/server-compiled-continuous-chain.json", JSON.stringify(chain));
});

it("generates four linked scheduled walks with a separate pre-motion launch window", () => {
  const template = JSON.parse(readFileSync(
    "minecraft/helix-fabric-player-agent/src/test/resources/compiled-rolling-walk.json", "utf8"));
  const { plan_hash: ignored, ...draft } = template.source;
  const plans: Array<{ source: ReturnType<typeof buildHelixEnvironmentTemporalPlan>; artifact: ReturnType<typeof compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact> }> = [];
  for (let index = 0; index < 4; index++) {
    const start = 8 + index * 10;
    const previous = plans.at(-1)?.source;
    const source = buildHelixEnvironmentTemporalPlan({
      ...draft,
      plan_id: `plan:scheduled:${index}`,
      previous_plan_id: previous?.plan_id ?? null,
      previous_plan_hash: previous?.plan_hash ?? null,
      watermarks: { ...draft.watermarks, decision_unit: start, stop_unit: start + 9, committed_through_unit: start + 10 },
      nodes: draft.nodes.map((node: any) => node.kind === "action" ? {
        ...node,
        arguments: { ...node.arguments, duration_ms: 500 },
        timing: { earliest_start_unit: start, latest_start_unit: start, maximum_duration_units: 20 },
      } : node),
    });
    const artifact = compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({
      plan: source, mutation_scope: template.artifact.arguments.mutation_scope,
      resource_bindings: { "resource:locomotion": "locomotion" },
    });
    expect(artifact.arguments.nodes.find(node => node.node_kind === "workflow_action"))
      .toMatchObject({ earliest_tick: start, latest_start_tick: start, action: { duration_ms: 500 } });
    expect(artifact.execution_authority).toBe(false);
    plans.push({ source, artifact });
  }
  expect(plans).toEqual(JSON.parse(readFileSync(
    "minecraft/helix-fabric-player-agent/src/test/resources/compiled-scheduled-handoff.json", "utf8")));
});

it.each(["narrow", "wide"])("generates a hash-linked server-compiled pair (%s)", mode => {
  const template = JSON.parse(
    readFileSync(
      "minecraft/helix-fabric-player-agent/src/test/resources/compiled-rolling-walk.json",
      "utf8",
    ),
  );
  const { plan_hash: ignored, ...draft } = template.source;
  expect(ignored).toMatch(/^sha256:/);
  const root = buildHelixEnvironmentTemporalPlan({
    ...draft,
    plan_id: "plan:0",
    watermarks: mode === "wide" ? { ...draft.watermarks, stop_unit: 20, committed_through_unit: 21 } : draft.watermarks,
    identity: {
      ...draft.identity,
      environment_id: "env",
      source_id: "source",
      subject_id: "subject",
      authority_id: "authority",
      authority_revision: 1,
      goal_id: "goal",
      goal_revision: 1,
    },
  });
  const child = buildHelixEnvironmentTemporalPlan({
    ...draft,
    plan_id: "plan:1",
    previous_plan_id: root.plan_id,
    previous_plan_hash: root.plan_hash,
    identity: { ...root.identity, affordance_revision: root.identity.affordance_revision + 1 },
    // The clock is the observed origin, not a future activation timestamp.
    // Successor watermarks extend the same observed clock beyond the root.
    clocks: root.clocks,
    nodes: draft.nodes.map((node: any) =>
      node.kind === "action"
        ? {
            ...node,
            timing: {
              ...node.timing,
              earliest_start_unit: Math.max(
                node.timing.earliest_start_unit,
                root.watermarks.committed_through_unit,
              ),
            },
          }
        : node,
    ),
    watermarks: { ...root.watermarks, stop_unit: root.watermarks.committed_through_unit + 1,
      committed_through_unit: root.watermarks.committed_through_unit + 2 },
  });
  const compile = (source: typeof root) => {
    const artifact = compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact(
      {
        plan: source,
        mutation_scope: template.artifact.arguments.mutation_scope,
        resource_bindings: { "resource:locomotion": "locomotion" },
      },
    );
    const { compilation_hash, ...content } = artifact;
    return {
      source,
      artifact,
      plan_canonical_json: serializeHelixEnvironmentPlanHashContent(source),
      compilation_canonical_json: JSON.stringify(
        canonicalEnvironmentTimeValue(content),
      ),
    };
  };
  const pair = { root: compile(root), child: compile(child) };
  expect(pair.child.source.previous_plan_hash).toBe(pair.root.source.plan_hash);
  expect(pair.child.source.watermarks.committed_through_unit).toBeGreaterThan(
    root.watermarks.committed_through_unit,
  );
  expect(pair.child.artifact.arguments.sequence_id).toBe("plan:1");
  expect(pair.child.artifact.execution_authority).toBe(false);
  expect(
    child.nodes
      .filter((node) => node.kind === "action")
      .every(
        (node) =>
          node.kind === "action" &&
          child.clocks.environment.sequence + node.timing.earliest_start_unit >=
            root.clocks.environment.sequence +
              root.watermarks.committed_through_unit,
      ),
  ).toBe(true);
  const directory = "minecraft/helix-fabric-player-agent/build";
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    `${directory}/server-compiled-handoff${mode === "wide" ? "-wide" : ""}.json`,
    JSON.stringify(pair),
    "utf8",
  );
});
