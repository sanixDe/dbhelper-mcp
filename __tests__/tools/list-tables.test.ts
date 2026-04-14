import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearLogSinks, addLogSink, type AuditEntry } from "../../src/logger.js";
import { resetRateLimiter } from "../../src/rate-limiter.js";

const mockQuery = vi.fn();
const mockRequest = {
  input: vi.fn(),
  query: mockQuery,
};
// input() returns the request object for chaining
mockRequest.input.mockReturnValue(mockRequest);

vi.mock("../../src/connection-pool.js", () => ({
  getPool: vi.fn().mockResolvedValue({
    request: () => mockRequest,
  }),
}));

describe("list-tables tool", () => {
  const auditEntries: AuditEntry[] = [];

  beforeEach(() => {
    mockQuery.mockReset();
    mockRequest.input.mockReset().mockReturnValue(mockRequest);
    auditEntries.length = 0;
    clearLogSinks();
    addLogSink((e) => auditEntries.push(e));
    resetRateLimiter();
  });

  it("returns all tables when no schema filter", async () => {
    mockQuery.mockResolvedValue({
      recordset: [
        { SchemaName: "dbo", TableName: "Users", ApproxRowCount: 1000 },
        { SchemaName: "dbo", TableName: "Orders", ApproxRowCount: 5000 },
        { SchemaName: "audit", TableName: "Logs", ApproxRowCount: 50000 },
      ],
    });

    const { listTablesHandler } = await import(
      "../../src/tools/list-tables.js"
    );
    const result = await listTablesHandler({ database: "test-db" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tableCount).toBe(3);
    expect(parsed.tables).toHaveLength(3);
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("uses parameterized query when schema is provided", async () => {
    mockQuery.mockResolvedValue({
      recordset: [
        { SchemaName: "dbo", TableName: "Users", ApproxRowCount: 1000 },
      ],
    });

    const { listTablesHandler } = await import(
      "../../src/tools/list-tables.js"
    );
    await listTablesHandler({ database: "test-db", schema: "dbo" });

    expect(mockRequest.input).toHaveBeenCalledWith("schema", expect.anything(), "dbo");
  });

  it("handles errors gracefully", async () => {
    mockQuery.mockRejectedValue(new Error("Connection refused"));

    const { listTablesHandler } = await import(
      "../../src/tools/list-tables.js"
    );
    const result = await listTablesHandler({ database: "test-db" });

    expect(result.content[0].text).toContain("Error: Connection refused");
    expect(auditEntries[0].error).toContain("Connection refused");
  });

  it("logs audit entry", async () => {
    mockQuery.mockResolvedValue({ recordset: [] });

    const { listTablesHandler } = await import(
      "../../src/tools/list-tables.js"
    );
    await listTablesHandler({ database: "test-db" });

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].tool).toBe("list_tables");
  });
});
