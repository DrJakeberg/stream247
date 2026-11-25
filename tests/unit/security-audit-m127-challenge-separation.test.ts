import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { resolveAppSecret } from "@stream247/db";

// M127, audit finding 15: in 2.3.1 the second-factor challenge, which the sign-in returns after the password
// alone, had the construction and key of the session cookie, so it worked as an owner session. 2.4 refused it
// only by the part count of the M117 session. The challenge now has its own key and a shape 2.3.1 refuses.

vi.mock("../../apps/web/node_modules/next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { buildSessionValue, buildTwoFactorChallengeValue, parseSessionValue, parseTwoFactorChallengeValue } from "../../apps/web/lib/server/auth";

function signWithAppSecret(value: string): string {
  return createHmac("sha256", resolveAppSecret()).update(value).digest("hex");
}

/**
 * The session parsing rule of v2.3.1, copied from parseSessionValue in apps/web/lib/server/auth.ts at the
 * tag v2.3.1 (`git show v2.3.1:apps/web/lib/server/auth.ts`), with its 30-day default lifetime: at least three
 * parts, the last one the HMAC of the rest under the app secret, the part before it an issue time inside
 * the lifetime. It returns the user id a 2.3.1 image would sign in, or null.
 */
function parseSessionValueV231(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const parts = value.split(":");
  if (parts.length < 3) {
    return null;
  }
  const signature = parts.pop();
  const payload = parts.join(":");
  if (!signature || signWithAppSecret(payload) !== signature) {
    return null;
  }
  const issuedAt = Number(parts[parts.length - 1]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 60 * 60 * 24 * 30 * 1000) {
    return null;
  }
  return parts[0] ?? null;
}

describe("the second-factor challenge and the session are separate tokens (M127, finding 15)", () => {
  it("still round-trips a challenge through the challenge check", () => {
    expect(parseTwoFactorChallengeValue(buildTwoFactorChallengeValue("user_owner"))?.userId).toBe("user_owner");
  });

  it("refuses a challenge as a session, today", () => {
    expect(parseSessionValue(buildTwoFactorChallengeValue("user_owner"))).toBeNull();
  });

  it("refuses a challenge as a session under the 2.3.1 parsing rule, so a reverse repin finds none it accepts", () => {
    // The rule itself accepts what 2.3.1 signed as a session, so the copy is faithful.
    const v231Session = `user_owner:${Date.now()}`;
    expect(parseSessionValueV231(`${v231Session}:${signWithAppSecret(v231Session)}`)).toBe("user_owner");
    expect(parseSessionValueV231(buildTwoFactorChallengeValue("user_owner"))).toBeNull();
  });

  it("refuses a session as a challenge, even one whose password stamp reads as a number", () => {
    expect(parseTwoFactorChallengeValue(buildSessionValue("user_owner", "hash"))).toBeNull();
    // A session is userId:issuedAt:stamp:signature. Read as an old challenge, the stamp stood where the issue
    // time is; a stamp of digits only made the session pass as a challenge.
    let numeric: string | undefined;
    for (let attempt = 0; attempt < 200_000 && !numeric; attempt += 1) {
      const session = buildSessionValue("user_owner", `hash-${attempt}`);
      if (/^\d+$/.test(session.split(":")[2] ?? "")) {
        numeric = session;
      }
    }
    expect(numeric).toBeDefined();
    expect(parseTwoFactorChallengeValue(numeric)).toBeNull();
  });

  it("refuses a challenge in the format before this change, which a pending sign-in simply repeats", () => {
    const payload = `user_owner:${Date.now()}`;
    expect(parseTwoFactorChallengeValue(`${payload}:${signWithAppSecret(payload)}`)).toBeNull();
  });
});
