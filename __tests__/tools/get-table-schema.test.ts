import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearLogSinks, addLogSink, type AuditEntry } from "../../src/logger.js";
import { resetRateLimiter } from "../../src/rate-limiter.js";

const mockQuery = vi.fn();
const mockRequest = {
  input: vi.fn(),
  query: mockQuery,
};
mockRequest.input.mockReturnValue(mockRequest);

vi.mock("../../src/connection-pool.js", () => ({
  getPool: vi.fn().mockResolvedValue({
    request: () => mockRequest,
  }),
}));

describe("get-table-schema tool", () => {
  const auditEntries: AuditEntry[] = [];

  beforeEach(() => {
    mockQuery.mockReset();
    mockRequest.input.mockReset().mockReturnValue(mockRequest);
    auditEntries.length = 0;
    clearLogSinks();
    addLogSink((e) => auditEntries.push(e));
    resetRateLimiter();
  });

  it("returns column definitions for an existing table", async () => {
    mockQuery.mockResolvedValue({
      recordset: [
        {
          COLUMN_NAME: "Id",
          DATA_TYPE: "int",
          IS_NULLABLE: "NO",
          IS_PRIMARY_KEY: "YES",
          REFERENCED_TABLE_NAME: null,
          REFERENCED_COLUMN_NAME: null,
        },
        {
          COLUMN_NAME: "Name",
          DATA_TYPE: "nvarchar",
          CHARACTER_MAXIMUM_LENGTH: 100,
          IS_NULLABLE: "YES",
          IS_PRIMARY_KEY: "NO",
          REFERENCED_TABLE_NAME: null,
          REFERENCED_COLUMN_NAME: null,
        },
      ],
    });

    const { getTableSchemaHandler } = await import(
      "../../src/tools/get-table-schema.js"
    );
    const result = await getTableSchemaHandler({
      database: "test-db",
      table: "Users",
      schema: "dbo",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.table).toBe("dbo.Users");
    expect(parsed.columnCount).toBe(2);
    expect(parsed.columns[0].COLUMN_NAME).toBe("Id");
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns not-found message for missing table", async () => {
    mockQuery.mockResolvedValue({ recordset: [] });

    const { getTableSchemaHandler } = await import(
      "../../src/tools/get-table-schema.js"
    );
    const result = await getTableSchemaHandler({
      database: "test-db",
      table: "NonExistent",
      schema: "dbo",
    });

    expect(result.content[0].text).toContain("not found");
    expect(result.content[0].text).toContain("NonExistent");
  });

  it("uses parameterized queries", async () => {
    mockQuery.mockResolvedValue({ recordset: [] });

    const { getTableSchemaHandler } = await import(
      "../../src/tools/get-table-schema.js"
    );
    await getTableSchemaHandler({
      database: "test-db",
      table: "Users",
      schema: "dbo",
    });

    expect(mockRequest.input).toHaveBeenCalledWith("table", expect.anything(), "Users");
    expect(mockRequest.input).toHaveBeenCalledWith("schema", expect.anything(), "dbo");
  });

  it("handles errors gracefully", async () => {
    mockQuery.mockRejectedValue(new Error("Permission denied"));

    const { getTableSchemaHandler } = await import(
      "../../src/tools/get-table-schema.js"
    );
    const result = await getTableSchemaHandler({
      database: "test-db",
      table: "Users",
      schema: "dbo",
    });

    expect(result.content[0].text).toContain("Error: Permission denied");
  });
});
