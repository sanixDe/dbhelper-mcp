import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// connection-pool.ts depends on mssql and config — we mock both.

vi.mock("mssql", () => {
  const mockPool = {
    connected: true,
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockReturnValue({
      query: vi.fn().mockResolvedValue({ recordset: [{ result: 1 }] }),
    }),
  };

  const ConnectionPool = vi.fn().mockImplementation(() => mockPool);

  return {
    default: { ConnectionPool },
    ConnectionPool,
  };
});

vi.mock("../src/config.js", () => ({
  DATABASE_REGISTRY: [
    {
      name: "test-db",
      displayName: "Test DB",
      database: "TestDatabase",
      server: "test-server",
      environment: "nonprod" as const,
    },
  ],
  resolveDatabase: vi.fn((name: string) => {
    if (name.toLowerCase().trim() === "test-db") {
      return {
        name: "test-db",
        displayName: "Test DB",
        database: "TestDatabase",
        server: "test-server",
        environment: "nonprod" as const,
      };
    }
    return undefined;
  }),
  buildConnectionConfig: vi.fn(() => ({
    server: "test-server",
    database: "TestDatabase",
    user: "testuser",
    password: "testpass",
    options: { encrypt: true, trustServerCertificate: false },
  })),
}));

describe("connection-pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up pools between tests
    const { closeAllPools } = await import("../src/connection-pool.js");
    await closeAllPools();
  });

  describe("getPool", () => {
    it("throws for unknown database", async () => {
      const { getPool } = await import("../src/connection-pool.js");
      await expect(getPool("unknown-db")).rejects.toThrow(
        'Unknown database: "unknown-db"'
      );
    });

    it("returns a pool for a known database", async () => {
      const { getPool } = await import("../src/connection-pool.js");
      const pool = await getPool("test-db");
      expect(pool).toBeDefined();
      expect(pool.connected).toBe(true);
    });

    it("reuses pool on subsequent calls", async () => {
      const { getPool } = await import("../src/connection-pool.js");
      const pool1 = await getPool("test-db");
      const pool2 = await getPool("test-db");
      expect(pool1).toBe(pool2);
    });
  });

  describe("closeAllPools", () => {
    it("closes all open pools without throwing", async () => {
      const { getPool, closeAllPools } = await import(
        "../src/connection-pool.js"
      );
      await getPool("test-db");
      await expect(closeAllPools()).resolves.toBeUndefined();
    });
  });

  describe("checkConnection", () => {
    it("returns connected: true for reachable database", async () => {
      const { checkConnection } = await import("../src/connection-pool.js");
      const result = await checkConnection("test-db");
      expect(result.connected).toBe(true);
    });

    it("returns connected: false for unknown database", async () => {
      const { checkConnection } = await import("../src/connection-pool.js");
      const result = await checkConnection("nonexistent-db");
      expect(result.connected).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
