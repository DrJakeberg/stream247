// Resets the owner password from the host (M91, owner decision 2026-10-01): the documented way back in
// when the password is lost, since there is no e-mail reset.
//
//   docker compose exec worker node apps/worker/dist/reset-owner-password.js
//
// It asks for the new password without echoing it; piped input is read as one line, so the password
// never has to appear on a command line or in the shell history. Two-factor settings stay as they are.
import { appendAuditEvent, hashPassword, MIN_OWNER_PASSWORD_LENGTH, setOwnerPasswordHash } from "@stream247/db";

async function readPipedLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
}

async function readHiddenLine(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    const onData = (input: string) => {
      for (const char of input) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function main(): Promise<number> {
  const interactive = Boolean(process.stdin.isTTY);
  const password = interactive
    ? await readHiddenLine(`New owner password (at least ${MIN_OWNER_PASSWORD_LENGTH} characters): `)
    : await readPipedLine();

  if (password.length < MIN_OWNER_PASSWORD_LENGTH) {
    console.error(`The password needs at least ${MIN_OWNER_PASSWORD_LENGTH} characters. Nothing was changed.`);
    return 2;
  }
  if (interactive) {
    const repeated = await readHiddenLine("Repeat it: ");
    if (repeated !== password) {
      console.error("The two entries differ. Nothing was changed.");
      return 2;
    }
  }

  const email = await setOwnerPasswordHash(hashPassword(password));
  if (!email) {
    console.error("No owner account exists yet. Create it in the setup wizard (/setup). Nothing was changed.");
    return 1;
  }
  await appendAuditEvent("auth.password.reset", `Owner password for ${email} reset with the host command.`);
  console.log(`The owner password for ${email} is reset. Sign in with the new one.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`Could not reset the owner password: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
