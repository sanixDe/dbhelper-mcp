import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearLogSinks, addLogSink, type AuditEntry } from "../../src/logger.js";
import { resetRateLimiter, configureRateLimiter } from "../../src/rate-limiter.js";

const mockQuery = vi.fn();

vi.mock("../../src/connection-pool.js", () => ({
  getPool: vi.fn().mockResolvedValue({
    request: () => ({
      query: mockQuery,
    }),
  }),
}));

describe("run-query tool", () => {
  const auditEntries: AuditEntry[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    auditEntries.length = 0;
    clearLogSinks();
    addLogSink((e) => auditEntries.push(e));
    resetRateLimiter();
  });

  it("executes a valid query and returns results", async () => {
    mockQuery.mockResolvedValue({
      recordset: [
        { Id: 1, Name: "Alice" },
        { Id: 2, Name: "Bob" },
      ],
    });

    const { runQueryHandler } = await import("../../src/tools/run-query.js");
    const result = await runQueryHandler({
      database: "test-db",
      query: "SELECT * FROM Users",
      maxRows: 100,
      offset: 0,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalRows).toBe(2);
    expect(parsed.returnedRows).toBe(2);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("blocks dangerous queries", async () => {
    const { runQueryHandler } = await import("../../src/tools/run-query.js");
    const result = await runQueryHandler({
      database: "test-db",
      query: "DELETE FROM Users",
      maxRows: 100,
      offset: 0,
    });

    expect(result.content[0].text).toContain("BLOCKED");
    expect(auditEntries[0].blocked).toBe(true);
  });

  it("supports pagination with offset", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ Id: i + 1 }));
    mockQuery.mockResolvedValue({ recordset: rows });

    const { runQueryHandler } = await import("../../src/tools/run-query.js");
    const result = await runQueryHandler({
      database: "test-db",
      query: "SELECT * FROM Items",
      maxRows: 3,
      offset: 5,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.returnedRows).toBe(3);
    expect(parsed.offset).toBe(5);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextOffset).toBe(8);
    expect(parsed.data[0].Id).toBe(6); // offset=5, so starts at index 5
  });

  it("respects maxRows cap at 500", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ Id: i }));
    mockQuery.mockResolvedValue({ recordset: rows });

    const { runQueryHandler } = await import("../../src/tools/run-query.js");
    const result = await runQueryHandler({
      database: "test-db",
      query: "SELECT * FROM BigTable",
      maxRows: 999, // exceeds cap
      offset: 0,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.returnedRows).toBe(500);
    expect(parsed.hasMore).toBe(true);
  });

  it("handles SQL errors gracefully", async () => {
    mockQuery.mockRejectedValue(new Error("Invalid column name 'Foo'"));

    const { runQueryHandler } = await import("../../src/tools/run-query.js");
    const result = await runQueryHandler({
      database: "test-db",
      query: "SELECT Foo FROM Users",
      maxRows: 100,
      offset: 0,
    });

    expect(result.content[0].text).toContain("SQL Error");
    expect(result.content[0].text).toContain("Invalid column name");
    expect(auditEntries[0].error).toContain("Invalid column name");
  });

  it("enforces rate limiting", async () => {
    configureRateLimiter({ maxRequests: 1, windowMs: 60_000 });

    const { runQueryHandler } = await import("../../src/tools/run-query.js");

    // First request goes through
    mockQuery.mockResolvedValue({ recordset: [] });
    await runQueryHandler({
      database: "test-db",
      query: "SELECT 1",
      maxRows: 100,
      offset: 0,
    });

    // Second request should be rate limited
    const result = await runQueryHandler({
      database: "test-db",
      query: "SELECT 1",
      maxRows: 100,
      offset: 0,
    });

    expect(result.content[0].text).toContain("Rate limit exceeded");
  });

  it("logs audit entries for successful queries", async () => {
    mockQuery.mockResolvedValue({ recordset: [{ x: 1 }] });

    const { runQueryHandler } = await import("../../src/tools/run-query.js");
    await runQueryHandler({
      database: "test-db",
      query: "SELECT 1 AS x",
      maxRows: 100,
      offset: 0,
    });

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].tool).toBe("run_query");
    expect(auditEntries[0].rowCount).toBe(1);
    expect(auditEntries[0].blocked).toBeUndefined();
  });
});
