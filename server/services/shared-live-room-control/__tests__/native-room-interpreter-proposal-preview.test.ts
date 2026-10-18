import { expect, it, vi } from "vitest";
import { inspectNativeHostedRoomInterpreterProposalPreview } from
  "../native-room-interpreter-proposal-preview";

const roomId = "shared_realtime_room:11111111-1111-4111-8111-111111111111";
const requestId = "room_interpreter_turn:22222222-2222-4222-8222-222222222222";
const authority = "https://rooms.test";
const account = { profileId: "profile:owner", sessionId: "session:owner" };
const selected = { room_id: roomId, authority, selection_ref: "native-selection:one",
  selection_revision: 3, task_label: "Codex task", captures: [], raw_content_included: false,
  dispatch_authority: false };
const source = { schema: "helix.shared_live_room.interpreter_proposal_source.v1",
  api_version: "v1", ok: true, operation: "room.interpreter.proposal_source",
  room: { room_id: roomId }, source: { request_id: requestId,
    interpreter_session_id: "room_interpreter:33333333-3333-4333-8333-333333333333",
    generation: 2, context_sha256: "a".repeat(64),
    trigger_message_id: "room_message:44444444-4444-4444-8444-444444444444",
    trigger_author_participant_id: "participant:guest", trigger_text: "Could we do this?",
    reply_text: "Here is a possible task.", result_sha256: "b".repeat(64) },
  source_current: true, proposal_queued: false, model_input: false, provider_calls: 0,
  task_handoff: false, reentry_required: true, answer_authority: false,
  assistant_answer: false, terminal_eligible: false, raw_content_included: true };

function fixture() {
  const inspect = vi.fn(async () => selected);
  const read = vi.fn(async () => source);
  const connection = { identityFor: () => ({ authority, connectionRef: "connection:owner" }),
    inspectHostedInterpreterProposalSource: read };
  const connect = () => connection;
  const authorizeRequest = vi.fn(async () => undefined);
  const input = { account, roomId, requestId, authorizeRequest,
    access: {} as Parameters<typeof inspectNativeHostedRoomInterpreterProposalPreview>[0]["access"] };
  const deps = { inspectInstructions: inspect as unknown as NonNullable<Parameters<typeof inspectNativeHostedRoomInterpreterProposalPreview>[1]>["inspectInstructions"],
    connection: connect as unknown as NonNullable<Parameters<typeof inspectNativeHostedRoomInterpreterProposalPreview>[1]>["connection"] };
  return { input, deps, inspect, read, authorizeRequest };
}

it("previews one current reply against the same reviewed task without queueing", async () => {
  const f = fixture();
  const result = await inspectNativeHostedRoomInterpreterProposalPreview(f.input, f.deps);
  expect(result).toMatchObject({ room_id: roomId, selection_ref: selected.selection_ref,
    selection_revision: 3, task_label: "Codex task", source,
    proposal_queued: false, dispatch_authority: false, raw_content_included: true });
  expect(f.inspect).toHaveBeenCalledTimes(2);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.authorizeRequest).toHaveBeenCalledTimes(2);
});

it("rejects selection or source drift during the preview", async () => {
  const selectionChanged = fixture();
  selectionChanged.inspect.mockResolvedValueOnce(selected)
    .mockResolvedValueOnce({ ...selected, selection_revision: 4 });
  await expect(inspectNativeHostedRoomInterpreterProposalPreview(selectionChanged.input,
    selectionChanged.deps)).rejects.toMatchObject({ code: "hosted_room_selection_changed" });
  const sourceChanged = fixture();
  sourceChanged.read.mockResolvedValueOnce(source)
    .mockResolvedValueOnce({ ...source, source: { ...source.source, result_sha256: "c".repeat(64) } });
  await expect(inspectNativeHostedRoomInterpreterProposalPreview(sourceChanged.input,
    sourceChanged.deps)).rejects.toMatchObject({ code: "hosted_room_selection_changed" });
});
