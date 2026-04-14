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

describe("compare-databases tool", () => {
  const auditEntries: AuditEntry[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    auditEntries.length = 0;
    clearLogSinks();
    addLogSink((e) => auditEntries.push(e));
    resetRateLimiter();
  });

  it("compares results across multiple databases", async () => {
    mockQuery.mockResolvedValue({
      recordset: [{ Count: 100 }],
    });

    const { compareDatabasesHandler } = await import(
      "../../src/tools/compare-databases.js"
    );
    const result = await compareDatabasesHandler({
      databases: ["db-dev", "db-prod"],
      query: "SELECT COUNT(*) AS Count FROM Users",
      maxRowsPerDatabase: 20,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.databasesQueried).toBe(2);
    expect(parsed.results["db-dev"]).toBeDefined();
    expect(parsed.results["db-prod"]).toBeDefined();
    expect(parsed.results["db-dev"].rowCount).toBe(1);
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("blocks dangerous queries", async () => {
    const { compareDatabasesHandler } = await import(
      "../../src/tools/compare-databases.js"
    );
    const result = await compareDatabasesHandler({
      databases: ["db-dev", "db-prod"],
      query: "DROP TABLE Users",
      maxRowsPerDatabase: 20,
    });

    expect(result.content[0].text).toContain("BLOCKED");
    expect(auditEntries[0].blocked).toBe(true);
  });

  it("handles per-database errors without failing others", async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [{ x: 1 }] })
      .mockRejectedValueOnce(new Error("Connection refused"));

    const { compareDatabasesHandler } = await import(
      "../../src/tools/compare-databases.js"
    );
    const result = await compareDatabasesHandler({
      databases: ["db-ok", "db-fail"],
      query: "SELECT 1 AS x",
      maxRowsPerDatabase: 20,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results["db-ok"].rowCount).toBe(1);
    expect(parsed.results["db-fail"].error).toContain("Connection refused");
  });

  it("caps rows per database at 100", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ Id: i }));
    mockQuery.mockResolvedValue({ recordset: rows });

    const { compareDatabasesHandler } = await import(
      "../../src/tools/compare-databases.js"
    );
    const result = await compareDatabasesHandler({
      databases: ["db-a", "db-b"],
      query: "SELECT * FROM BigTable",
      maxRowsPerDatabase: 999, // exceeds cap
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results["db-a"].data.length).toBeLessThanOrEqual(100);
  });

  it("enforces rate limiting", async () => {
    configureRateLimiter({ maxRequests: 1, windowMs: 60_000 });

    const { compareDatabasesHandler } = await import(
      "../../src/tools/compare-databases.js"
    );

    mockQuery.mockResolvedValue({ recordset: [] });
    await compareDatabasesHandler({
      databases: ["a", "b"],
      query: "SELECT 1",
      maxRowsPerDatabase: 20,
    });

    const result = await compareDatabasesHandler({
      databases: ["a", "b"],
      query: "SELECT 1",
      maxRowsPerDatabase: 20,
    });

    expect(result.content[0].text).toContain("Rate limit exceeded");
  });
});
