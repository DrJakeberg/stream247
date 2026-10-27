import { readOverlayVideoSourceIngestCredentials, readRelayInternalKey } from "@stream247/db";

// The relay check's stored credentials, shared for a second (M125). /api/relay/auth answers every
// caller, and since it no longer refuses before reading (a correct credential must always pass), a
// flood would otherwise cost two database reads per request.
const RELAY_CREDENTIALS_CACHE_MS = 1_000;
let relayCredentials: {
  readAt: number;
  pending: Promise<{
    sources: Awaited<ReturnType<typeof readOverlayVideoSourceIngestCredentials>>;
    internalKey: Awaited<ReturnType<typeof readRelayInternalKey>>;
  }>;
} | null = null;

export function readRelayCredentials() {
  const now = Date.now();
  if (!relayCredentials || now - relayCredentials.readAt > RELAY_CREDENTIALS_CACHE_MS) {
    const pending = Promise.all([readOverlayVideoSourceIngestCredentials(), readRelayInternalKey()]).then(
      ([sources, internalKey]) => ({ sources, internalKey })
    );
    relayCredentials = { readAt: now, pending };
    // A failed read is not kept: the next request reads again.
    pending.catch(() => {
      if (relayCredentials?.pending === pending) {
        relayCredentials = null;
      }
    });
  }
  return relayCredentials.pending;
}

/** Test seam only. */
export function clearRelayCredentialsCache(): void {
  relayCredentials = null;
}

