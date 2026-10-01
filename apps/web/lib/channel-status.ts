/**
 * What a viewer is told the channel is doing.
 *
 * The public page rendered the playout's own status value — "running", "reconnecting", "degraded",
 * "switching". Those are the words the process uses about itself, and they leaked straight onto a
 * page meant for people who just want to know whether there is something to watch. Several of them
 * are alarming without being actionable: "degraded" still means a picture is going out.
 *
 * Three answers cover what a viewer can act on. Everything else is the channel's business.
 *
 * Takes a plain string rather than the status union: the public snapshot carries it loosely, and a
 * value this build does not recognise — an older worker, a newer one — should land on "Off air"
 * rather than reach the page unmapped.
 */
export function getChannelStatusLabel(status: string): string {
  switch (status) {
    case "running":
    case "switching":
    // Degraded is an internal quality judgement — from the sofa it is still a channel that plays.
    case "degraded":
      return "On air";
    case "starting":
    case "recovering":
    case "reconnecting":
      return "Starting up";
    default:
      return "Off air";
  }
}

/**
 * Whether to tell the viewer their page is updating more slowly than usual.
 *
 * The page said "Live updates connected" the rest of the time, which is the normal case and
 * therefore not worth a line — and "Polling fallback active" when it was not, which names the
 * mechanism rather than the effect. Silence when things are normal; a plain sentence when they are
 * not.
 */
export function getChannelUpdateNotice(connected: boolean): string {
  return connected ? "" : "Updating every few seconds";
}
