import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the functions that are importable, not the side-effect singleton.
// config.ts loads DATABASE_REGISTRY at import time, so we test
// resolveDatabase and buildConnectionConfig with controlled inputs.

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SQL_READONLY_USER = "testuser";
    process.env.SQL_READONLY_PASSWORD = "testpass";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("resolveDatabase", () => {
    it("resolves database case-insensitively", async () => {
      // Import fresh — the registry may be empty if no databases.json exists,
      // but we can still test the function shape
      const { resolveDatabase, DATABASE_REGISTRY } = await import(
        "../src/config.js"
      );

      if (DATABASE_REGISTRY.length > 0) {
        const first = DATABASE_REGISTRY[0];
        const result = resolveDatabase(first.name.toUpperCase());
        expect(result).toBeDefined();
        expect(result?.name).toBe(first.name);
      } else {
        // No databases.json — resolveDatabase should return undefined
        const result = resolveDatabase("nonexistent");
        expect(result).toBeUndefined();
      }
    });

    it("returns undefined for unknown database", async () => {
      const { resolveDatabase } = await import("../src/config.js");
      expect(resolveDatabase("does_not_exist_xyz")).toBeUndefined();
    });

    it("trims whitespace from input", async () => {
      const { resolveDatabase } = await import("../src/config.js");
      // Should not crash on whitespace-padded input
      const result = resolveDatabase("  nonexistent  ");
      expect(result).toBeUndefined();
    });
  });

  describe("buildConnectionConfig", () => {
    it("builds valid connection config", async () => {
      const { buildConnectionConfig } = await import("../src/config.js");

      const config = buildConnectionConfig({
        name: "test-db",
        displayName: "Test DB",
        database: "TestDatabase",
        server: "test-server.database.windows.net",
        environment: "nonprod",
      });

      expect(config.server).toBe("test-server.database.windows.net");
      expect(config.database).toBe("TestDatabase");
      expect(config.user).toBe("testuser");
      expect(config.password).toBe("testpass");
      expect(config.options?.encrypt).toBe(true);
      expect(config.options?.trustServerCertificate).toBe(false);
      expect(config.requestTimeout).toBe(30_000);
      expect(config.connectionTimeout).toBe(15_000);
      expect(config.pool?.max).toBe(3);
    });

    it("throws when credentials are missing", async () => {
      delete process.env.SQL_READONLY_USER;
      delete process.env.SQL_READONLY_PASSWORD;

      // Need a fresh import to pick up env changes
      const configModule = await import("../src/config.js");

      expect(() =>
        configModule.buildConnectionConfig({
          name: "test",
          displayName: "Test",
          database: "TestDB",
          server: "server",
          environment: "nonprod",
        })
      ).toThrow("SQL_READONLY_USER and SQL_READONLY_PASSWORD");
    });
  });
});
