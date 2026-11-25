import { createServer, type AddressInfo, type Socket } from "node:net";
import nodemailer from "../../apps/worker/node_modules/nodemailer";
import { describe, expect, it } from "vitest";
import { smtpTransportOptions } from "../../apps/worker/src/alerts";

// M127, audit finding 18: alert mail used implicit TLS on port 465 and only opportunistic STARTTLS on every
// other port, so a server without STARTTLS, or a path that strips it, received the SMTP login and the alert
// in plain text. Every port now requires TLS before anything is sent.

const smtp = { host: "mail.example", port: 587, user: "alerts", password: "not-a-real-password", from: "a@example", to: "b@example" };

describe("alert mail transport options (M127, finding 18)", () => {
  it("uses implicit TLS on port 465", () => {
    expect(smtpTransportOptions({ ...smtp, port: 465 })).toMatchObject({ host: "mail.example", port: 465, secure: true });
  });

  it("requires STARTTLS on every other port", () => {
    for (const port of [25, 587, 2525]) {
      expect(smtpTransportOptions({ ...smtp, port })).toMatchObject({ port, secure: false, requireTLS: true });
    }
  });

  it("logs in only with a user, as before", () => {
    expect(smtpTransportOptions(smtp).auth).toEqual({ user: "alerts", pass: "not-a-real-password" });
    expect(smtpTransportOptions({ ...smtp, user: "" }).auth).toBeUndefined();
  });

  it("fails against a server without STARTTLS before it sends the login or the alert", async () => {
    // A loopback server that offers AUTH but no STARTTLS, as a stripped or plain-text relay does.
    const received: string[] = [];
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
      socket.setEncoding("utf8");
      socket.write("220 fixture ESMTP\r\n");
      socket.on("data", (chunk: string) => {
        for (const line of chunk.split("\r\n").filter(Boolean)) {
          received.push(line);
          const command = line.slice(0, 4).toUpperCase();
          if (command === "EHLO") {
            socket.write("250-fixture\r\n250 AUTH PLAIN LOGIN\r\n");
          } else if (command === "QUIT") {
            socket.end("221 bye\r\n");
          } else {
            socket.write("250 ok\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const transport = nodemailer.createTransport({ ...smtpTransportOptions({ ...smtp, host: "127.0.0.1", port }), connectionTimeout: 5000 });
      await expect(transport.sendMail({ from: smtp.from, to: smtp.to, subject: "s", text: "alert text" })).rejects.toThrow();
      expect(received.some((line) => line.toUpperCase().startsWith("AUTH"))).toBe(false);
      expect(received.some((line) => line.toUpperCase().startsWith("DATA"))).toBe(false);
    } finally {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
