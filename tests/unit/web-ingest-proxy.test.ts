import { describe, it, expect, vi } from "vitest";
import {
  WebIngestProxy,
  E_WEB_INGEST_FORBIDDEN_DOMAIN,
  E_WEB_INGEST_METHOD_NOT_ALLOWED,
  E_WEB_INGEST_PAYLOAD_TOO_LARGE,
  E_WEB_INGEST_RATE_LIMITED,
  E_WEB_INGEST_INVALID_URL,
  extractHtmlSummary,
  stripHtmlTags,
} from "../../daemon/web-ingest";

describe("TASK-L.17a: Daemon Web Ingest Proxy", () => {
  const allowedReferences = [
    "https://api.partner.example.com/v1",
    "https://docs.reference.org/guide",
  ];

  it("fetches allowed domain and returns 200 with html, text, and summary formats", async () => {
    const htmlSample = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>API Documentation</title>
          <meta name="description" content="Reference documentation for partner API" />
        </head>
        <body>
          <h1>Overview</h1>
          <p>Welcome to the partner documentation.</p>
          <h1>Endpoints</h1>
          <p>Details about endpoints.</p>
        </body>
      </html>
    `;

    const mockFetch = vi.fn().mockImplementation(() =>
      new Response(htmlSample, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const proxy = new WebIngestProxy({
      allowedDomains: allowedReferences,
      fetchFn: mockFetch as any,
    });

    // 1. Format: html
    const htmlResult = await proxy.fetch({
      url: "https://docs.reference.org/guide/intro",
      format: "html",
    });
    expect(htmlResult.status).toBe(200);
    expect(htmlResult.format).toBe("html");
    expect(htmlResult.content).toContain("<title>API Documentation</title>");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 2. Format: text
    const textResult = await proxy.fetch({
      url: "https://docs.reference.org/guide/intro",
      format: "text",
    });
    expect(textResult.format).toBe("text");
    expect(textResult.content).not.toContain("<title>");
    expect(textResult.content).toContain("Overview");
    expect(textResult.content).toContain("Welcome to the partner documentation.");

    // 3. Format: summary
    const summaryResult = await proxy.fetch({
      url: "https://docs.reference.org/guide/intro",
      format: "summary",
    });
    expect(summaryResult.format).toBe("summary");
    expect(summaryResult.summary?.title).toBe("API Documentation");
    expect(summaryResult.summary?.description).toBe("Reference documentation for partner API");
    expect(summaryResult.summary?.h1).toEqual(["Overview", "Endpoints"]);
    expect(summaryResult.summary?.snippet).toContain("API Documentation");
  });

  it("blocks requests to domains not in references[] whitelist with 403 E_WEB_INGEST_FORBIDDEN_DOMAIN", async () => {
    const mockFetch = vi.fn();
    const proxy = new WebIngestProxy({
      allowedDomains: allowedReferences,
      fetchFn: mockFetch as any,
    });

    await expect(
      proxy.fetch({ url: "https://malicious.evil.com/leak" }),
    ).rejects.toMatchObject({
      code: E_WEB_INGEST_FORBIDDEN_DOMAIN,
      status: 403,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks non-GET requests with 405 E_WEB_INGEST_METHOD_NOT_ALLOWED", async () => {
    const mockFetch = vi.fn();
    const proxy = new WebIngestProxy({
      allowedDomains: allowedReferences,
      fetchFn: mockFetch as any,
    });

    const disallowedMethods = ["POST", "PUT", "DELETE", "PATCH"];
    for (const method of disallowedMethods) {
      await expect(
        proxy.fetch({
          url: "https://docs.reference.org/guide",
          method,
        }),
      ).rejects.toMatchObject({
        code: E_WEB_INGEST_METHOD_NOT_ALLOWED,
        status: 405,
      });
    }

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("enforces response size caps with 413 E_WEB_INGEST_PAYLOAD_TOO_LARGE", async () => {
    const maxSizeBytes = 1024; // 1KB

    // Case 1: Declared in Content-Length header
    const mockFetchHeader = vi.fn().mockResolvedValue(
      new Response("small body", {
        status: 200,
        headers: { "Content-Length": "2048" },
      }),
    );
    const proxyHeader = new WebIngestProxy({
      allowedDomains: allowedReferences,
      maxSizeBytes,
      fetchFn: mockFetchHeader as any,
    });

    await expect(
      proxyHeader.fetch({ url: "https://docs.reference.org/guide" }),
    ).rejects.toMatchObject({
      code: E_WEB_INGEST_PAYLOAD_TOO_LARGE,
      status: 413,
    });

    // Case 2: Actual body exceeds limit
    const hugeBody = "X".repeat(2048);
    const mockFetchBody = vi.fn().mockResolvedValue(
      new Response(hugeBody, {
        status: 200,
      }),
    );
    const proxyBody = new WebIngestProxy({
      allowedDomains: allowedReferences,
      maxSizeBytes,
      fetchFn: mockFetchBody as any,
    });

    await expect(
      proxyBody.fetch({ url: "https://docs.reference.org/guide" }),
    ).rejects.toMatchObject({
      code: E_WEB_INGEST_PAYLOAD_TOO_LARGE,
      status: 413,
    });
  });

  it("enforces rate limits and limits burst flooding with 429 E_WEB_INGEST_RATE_LIMITED", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      new Response("OK", { status: 200 }),
    );

    const proxy = new WebIngestProxy({
      allowedDomains: allowedReferences,
      rateLimitPerMinute: 5,
      rateBurstLimit: 3,
      fetchFn: mockFetch as any,
    });

    const targetUrl = "https://docs.reference.org/guide";

    // 1. First 3 requests in quick succession succeed (burst limit = 3)
    await proxy.fetch({ url: targetUrl });
    await proxy.fetch({ url: targetUrl });
    await proxy.fetch({ url: targetUrl });

    // 2. 4th rapid request in the same second exceeds burst limit
    await expect(
      proxy.fetch({ url: targetUrl }),
    ).rejects.toMatchObject({
      code: E_WEB_INGEST_RATE_LIMITED,
      status: 429,
    });
  });

  it("blocks non-HTTP protocols with 400 E_WEB_INGEST_INVALID_URL", async () => {
    const proxy = new WebIngestProxy({
      allowedDomains: allowedReferences,
    });

    await expect(
      proxy.fetch({ url: "ftp://docs.reference.org/file" }),
    ).rejects.toMatchObject({
      code: E_WEB_INGEST_INVALID_URL,
      status: 400,
    });

    await expect(
      proxy.fetch({ url: "not-a-valid-url" }),
    ).rejects.toMatchObject({
      code: E_WEB_INGEST_INVALID_URL,
      status: 400,
    });
  });

  it("utility functions handle HTML parsing and tag stripping robustly", () => {
    const raw = "<div><p>Hello &amp; <b>World</b></p><script>alert(1)</script></div>";
    const stripped = stripHtmlTags(raw);
    expect(stripped).toBe("Hello & World");

    const summary = extractHtmlSummary("<html><head><title>Test Title</title></head><body><h1>H1 Heading</h1></body></html>");
    expect(summary.title).toBe("Test Title");
    expect(summary.h1).toEqual(["H1 Heading"]);
  });
});
