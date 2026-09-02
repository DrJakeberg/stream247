import { describe, expect, it, vi } from "vitest";
import { AlertDeduper, deliverAlert } from "../../apps/worker/src/alerts";

/**
 * Findings [12] and [9] of the codebase review. Alert delivery threw its results away: Discord's
 * response status was never read, the email rejection vanished in allSettled, and "nothing
 * configured" returned silently — so an operator with a deleted webhook believed alerts were on
 * for hours. And nothing deduplicated: a persistent reconcile failure sent the same Discord post
 * and email every 30 s. Delivery now reports per channel, and one key is sent once per interval.
 */
const smtpOff = { host: "", port: 0, user: "", password: "", from: "", to: "" };
const smtpOn = { host: "mail.example", port: 587, user: "u", password: "p", from: "a@example", to: "b@example" };

describe("deliverAlert", () => {
  it("reports a Discord webhook that answers 404 as failed, with the status", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    const report = await deliverAlert({ subject: "s", message: "m", discordWebhookUrl: "https://discord.com/api/webhooks/1/abc", smtp: smtpOff, fetchImpl, createTransport: () => ({ sendMail: async () => undefined }) });
    expect(report.discord).toEqual({ outcome: "failed", detail: "HTTP 404" });
    expect(report.email).toEqual({ outcome: "unconfigured" });
    expect(report.delivered).toBe(false);
  });
  it("reports both channels unconfigured when neither is set up", async () => {
    const report = await deliverAlert({ subject: "s", message: "m", discordWebhookUrl: "", smtp: smtpOff, fetchImpl: vi.fn() as unknown as typeof fetch, createTransport: () => ({ sendMail: async () => undefined }) });
    expect(report).toEqual({ discord: { outcome: "unconfigured" }, email: { outcome: "unconfigured" }, delivered: false });
  });
  it("reports a rejected email as failed and a 2xx webhook as sent", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 })) as unknown as typeof fetch;
    const report = await deliverAlert({ subject: "s", message: "m", discordWebhookUrl: "https://discord.com/api/webhooks/1/abc", smtp: smtpOn, fetchImpl, createTransport: () => ({ sendMail: async () => { throw new Error("535 Authentication failed"); } }) });
    expect(report.discord).toEqual({ outcome: "sent" });
    expect(report.email).toEqual({ outcome: "failed", detail: "535 Authentication failed" });
    expect(report.delivered).toBe(true);
  });
  it("reports a thrown fetch as failed instead of swallowing it", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND discord.com"); }) as unknown as typeof fetch;
    const report = await deliverAlert({ subject: "s", message: "m", discordWebhookUrl: "https://discord.com/api/webhooks/1/abc", smtp: smtpOff, fetchImpl, createTransport: () => ({ sendMail: async () => undefined }) });
    expect(report.discord).toEqual({ outcome: "failed", detail: "getaddrinfo ENOTFOUND discord.com" });
  });
});

describe("AlertDeduper", () => {
  it("sends a key once per interval, then again after it", () => {
    const d = new AlertDeduper(30 * 60_000);
    expect(d.shouldSend("twitch:chat 403", 1_000)).toBe(true);
    expect(d.shouldSend("twitch:chat 403", 1_000 + 30_000)).toBe(false);
    expect(d.shouldSend("twitch:chat 403", 1_000 + 29 * 60_000)).toBe(false);
    expect(d.shouldSend("twitch:chat 403", 1_000 + 30 * 60_000 + 1)).toBe(true);
  });
  it("treats different keys independently and forgets a key when asked", () => {
    const d = new AlertDeduper(30 * 60_000);
    expect(d.shouldSend("a", 0)).toBe(true);
    expect(d.shouldSend("b", 0)).toBe(true);
    d.forget("a");
    expect(d.shouldSend("a", 1)).toBe(true);
    expect(d.shouldSend("b", 1)).toBe(false);
  });
});
