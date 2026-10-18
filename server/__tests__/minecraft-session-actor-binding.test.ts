import { describe, expect, it } from "vitest";
import {
  hasUsableActorBinding,
  projectMinecraftActorBindingFromEnvironmentSubject,
} from "../services/situation-room/minecraft-session-actor-binding";

describe("Minecraft legacy actor-binding compatibility", () => {
  it("projects the durable room environment subject without inventing identity", () => {
    const projected = projectMinecraftActorBindingFromEnvironmentSubject({
      roomId: "shared_realtime_room:compatibility",
      threadId: "helix-ask:room:shared_realtime_room:compatibility",
      profileId: "profile:compatibility",
      subject: {
        participantId: "participant:compatibility",
        subjectBindingId: "environment_subject_binding:compatibility",
        subjectNativeId: "123e4567-e89b-12d3-a456-426614174000",
        subjectRef: "environment_subject:compatibility",
        subjectLabel: "CompatiblePlayer",
        verificationMethod: "self_claim",
        confidence: 0.8,
        producerEpochRef: "adapter_epoch:compatibility",
      },
    });

    expect(projected).toMatchObject({
      binding_id: "environment_subject_binding:compatibility",
      minecraft_actor_id: "123e4567-e89b-12d3-a456-426614174000",
      minecraft_actor_label: "CompatiblePlayer",
      source: "manual_link",
      context_role: "tool_evidence",
      instruction_authority: "none",
      creates_ask_turn: false,
      turn_triggered: false,
      ask_admissible: true,
    });
    expect(hasUsableActorBinding(projected)).toBe(true);
  });
});
