// Every HTTP request the worker awaits on a cycle carries a deadline (M87, R3 H6).
//
// Until M87 the six Twitch requests in the worker cycle had none. A Twitch endpoint that accepted
// the connection and then never answered held the cycle until the 300 s stall guard fired, and the
// guard exits the process: one slow API call cost a restart and five minutes without heartbeat,
// sweep, live status or chat. With a deadline the same stall is one failed step that the cycle
// reports and moves past.

/**
 * The default deadline for one request to an external service. Twitch's API answers in well under a
 * second when it is healthy; ten seconds is the bound the live-status poll already used, and it
 * keeps even a cycle that hits several dead endpoints far below the stall guard.
 */
export const EXTERNAL_REQUEST_TIMEOUT_MS = 10_000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The part of a URL that names the endpoint. The path only for Twitch's API: a webhook URL carries
 * its token in the path, and this text ends up in logs and incidents.
 */
function describeEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("twitch.tv") ? `${parsed.origin}${parsed.pathname}` : parsed.origin;
  } catch {
    return "the request";
  }
}

/**
 * `fetch` with a deadline. The signal is `AbortSignal.timeout`, so a real fetch aborts the socket
 * and also a body read (`response.json()`) that is still running when the deadline passes. The race
 * is the backstop for an implementation that ignores the signal, so the caller is released on time
 * either way. A timeout rejects with an error that names the endpoint and the deadline instead of
 * the bare "The operation was aborted due to timeout".
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; fetchImpl?: FetchLike } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? EXTERNAL_REQUEST_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(timeoutMs);
  const timeoutError = new Error(`${describeEndpoint(url)} did not answer within ${timeoutMs} ms.`);
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), timeoutMs);
  });

  try {
    return await Promise.race([fetchImpl(url, { ...init, signal }), deadline]);
  } catch (error) {
    throw signal.aborted || error === timeoutError ? timeoutError : error;
  } finally {
    clearTimeout(timer);
  }
}
