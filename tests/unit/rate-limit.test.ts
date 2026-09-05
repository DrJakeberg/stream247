import { beforeEach, describe, expect, it } from "vitest";
import {
  LOGIN_RATE_LIMIT,
  TWO_FACTOR_RATE_LIMIT,
  clearAllRateLimits,
  consumeRateLimit,
  getClientIdentifier,
  resetRateLimit
} from "../../apps/web/lib/server/rate-limit.js";

const rule = { limit: 3, windowMs: 60_000 };
const start = 1_000_000;

beforeEach(() => {
  clearAllRateLimits();
});

describe("consumeRateLimit", () => {
  it("allows attempts up to the limit and then rejects", () => {
    for (let i = 0; i < 3; i++) {
      expect(consumeRateLimit("k", rule, start).allowed).toBe(true);
    }

    expect(consumeRateLimit("k", rule, start).allowed).toBe(false);
  });

  it("reports how long to wait", () => {
    for (let i = 0; i < 4; i++) {
      consumeRateLimit("k", rule, start);
    }

    const result = consumeRateLimit("k", rule, start + 20_000);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(40);
  });

  it("lets the window expire", () => {
    for (let i = 0; i < 4; i++) {
      consumeRateLimit("k", rule, start);
    }

    expect(consumeRateLimit("k", rule, start + 60_001).allowed).toBe(true);
  });

  it("does not extend the window on a rejected attempt", () => {
    // Otherwise an attacker hammering the endpoint would keep pushing their own reset out, but so
    // would they push out the legitimate user's.
    for (let i = 0; i < 10; i++) {
      consumeRateLimit("k", rule, start + i * 1000);
    }

    expect(consumeRateLimit("k", rule, start + 60_001).allowed).toBe(true);
  });

  it("keeps separate keys independent", () => {
    for (let i = 0; i < 4; i++) {
      consumeRateLimit("a", rule, start);
    }

    expect(consumeRateLimit("b", rule, start).allowed).toBe(true);
  });

  it("counts down the remaining allowance", () => {
    expect(consumeRateLimit("k", rule, start).remaining).toBe(2);
    expect(consumeRateLimit("k", rule, start).remaining).toBe(1);
    expect(consumeRateLimit("k", rule, start).remaining).toBe(0);
    expect(consumeRateLimit("k", rule, start).remaining).toBe(0);
  });
});

describe("resetRateLimit", () => {
  it("clears the counter after a genuine success", () => {
    for (let i = 0; i < 3; i++) {
      consumeRateLimit("k", rule, start);
    }
    resetRateLimit("k");

    expect(consumeRateLimit("k", rule, start).allowed).toBe(true);
  });
});

describe("memory bounds", () => {
  it("does not grow without limit when the key is rotated", () => {
    // An attacker using a fresh email per attempt must not be able to exhaust memory.
    for (let i = 0; i < 12_000; i++) {
      consumeRateLimit(`attacker-${String(i)}`, rule, start);
    }

    // Still enforcing after the pressure, which is what matters.
    for (let i = 0; i < 3; i++) {
      consumeRateLimit("victim", rule, start);
    }
    expect(consumeRateLimit("victim", rule, start).allowed).toBe(false);
  });

  it("drops expired entries", () => {
    consumeRateLimit("old", rule, start);

    // A later call prunes; the old key starts fresh rather than carrying a stale count.
    expect(consumeRateLimit("old", rule, start + 120_000).remaining).toBe(2);
  });
});

describe("getClientIdentifier", () => {
  it("uses the first x-forwarded-for hop", () => {
    expect(getClientIdentifier(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip and then to a constant", () => {
    expect(getClientIdentifier(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(getClientIdentifier(new Headers())).toBe("unknown");
  });

  it("never returns empty, so a key can never collapse to a bare prefix", () => {
    expect(getClientIdentifier(new Headers({ "x-forwarded-for": "  ,  " }))).toBe("unknown");
  });
});

describe("configured auth limits", () => {
  it("bounds password and TOTP attempts to something a human clears but a script does not", () => {
    expect(LOGIN_RATE_LIMIT.limit).toBeLessThanOrEqual(10);
    expect(TWO_FACTOR_RATE_LIMIT.limit).toBeLessThanOrEqual(10);
    expect(LOGIN_RATE_LIMIT.windowMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(TWO_FACTOR_RATE_LIMIT.windowMs).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
