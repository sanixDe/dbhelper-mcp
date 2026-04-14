import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearLogSinks, addLogSink, type AuditEntry } from "../../src/logger.js";

vi.mock("../../src/config.js", () => ({
  DATABASE_REGISTRY: [
    {
      name: "app-dev",
      displayName: "App Dev",
      database: "app-dev-db",
      server: "dev-server",
      environment: "nonprod" as const,
    },
    {
      name: "app-prod",
      displayName: "App Prod",
      database: "app-prod-db",
      server: "prod-server",
      environment: "prod" as const,
    },
  ],
}));

describe("list-databases tool", () => {
  const auditEntries: AuditEntry[] = [];

  beforeEach(() => {
    auditEntries.length = 0;
    clearLogSinks();
    addLogSink((e) => auditEntries.push(e));
  });

  it("returns all configured databases", async () => {
    const { listDatabasesHandler } = await import(
      "../../src/tools/list-databases.js"
    );
    const result = await listDatabasesHandler();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalDatabases).toBe(2);
    expect(parsed.prod).toBe(1);
    expect(parsed.nonprod).toBe(1);
    expect(parsed.databases).toHaveLength(2);
    expect(parsed.databases[0].name).toBe("app-dev");
    expect(parsed.databases[1].name).toBe("app-prod");
  });

  it("logs an audit entry", async () => {
    const { listDatabasesHandler } = await import(
      "../../src/tools/list-databases.js"
    );
    await listDatabasesHandler();

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].tool).toBe("list_databases");
    expect(auditEntries[0].database).toBe("*");
    expect(auditEntries[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
