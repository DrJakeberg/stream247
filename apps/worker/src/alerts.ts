// Alert delivery that says what it did.
//
// Findings [12] and [9] of the codebase review: the Discord response status was never read, the
// email rejection vanished in Promise.allSettled, "nothing configured" returned silently, and
// nothing deduplicated — a persistent reconcile failure sent the same post and email every 30 s.
// This module reports per channel and lets the caller decide once per key per interval. The I/O
// is injected so the behaviour is testable without a network.

export type AlertChannelReport = { outcome: "sent" } | { outcome: "unconfigured" } | { outcome: "failed"; detail: string };

export type AlertDeliveryReport = {
  discord: AlertChannelReport;
  email: AlertChannelReport;
  /** At least one channel accepted the alert. */
  delivered: boolean;
};

export type SmtpSettings = { host: string; port: number; user: string; password: string; from: string; to: string };

type Mailer = { sendMail: (mail: { from: string; to: string; subject: string; text: string }) => Promise<unknown> };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function deliverAlert(args: {
  subject: string;
  message: string;
  discordWebhookUrl: string;
  smtp: SmtpSettings;
  fetchImpl: typeof fetch;
  createTransport: (smtp: SmtpSettings) => Mailer;
}): Promise<AlertDeliveryReport> {
  const discord: Promise<AlertChannelReport> = !args.discordWebhookUrl
    ? Promise.resolve({ outcome: "unconfigured" })
    : args
        .fetchImpl(args.discordWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `Stream247: ${args.message}` })
        })
        .then((response): AlertChannelReport => (response.ok ? { outcome: "sent" } : { outcome: "failed", detail: `HTTP ${response.status}` }))
        .catch((error): AlertChannelReport => ({ outcome: "failed", detail: describeError(error) }));

  const { host, port, from, to } = args.smtp;
  const email: Promise<AlertChannelReport> =
    !host || !port || !from || !to
      ? Promise.resolve({ outcome: "unconfigured" })
      : Promise.resolve()
          .then(() => args.createTransport(args.smtp).sendMail({ from, to, subject: args.subject, text: args.message }))
          .then((): AlertChannelReport => ({ outcome: "sent" }))
          .catch((error): AlertChannelReport => ({ outcome: "failed", detail: describeError(error) }));

  const [discordReport, emailReport] = await Promise.all([discord, email]);
  return { discord: discordReport, email: emailReport, delivered: discordReport.outcome === "sent" || emailReport.outcome === "sent" };
}

/** One alert per key per interval. A key is the condition, not the timestamp inside its text. */
export class AlertDeduper {
  private readonly lastSentAt = new Map<string, number>();
  constructor(private readonly intervalMs: number) {}

  shouldSend(key: string, nowMs: number): boolean {
    const last = this.lastSentAt.get(key);
    if (last !== undefined && nowMs - last <= this.intervalMs) {
      return false;
    }
    this.lastSentAt.set(key, nowMs);
    return true;
  }

  forget(key: string): void {
    this.lastSentAt.delete(key);
  }
}
