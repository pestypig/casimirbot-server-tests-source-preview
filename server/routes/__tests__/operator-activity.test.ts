import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  HELIX_OPERATOR_ACTIVITY_CURSOR_SCHEMA,
  HELIX_OPERATOR_ACTIVITY_PAGE_SCHEMA,
  HELIX_OPERATOR_ACTIVITY_STREAM_LIST_SCHEMA,
} from "@shared/helix-operator-activity";
import {
  createOperatorActivityRouter,
  encodeHelixOperatorActivityCursor,
} from "../operator-activity";
import { HelixOperatorActivityStoreError } from
  "../../services/helix-ask/operator-activity-store";

const SESSION_ID = "session:owned";
const PROFILE_ID = "profile:owned";
const NODE_REF = "node:installed";
const STREAM_REF = "operator_activity_stream:owned";

const emptyPage = {
  schema: HELIX_OPERATOR_ACTIVITY_PAGE_SCHEMA,
  stream_ref: STREAM_REF,
  profile_ref: PROFILE_ID,
  node_ref: NODE_REF,
  run_id: "run:one",
  provider_thread_ref: "thread:one",
  provider_thread_epoch: "thread_epoch:one",
  events: [],
  next_cursor: null,
  has_more: false,
  complete_for_query: true,
  summary: {
    returned_count: 0,
    first_sequence: null,
    last_sequence: null,
    outcome_counts: {},
  },
  content_role: "operator_activity_page_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
} as const;

const emptyStreams = {
  schema: HELIX_OPERATOR_ACTIVITY_STREAM_LIST_SCHEMA,
  profile_ref: PROFILE_ID,
  streams: [],
  content_role: "operator_activity_stream_list_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
} as const;

const setup = (
  list = vi.fn(async () => emptyPage),
  listStreams = vi.fn(async () => emptyStreams),
) => {
  const app = express();
  app.use("/api/account", createOperatorActivityRouter({
    activityStore: { list, listStreams } as never,
    resolveSession: vi.fn(async () => ({
      session_id: SESSION_ID,
      profile: { profile_id: PROFILE_ID },
    })),
  }));
  return { app, list, listStreams };
};

const path =
  `/api/account/session/operator-activity?stream_ref=${STREAM_REF}` +
  `&node_ref=${NODE_REF}&run_id=run:one` +
  `&provider_thread_ref=thread:one&provider_thread_epoch=thread_epoch:one`;

describe("owner-scoped operator activity route", () => {
  it("requires a signed-in profile and complete query scope", async () => {
    const { app, list } = setup();
    await request(app).get(path).expect(401);
    await request(app)
      .get("/api/account/session/operator-activity?stream_ref=stream:one")
      .set("Cookie", `helix_session=${SESSION_ID}`)
      .expect(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("derives owner and profile identity only from the authenticated session", async () => {
    const { app, list } = setup();
    const response = await request(app)
      .get(path)
      .set("Cookie", `helix_session=${SESSION_ID}`)
      .expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual(emptyPage);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      owner: {
        tenantId: `casimirbot-profile-tenant:${PROFILE_ID}`,
        accountProfileId: PROFILE_ID,
      },
      stream: { streamRef: STREAM_REF, profileRef: PROFILE_ID, nodeRef: NODE_REF },
      runId: "run:one",
      providerThreadRef: "thread:one",
      providerThreadEpoch: "thread_epoch:one",
    }));
  });

  it("accepts only an exact encoded cursor", async () => {
    const cursor = {
      schema: HELIX_OPERATOR_ACTIVITY_CURSOR_SCHEMA,
      stream_ref: STREAM_REF,
      profile_ref: PROFILE_ID,
      node_ref: NODE_REF,
      run_id: "run:one",
      provider_thread_ref: "thread:one",
      provider_thread_epoch: "thread_epoch:one",
      after_sequence: 19,
      projection_version: 1,
    } as const;
    const { app, list } = setup();
    await request(app)
      .get(`${path}&cursor=${encodeURIComponent(encodeHelixOperatorActivityCursor(cursor))}`)
      .set("Cookie", `helix_session=${SESSION_ID}`)
      .expect(200);
    expect(list.mock.calls[0][0].cursor).toEqual(cursor);
    await request(app)
      .get(`${path}&cursor=not-a-cursor`)
      .set("Cookie", `helix_session=${SESSION_ID}`)
      .expect(400);
  });

  it("maps store failures to fixed responses without leaking backend text", async () => {
    const list = vi.fn(async () => {
      throw new HelixOperatorActivityStoreError(
        "activity_stream_owner_mismatch",
        "Bearer private-owner-detail",
      );
    });
    const { app } = setup(list);
    const response = await request(app)
      .get(path)
      .set("Cookie", `helix_session=${SESSION_ID}`)
      .expect(403);
    expect(response.body).toMatchObject({
      schema: "helix.operator_activity_error.v1",
      error: "forbidden",
      credential_included: false,
      hidden_reasoning_included: false,
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("private-owner-detail");
  });

  it("discovers streams from only the authenticated profile", async () => {
    const { app, listStreams } = setup();
    const response = await request(app)
      .get("/api/account/session/operator-activity/streams?limit=25")
      .set("Cookie", `helix_session=${SESSION_ID}`)
      .expect(200);
    expect(response.body).toEqual(emptyStreams);
    expect(listStreams).toHaveBeenCalledWith({
      owner: {
        tenantId: `casimirbot-profile-tenant:${PROFILE_ID}`,
        accountProfileId: PROFILE_ID,
      },
      profileRef: PROFILE_ID,
      limit: 25,
    });
  });
});
