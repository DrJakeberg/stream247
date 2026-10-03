"use client";

import { useSyncExternalStore } from "react";

type PageLocation = { protocol: string; hostname: string };

/**
 * Plain HTTP on a host other than this machine (M91, owner decision 2026-10-01: a message, no insecure
 * mode). The session cookie is `Secure` in production, and browsers drop such a cookie over `http:`
 * except on localhost, so the owner was created and then every sign-in bounced back without a word.
 */
export function isInsecureRemoteOrigin(location: PageLocation): boolean {
  const hostname = location.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return location.protocol === "http:" && hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1";
}

function parseOrigin(origin: string | undefined): PageLocation | null {
  if (!origin) {
    return null;
  }
  try {
    const url = new URL(origin);
    return { protocol: url.protocol, hostname: url.hostname };
  } catch {
    return null;
  }
}

// The address bar does not change under a mounted page, so there is nothing to subscribe to.
const subscribeToNothing = () => () => undefined;

export function InsecureHttpNotice(props: {
  /** False outside production, where the cookie is not `Secure` and plain HTTP signs in fine. */
  secureCookies: boolean;
  /**
   * The origin the server saw (`resolveRequestOrigin`), so the notice is in the first render. The
   * browser's own address replaces it after hydration: a proxy that does not forward the protocol
   * makes the server's guess wrong, the address bar never is.
   */
  requestOrigin?: string;
}) {
  const origin = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => props.requestOrigin ?? ""
  );
  const location = parseOrigin(origin);

  if (!props.secureCookies || !location || !isInsecureRemoteOrigin(location)) {
    return null;
  }

  return (
    <div className="item insecure-http-notice" role="alert">
      <strong>Signing in will not work over plain HTTP from another machine</strong>
      <p className="warning">
        This page is open at <code>http://{location.hostname}</code>. Browsers drop the sign-in cookie on plain HTTP
        except on localhost, so after signing in you land back on the sign-in page. Two ways out:
      </p>
      <ol className="warning">
        <li>
          Use HTTPS: start the stack with the built-in proxy (<code>docker compose --profile proxy up -d</code>, with{" "}
          <code>TRAEFIK_HOST</code> set) or put your own HTTPS in front of port 3000.
        </li>
        <li>
          Or open an SSH tunnel from this computer (<code>ssh -L 3000:localhost:3000 you@{location.hostname}</code>) and
          use <code>http://localhost:3000</code>.
        </li>
      </ol>
    </div>
  );
}
