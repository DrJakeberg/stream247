/** Just the fields the card needs, so the description stays pure and testable. */
export type TwitchConnectionSummaryInput = {
  status: string;
  accessToken: string;
  broadcasterLogin: string;
  broadcasterId: string;
};

export type TwitchConnectionSummary = {
  /** Short enough for the metric value line. */
  label: string;
  /** What is true right now, and what the operator has to do about it — if anything. */
  detail: string;
  /** What stops working while this lasts. Empty when nothing is being lost. */
  consequence: string;
};

// Named here rather than at each call site: metadata sync, moderation sync and event registration
// are all gated on the connected status, and the incident that prompted this was invisible
// precisely because nothing on any surface said so. An operator watching a check-in command fail
// to switch the chat mode had no way to connect that to a connection card reading "error".
const PAUSED_WHILE_DISCONNECTED =
  "While this lasts, title and category updates and the emote-only switch stay paused.";

/**
 * The Twitch connection in words rather than in status codes.
 *
 * The card printed the stored status value directly, which meant an operator read "error" and a
 * raw upstream message — and, for a workspace that had never connected, a hyphenated value that
 * is a database token rather than English. Worse, the one case that actually happened is the one
 * neither of those conveyed: the record said broken while the stored access was fresh, fully
 * granted and carrying chat. That state repairs itself, so the card says so instead of sending
 * someone to redo an OAuth round they do not need.
 *
 * The split that decides the wording is whether any access is stored. With a token there is
 * something to re-check, and the worker does exactly that on its own. Without one, no measurement
 * can help and the only honest thing to print is the action that will.
 */
export function describeTwitchConnection(twitch: TwitchConnectionSummaryInput): TwitchConnectionSummary {
  if (twitch.status === "connected") {
    return {
      label: "Connected",
      detail: `Broadcaster ${twitch.broadcasterLogin || twitch.broadcasterId}`,
      consequence: ""
    };
  }

  if (twitch.status !== "connected" && twitch.accessToken.trim() !== "") {
    return {
      label: "Recovering",
      detail:
        "The saved sign-in reported a problem, but the access it stored is still on file. Twitch is asked about that access again in the background, and the connection comes back on its own if it still works.",
      consequence: PAUSED_WHILE_DISCONNECTED
    };
  }

  // No stored access at all. Two shapes reach here — a sign-in that failed before it saved
  // anything, and a workspace that never started one — and only the first has lost something.
  if (twitch.status === "not-connected") {
    return {
      label: "Not connected",
      detail: "No Twitch account is linked yet.",
      consequence: ""
    };
  }

  return {
    label: "Not connected",
    detail: "The Twitch sign-in did not finish, so no access was stored. Connect the account again to bring it back.",
    consequence: PAUSED_WHILE_DISCONNECTED
  };
}
