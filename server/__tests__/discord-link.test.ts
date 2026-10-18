import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { discordLinkRouter } from "../routes/discord-link";

describe("Discord account link page", () => {
  const app = express().use(discordLinkRouter);

  it("renders an issued link-code shape", async () => {
    const response = await request(app).get("/link-discord?code=abCD2345").expect(200);
    expect(response.text).toContain("Code: <code>ABCD2345</code>");
    expect(response.text).toContain('const code = "ABCD2345";');
  });

  it("rejects script markup in the link-code query", async () => {
    const response = await request(app)
      .get("/link-discord")
      .query({ code: '</script><script>alert(1)</script>' })
      .expect(400);
    expect(response.text).not.toContain("alert(1)");
    expect(response.text).toContain('const code = "";');
  });
});
