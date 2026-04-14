import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkRateLimit,
  configureRateLimiter,
  resetRateLimiter,
} from "../src/rate-limiter.js";

describe("rate-limiter", () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkRateLimit", () => {
    it("allows requests under the limit", () => {
      const result = checkRateLimit();
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59); // 60 max - 1 used
    });

    it("tracks remaining count correctly", () => {
      configureRateLimiter({ maxRequests: 5, windowMs: 60_000 });

      const r1 = checkRateLimit();
      expect(r1.remaining).toBe(4);

      const r2 = checkRateLimit();
      expect(r2.remaining).toBe(3);

      const r3 = checkRateLimit();
      expect(r3.remaining).toBe(2);
    });

    it("blocks when limit is exceeded", () => {
      configureRateLimiter({ maxRequests: 3, windowMs: 60_000 });

      checkRateLimit();
      checkRateLimit();
      checkRateLimit();

      const result = checkRateLimit();
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it("allows requests after window expires", () => {
      configureRateLimiter({ maxRequests: 2, windowMs: 100 });

      // Use up the limit
      checkRateLimit();
      checkRateLimit();

      // Mock time advancing past the window
      const originalNow = Date.now;
      vi.spyOn(Date, "now").mockReturnValue(originalNow() + 200);

      const result = checkRateLimit();
      expect(result.allowed).toBe(true);
    });

    it("returns retryAfterMs when blocked", () => {
      configureRateLimiter({ maxRequests: 1, windowMs: 5000 });

      checkRateLimit(); // uses the 1 allowed

      const result = checkRateLimit();
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs!).toBeGreaterThan(0);
      expect(result.retryAfterMs!).toBeLessThanOrEqual(5000);
    });
  });

  describe("configureRateLimiter", () => {
    it("applies partial config", () => {
      configureRateLimiter({ maxRequests: 2 });

      checkRateLimit();
      checkRateLimit();

      const result = checkRateLimit();
      expect(result.allowed).toBe(false);
    });
  });

  describe("resetRateLimiter", () => {
    it("clears all state", () => {
      configureRateLimiter({ maxRequests: 1, windowMs: 60_000 });

      checkRateLimit();
      expect(checkRateLimit().allowed).toBe(false);

      resetRateLimiter();

      // After reset, should be back to defaults (60 per minute)
      const result = checkRateLimit();
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59);
    });
  });
});
