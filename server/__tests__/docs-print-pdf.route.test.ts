import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  DOCS_PRINT_PDF_SCHEMA,
  type DocsPrintPdfRequest,
} from "@shared/docs-print-pdf";
import { createDocsPrintPdfRouter } from "../routes/docs-print-pdf";
import {
  DocsPrintPdfError,
  type DocsPrintPdfResult,
} from "../services/docs-print-pdf";

const input: DocsPrintPdfRequest = {
  schema: DOCS_PRINT_PDF_SCHEMA,
  title: "Route Fixture",
  source_path: "docs/route-fixture.md",
  source_kind: "canonical_docs",
  source_markdown: "# Route Fixture",
};

const rendered: DocsPrintPdfResult = {
  pdf: Buffer.from("%PDF-route-fixture"),
  filename: "route-fixture-print.pdf",
  sha256: "a".repeat(64),
  source_sha256: "b".repeat(64),
  page_count: 3,
  equation_count: 2,
  table_count: 1,
  diagnostics: {
    headings: 1,
    toc_links: 0,
    tables: 1,
    display_math: 1,
    inline_math: 1,
    katex_errors: 0,
    broken_images: 0,
    overflow_count: 0,
    omitted_remote_images: 0,
  },
};

const createApp = (
  getSession: () => Promise<unknown>,
  render = vi.fn(async () => rendered),
): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/docs", createDocsPrintPdfRouter({
    getSession: getSession as never,
    render,
  }));
  return app;
};

describe("Docs Viewer print PDF route", () => {
  it.each([
    ["signed-out visitor", null],
    ["public user", {
      account_policy: {
        account_type: "user",
        feature_flags: ["docs_viewer_print_pdf_export"],
        locked_features: [],
      },
    }],
    ["developer", {
      account_policy: {
        account_type: "developer",
        feature_flags: ["docs_viewer_print_pdf_export"],
        locked_features: [],
      },
    }],
  ])("returns a validated PDF for %s", async (_label, session) => {
    const render = vi.fn(async () => rendered);
    const response = await request(createApp(async () => session, render))
      .post("/api/docs/print-pdf")
      .send(input)
      .expect(200)
      .expect("Content-Type", /application\/pdf/);

    expect(Buffer.from(response.body).toString()).toBe("%PDF-route-fixture");
    expect(response.headers["x-docs-pdf-schema"]).toBe(DOCS_PRINT_PDF_SCHEMA);
    expect(response.headers["x-docs-pdf-filename"]).toBe(rendered.filename);
    expect(response.headers["x-docs-pdf-sha256"]).toBe(rendered.sha256);
    expect(response.headers["x-docs-pdf-page-count"]).toBe("3");
    expect(response.headers["x-docs-pdf-equation-count"]).toBe("2");
    expect(response.headers["x-docs-pdf-table-count"]).toBe("1");
    expect(response.headers["x-docs-pdf-validation"]).toBe("pass");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(render).toHaveBeenCalledWith(input);
  });

  it("rejects a policy that explicitly disables PDF export", async () => {
    const render = vi.fn(async () => rendered);
    const response = await request(createApp(async () => ({
      account_policy: {
        account_type: "user",
        feature_flags: [],
        locked_features: ["docs_viewer_print_pdf_export"],
      },
    }), render))
      .post("/api/docs/print-pdf")
      .send(input)
      .expect(403);

    expect(response.body.error).toBe("pdf_export_unavailable");
    expect(render).not.toHaveBeenCalled();
  });

  it("returns typed renderer failures without emitting partial PDF bytes", async () => {
    const render = vi.fn(async () => {
      throw new DocsPrintPdfError(
        "render_validation_failed",
        "Fixture overflow.",
        422,
      );
    });
    const response = await request(createApp(async () => ({
      account_policy: {
        account_type: "user",
        feature_flags: ["docs_viewer_print_pdf_export"],
        locked_features: [],
      },
    }), render))
      .post("/api/docs/print-pdf")
      .send(input)
      .expect(422);

    expect(response.body).toEqual({
      ok: false,
      schema: DOCS_PRINT_PDF_SCHEMA,
      error: "render_validation_failed",
      message: "Fixture overflow.",
    });
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });
});
