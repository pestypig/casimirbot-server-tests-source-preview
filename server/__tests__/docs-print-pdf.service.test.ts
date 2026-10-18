import { describe, expect, it } from "vitest";
import { DOCS_PRINT_PDF_SCHEMA, type DocsPrintPdfRequest } from "@shared/docs-print-pdf";
import {
  DocsPrintPdfError,
  buildDocsPrintPdfHtml,
  parseDocsPrintPdfRequest,
  renderDocsPrintPdf,
} from "../services/docs-print-pdf";

const fixture = (): DocsPrintPdfRequest => ({
  schema: DOCS_PRINT_PDF_SCHEMA,
  title: "Docs Viewer PDF Reliability Fixture",
  source_path: "docs/research/docs-print-pdf-fixture.md",
  source_kind: "canonical_docs",
  source_markdown: String.raw`# Docs Viewer PDF Reliability Fixture

## Equations

Inline energy is \(E=mc^2\).

\[
\Gamma_{\mathrm{DP}} = \frac{\Delta E_G}{\hbar}
\]

## Tabular evidence

| Quantity | Value | Unit |
| --- | ---: | --- |
| Energy | 1.25 | J |
| Time | 2.00 | s |

<!-- docs-print-page-break -->

[unsafe](javascript:alert(1))

<script>window.__docs_pdf_injection = true</script>

<!-- helix-doc-equation-action/v1 id=fixture-equation -->

![remote figure](https://example.com/untrusted.png)
`,
});

describe("Docs Viewer print PDF service", () => {
  it("fails closed on malformed request contracts", () => {
    expect(() => parseDocsPrintPdfRequest({
      ...fixture(),
      schema: "docs_print_pdf/0",
    })).toThrowError(DocsPrintPdfError);
    expect(() => parseDocsPrintPdfRequest({
      ...fixture(),
      source_markdown: "",
    })).toThrowError(DocsPrintPdfError);
  });

  it("builds an offline, math-capable, sanitized print document", () => {
    const built = buildDocsPrintPdfHtml(fixture());
    expect(built.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(built.omittedRemoteImages).toBe(1);
    expect(built.html).toContain("class=\"math-inline\"");
    expect(built.html).toContain("class=\"math-display\"");
    expect(built.html).toContain("<table>");
    expect(built.html).toContain('class="docs-print-page-break"');
    expect(built.html).toContain("Image omitted from offline export");
    expect(built.html).not.toContain('href="javascript:');
    expect(built.html).not.toContain("<script>window.__docs_pdf_injection");
    expect(built.html).toContain("&lt;script&gt;");
    expect(built.html).not.toContain("fixture-equation");
    expect(built.html).not.toContain("https://example.com/untrusted.png");
  });

  it("renders and validates a real multi-page PDF", async () => {
    const result = await renderDocsPrintPdf(fixture());
    expect(result.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(result.filename).toBe("docs-viewer-pdf-reliability-fixture-print.pdf");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.page_count).toBeGreaterThanOrEqual(3);
    expect(result.equation_count).toBe(2);
    expect(result.table_count).toBe(1);
    expect(result.diagnostics).toMatchObject({
      katex_errors: 0,
      broken_images: 0,
      overflow_count: 0,
      omitted_remote_images: 1,
    });
  }, 120_000);
});
