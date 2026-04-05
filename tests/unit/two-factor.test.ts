import { describe, expect, it } from "vitest";
import { buildTwoFactorOtpAuthUri, generateTotpCode, generateTwoFactorSecret, verifyTotpCode } from "../../apps/web/lib/server/two-factor";

describe("two-factor helpers", () => {
  it("generates a stable 6-digit TOTP code for a given timestamp", () => {
    const code = generateTotpCode("JBSWY3DPEHPK3PXP", Date.UTC(2026, 3, 5, 12, 0, 0));
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode("JBSWY3DPEHPK3PXP", code, Date.UTC(2026, 3, 5, 12, 0, 0))).toBe(true);
  });

  it("builds an otpauth URI with issuer and account name", () => {
    expect(
      buildTwoFactorOtpAuthUri({
        issuer: "Stream247",
        accountName: "owner@example.com",
        secret: "JBSWY3DPEHPK3PXP"
      })
    ).toContain("otpauth://totp/Stream247:owner%40example.com");
  });

  it("creates non-empty base32 secrets", () => {
    expect(generateTwoFactorSecret()).toMatch(/^[A-Z2-7]+$/);
  });
});
