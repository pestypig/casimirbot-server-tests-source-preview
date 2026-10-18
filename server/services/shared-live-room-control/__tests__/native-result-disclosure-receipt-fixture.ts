import { hostedRoomResultDisclosureReceiptSchema } from "@shared/helix-hosted-room-result-disclosure";
import type { NativeSharedLiveRoomConnection } from "../native-room-connection";

export function nativeResultDisclosureReceipt(...args: Parameters<NativeSharedLiveRoomConnection["discloseOwnerNodeResult"]>) {
  const [, roomId, attachment, capture, digest, report] = args;
  return hostedRoomResultDisclosureReceiptSchema.parse({
    schema: "helix.shared_live_room.result_disclosure.v1", api_version: "v1", ok: true, operation: "room.owner_node.result_disclose",
    room: { room_id: roomId }, capture,
    claim: { claim_ref: "room_handoff_claim:11111111-1111-4111-8111-111111111111", handoff_id: capture.handoff_id,
      attachment_ref: attachment.attachment_ref, attachment_revision: attachment.revision, node_ref: attachment.node_ref,
      transcript_text_hash: capture.transcript_text_hash, dispatch_digest: digest, status: "claimed", dispatch_authority: false },
    disclosure: { disclosure_ref: `room_task_disclosure:${"d".repeat(32)}`, result_sha256: report.result_sha256,
      task_status: report.task_status, created_at: "2026-09-25T18:00:00.000Z", content_role: "untrusted_external_task_observation" },
    room_disclosure_recorded: true, room_presentation_confirmed: false, reentry_required: true,
    answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false,
  });
}
