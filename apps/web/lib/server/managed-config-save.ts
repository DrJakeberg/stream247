import { NextResponse } from "next/server";

export const MANAGED_CONFIG_KEY_MISMATCH_MESSAGE =
  "The stored settings were encrypted with a different APP_SECRET. Restore that APP_SECRET (env or the secret file " +
  "on the data volume) before saving; nothing was changed.";

/**
 * The answer of a managed-config route whose save updateManagedConfigRecord refused because the
 * stored payload does not open with the current APP_SECRET: 409, nothing was written, and restoring
 * the original APP_SECRET brings every stored credential back. Any other error is rethrown as is.
 * Matched by name rather than instanceof, so a mocked or separately bundled db module still matches.
 */
export function managedConfigSaveRefusal(error: unknown): NextResponse {
  if (error instanceof Error && error.name === "ManagedConfigKeyMismatchError") {
    return NextResponse.json({ ok: false, message: MANAGED_CONFIG_KEY_MISMATCH_MESSAGE }, { status: 409 });
  }
  throw error;
}
