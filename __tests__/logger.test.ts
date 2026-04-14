import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  logAudit,
  addLogSink,
  clearLogSinks,
  startTimer,
  type AuditEntry,
} from "../src/logger.js";

describe("logger", () => {
  beforeEach(() => {
    clearLogSinks();
  });

  describe("logAudit", () => {
    it("calls all registered sinks with the entry", () => {
      const sink1 = vi.fn();
      const sink2 = vi.fn();
      addLogSink(sink1);
      addLogSink(sink2);

      const entry: AuditEntry = {
        timestamp: "2025-01-01T00:00:00.000Z",
        tool: "run_query",
        database: "test-db",
        query: "SELECT 1",
        durationMs: 42,
        rowCount: 1,
      };

      logAudit(entry);

      expect(sink1).toHaveBeenCalledWith(entry);
      expect(sink2).toHaveBeenCalledWith(entry);
    });

    it("does not throw if a sink throws", () => {
      const badSink = vi.fn(() => {
        throw new Error("sink failed");
      });
      const goodSink = vi.fn();
      addLogSink(badSink);
      addLogSink(goodSink);

      const entry: AuditEntry = {
        timestamp: "2025-01-01T00:00:00.000Z",
        tool: "list_tables",
        database: "test-db",
        durationMs: 10,
      };

      expect(() => logAudit(entry)).not.toThrow();
      expect(goodSink).toHaveBeenCalledWith(entry);
    });

    it("logs blocked queries", () => {
      const sink = vi.fn();
      addLogSink(sink);

      logAudit({
        timestamp: "2025-01-01T00:00:00.000Z",
        tool: "run_query",
        database: "test-db",
        query: "DELETE FROM Users",
        durationMs: 1,
        blocked: true,
        blockedReason: "Blocked keyword: DELETE",
      });

      expect(sink).toHaveBeenCalledTimes(1);
      const logged = sink.mock.calls[0][0] as AuditEntry;
      expect(logged.blocked).toBe(true);
      expect(logged.blockedReason).toContain("DELETE");
    });

    it("logs errors", () => {
      const sink = vi.fn();
      addLogSink(sink);

      logAudit({
        timestamp: "2025-01-01T00:00:00.000Z",
        tool: "run_query",
        database: "test-db",
        query: "SELECT 1",
        durationMs: 500,
        error: "Connection timeout",
      });

      const logged = sink.mock.calls[0][0] as AuditEntry;
      expect(logged.error).toBe("Connection timeout");
    });
  });

  describe("clearLogSinks", () => {
    it("removes all sinks", () => {
      const sink = vi.fn();
      addLogSink(sink);
      clearLogSinks();

      logAudit({
        timestamp: "2025-01-01T00:00:00.000Z",
        tool: "test",
        database: "test",
        durationMs: 0,
      });

      expect(sink).not.toHaveBeenCalled();
    });
  });

  describe("startTimer", () => {
    it("returns elapsed milliseconds", async () => {
      const elapsed = startTimer();
      // Small delay to ensure measurable time
      await new Promise((r) => setTimeout(r, 10));
      const ms = elapsed();
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(typeof ms).toBe("number");
    });

    it("returns increasing values on subsequent calls", async () => {
      const elapsed = startTimer();
      await new Promise((r) => setTimeout(r, 5));
      const first = elapsed();
      await new Promise((r) => setTimeout(r, 5));
      const second = elapsed();
      expect(second).toBeGreaterThanOrEqual(first);
    });
  });
});
