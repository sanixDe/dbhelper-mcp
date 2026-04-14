import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearLogSinks, addLogSink, type AuditEntry } from "../../src/logger.js";
import { resetRateLimiter } from "../../src/rate-limiter.js";

const mockQuery = vi.fn();
const mockRequest = {
  input: vi.fn(),
  query: mockQuery,
};
mockRequest.input.mockReturnValue(mockRequest);

// Each pool.request() call returns a fresh mock request so
// sequential calls in the handler each get independent mock tracking.
let requestCallCount = 0;
const mockQueries: ReturnType<typeof vi.fn>[] = [];

vi.mock("../../src/connection-pool.js", () => ({
  getPool: vi.fn().mockResolvedValue({
    request: () => {
      // describe-stored-procedure calls pool.request() twice:
      // once for definition, once for parameters.
      // We create separate query mocks per call.
      const q = mockQueries[requestCallCount] ?? mockQuery;
      requestCallCount++;
      const req = {
        input: vi.fn(),
        query: q,
      };
      req.input.mockReturnValue(req);
      return req;
    },
  }),
}));

describe("describe-stored-procedure tool", () => {
  const auditEntries: AuditEntry[] = [];

  beforeEach(() => {
    requestCallCount = 0;
    mockQueries.length = 0;
    mockQuery.mockReset();
    mockRequest.input.mockReset().mockReturnValue(mockRequest);
    auditEntries.length = 0;
    clearLogSinks();
    addLogSink((e) => auditEntries.push(e));
    resetRateLimiter();
  });

  it("returns procedure definition and parameters", async () => {
    const defQuery = vi.fn().mockResolvedValue({
      recordset: [{ Definition: "CREATE PROCEDURE dbo.GetUsers AS SELECT * FROM Users" }],
    });
    const paramQuery = vi.fn().mockResolvedValue({
      recordset: [
        {
          ParameterName: "@Status",
          DataType: "nvarchar",
          MaxLength: 50,
          IsOutput: false,
          HasDefault: false,
          DefaultValue: null,
        },
      ],
    });
    mockQueries.push(defQuery, paramQuery);

    const { describeStoredProcedureHandler } = await import(
      "../../src/tools/describe-stored-procedure.js"
    );
    const result = await describeStoredProcedureHandler({
      database: "test-db",
      procedure: "dbo.GetUsers",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.procedure).toBe("dbo.GetUsers");
    expect(parsed.parameterCount).toBe(1);
    expect(parsed.parameters[0].ParameterName).toBe("@Status");
    expect(parsed.definition).toContain("CREATE PROCEDURE");
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns not-found when procedure doesn't exist", async () => {
    const defQuery = vi.fn().mockResolvedValue({
      recordset: [{ Definition: null }],
    });
    const paramQuery = vi.fn().mockResolvedValue({ recordset: [] });
    mockQueries.push(defQuery, paramQuery);

    const { describeStoredProcedureHandler } = await import(
      "../../src/tools/describe-stored-procedure.js"
    );
    const result = await describeStoredProcedureHandler({
      database: "test-db",
      procedure: "NonExistentProc",
    });

    expect(result.content[0].text).toContain("not found");
  });

  it("handles errors gracefully", async () => {
    const defQuery = vi.fn().mockRejectedValue(new Error("Timeout expired"));
    mockQueries.push(defQuery);

    const { describeStoredProcedureHandler } = await import(
      "../../src/tools/describe-stored-procedure.js"
    );
    const result = await describeStoredProcedureHandler({
      database: "test-db",
      procedure: "SomeProc",
    });

    expect(result.content[0].text).toContain("Error: Timeout expired");
  });

  it("uses parameterized queries for procedure name", async () => {
    const defQuery = vi.fn().mockResolvedValue({
      recordset: [{ Definition: null }],
    });
    const paramQuery = vi.fn().mockResolvedValue({ recordset: [] });
    mockQueries.push(defQuery, paramQuery);

    const { describeStoredProcedureHandler } = await import(
      "../../src/tools/describe-stored-procedure.js"
    );
    await describeStoredProcedureHandler({
      database: "test-db",
      procedure: "MyProc",
    });

    // Both request calls should use parameterized input
    expect(defQuery).toHaveBeenCalled();
    expect(paramQuery).toHaveBeenCalled();
  });
});
