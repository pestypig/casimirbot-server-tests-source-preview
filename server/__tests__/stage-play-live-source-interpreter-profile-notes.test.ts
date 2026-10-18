import { beforeEach, describe, expect, it } from "vitest";
import { buildStagePlayLiveSourceInterpreterProfileV1 } from "@shared/contracts/stage-play-live-source-interpreter-profile.v1";
import {
  getStagePlayLiveSourceInterpreterProfile,
  recordStagePlayLiveSourceInterpreterProfile,
  resetStagePlayLiveSourceInterpreterProfileStoreForTest,
} from "../services/stage-play/stage-play-live-source-interpreter-profile-store";
import {
  compileInterpreterProfileFromNote,
  createInterpreterProfileNote,
  openInterpreterProfileNote,
  resetStagePlayLiveSourceInterpreterProfileNotesForTest,
  syncInterpreterProfileNote,
} from "../services/stage-play/stage-play-live-source-interpreter-profile-notes";

const seedProfile = () =>
  recordStagePlayLiveSourceInterpreterProfile(
    buildStagePlayLiveSourceInterpreterProfileV1({
      profileId: "stage_play_live_source_interpreter_profile:note-test",
      title: "Minecraft Survival Coach",
      threadId: "thread-note-test",
      roomId: "room-note-test",
      environmentId: "env-note-test",
      jobId: "job-note-test",
      policyId: "policy-note-test",
      sourceKinds: ["visual_frame"],
      domain: "minecraft",
      objectiveText: "Watch the Minecraft visual source like a survival coach.",
      interpretationGuidelines: "Preserve visual observations and distinguish observed from inferred.",
      lenses: ["survival", "navigation"],
      salienceCriteria: ["hostile mobs", "darkness or cave entry"],
      suppressCriteria: ["routine walking"],
      riskCriteria: ["low health"],
      opportunityCriteria: ["rare resources"],
      voiceCalloutCriteria: ["danger"],
      evidenceRules: {
        preserveRawObservation: true,
        distinguishObservedVsInferred: true,
        requireEvidenceRefs: true,
        askWhenUncertain: true,
      },
      outputStyle: {
        textAnswerStyle: "brief_explanation",
        voiceStyle: "short_callout",
      },
      linkedNoteId: null,
      linkedNoteTitle: null,
      status: "active",
      evidenceRefs: ["job-note-test", "policy-note-test"],
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
    }),
  );

describe("stage-play interpreter profile notes", () => {
  beforeEach(() => {
    resetStagePlayLiveSourceInterpreterProfileStoreForTest();
    resetStagePlayLiveSourceInterpreterProfileNotesForTest();
  });

  it("creates a linked editable note from the canonical profile template", () => {
    const profile = seedProfile();
    const note = createInterpreterProfileNote({
      profileId: profile.profileId,
      now: "2026-06-08T00:00:01.000Z",
    });

    expect(note).toMatchObject({
      artifactId: "stage_play_live_source_interpreter_profile_note",
      schemaVersion: "stage_play_live_source_interpreter_profile_note/v1",
      profileId: profile.profileId,
      title: "Minecraft Survival Coach Guidelines",
      compileStatus: "draft",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(note.body).toContain("# Minecraft Survival Coach");
    expect(note.body).toContain("## Objective");
    expect(note.body).toContain("Watch the Minecraft visual source like a survival coach.");
    expect(note.body).toContain("## Salience Criteria");
    expect(note.body).toContain("- hostile mobs");
    expect(note.body).toContain("Text: brief explanation");
    expect(getStagePlayLiveSourceInterpreterProfile(profile.profileId)?.linkedNoteId).toBe(note.noteId);
    expect(openInterpreterProfileNote({ profileId: profile.profileId })?.noteId).toBe(note.noteId);
  });

  it("syncs note edits without mutating the runtime profile until compile", () => {
    const profile = seedProfile();
    const note = createInterpreterProfileNote({
      profileId: profile.profileId,
      now: "2026-06-08T00:00:01.000Z",
    });
    const editedBody = note.body.replace(
      "Watch the Minecraft visual source like a survival coach.",
      "Watch for cave entry and call out only strategic survival changes.",
    );
    const synced = syncInterpreterProfileNote({
      noteId: note.noteId,
      body: editedBody,
      updatedAt: "2026-06-08T00:00:02.000Z",
    });

    expect(synced?.compileStatus).toBe("draft");
    expect(openInterpreterProfileNote({ noteId: note.noteId })?.body).toContain("cave entry");
    expect(getStagePlayLiveSourceInterpreterProfile(profile.profileId)?.objectiveText)
      .toBe("Watch the Minecraft visual source like a survival coach.");
  });

  it("compiles edited note sections back into a validated canonical profile artifact", () => {
    const profile = seedProfile();
    const note = createInterpreterProfileNote({
      profileId: profile.profileId,
      now: "2026-06-08T00:00:01.000Z",
    });
    syncInterpreterProfileNote({
      noteId: note.noteId,
      body: [
        "# Minecraft Cave Coach",
        "",
        "## Objective",
        "Watch for cave entry and call out only strategic survival changes.",
        "",
        "## Interpretation Guidelines",
        "Keep observed blocks, mobs, and UI indicators separate from inferred player intent.",
        "",
        "## Salience Criteria",
        "- hostile mobs",
        "- darkness",
        "- rare resources",
        "",
        "## Suppress Criteria",
        "- routine walking",
        "- repeated unchanged menu view",
        "",
        "## Risk Criteria",
        "- low health",
        "- lava",
        "",
        "## Opportunity Criteria",
        "- diamonds",
        "",
        "## Voice Callout Criteria",
        "- danger",
        "- urgent opportunity",
        "",
        "## Output Style",
        "Text: one sentence",
        "Voice: warning only",
      ].join("\n"),
      updatedAt: "2026-06-08T00:00:02.000Z",
    });

    const result = compileInterpreterProfileFromNote({
      noteId: note.noteId,
      updatedAt: "2026-06-08T00:00:03.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.note.compileStatus).toBe("compiled");
    expect(result.profile).toMatchObject({
      profileId: profile.profileId,
      title: "Minecraft Cave Coach",
      objectiveText: "Watch for cave entry and call out only strategic survival changes.",
      interpretationGuidelines: "Keep observed blocks, mobs, and UI indicators separate from inferred player intent.",
      salienceCriteria: ["hostile mobs", "darkness", "rare resources"],
      suppressCriteria: ["routine walking", "repeated unchanged menu view"],
      riskCriteria: ["low health", "lava"],
      opportunityCriteria: ["diamonds"],
      voiceCalloutCriteria: ["danger", "urgent opportunity"],
      outputStyle: {
        textAnswerStyle: "one_sentence",
        voiceStyle: "warning_only",
      },
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(getStagePlayLiveSourceInterpreterProfile(profile.profileId)?.evidenceRefs)
      .toEqual(expect.arrayContaining([note.noteId]));
  });
});
