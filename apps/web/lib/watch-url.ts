/**
 * Where the audience actually watches.
 *
 * The public channel page told viewers what was on air and what came next, and offered no way to
 * get to any of it — measured, it had zero links and zero buttons. The broadcaster login was
 * already in the snapshot; this turns it into the one thing that page is for.
 *
 * The login is validated rather than interpolated. It reaches this function from stored
 * configuration and ends up in an href, and Twitch logins are a narrow enough shape that checking
 * costs nothing: four to twenty-five characters, letters, digits and underscores. Anything else
 * yields no link at all, which is the honest outcome — a broken watch link is worse than none.
 */
const TWITCH_LOGIN = /^[a-zA-Z0-9_]{4,25}$/;

export function buildTwitchWatchUrl(broadcasterLogin: string | undefined): string {
  const login = (broadcasterLogin || "").trim();

  if (!TWITCH_LOGIN.test(login)) {
    return "";
  }

  return `https://twitch.tv/${login}`;
}
