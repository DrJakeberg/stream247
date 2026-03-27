import { NextResponse } from "next/server";
import { acknowledgeIncident, appendAuditEvent, getFilteredIncidents, readAppState, resolveIncident } from "@/lib/server/state";
import { getAuthenticatedUser, requireApiRoles } from "@/lib/server/auth";

export async function GET(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const severity = url.searchParams.get("severity");
  const scope = url.searchParams.get("scope");
  const query = url.searchParams.get("q") || "";

  const incidents = getFilteredIncidents(state, {
    status: status === "open" || status === "resolved" ? status : "all",
    severity: severity === "info" || severity === "warning" || severity === "critical" ? severity : "all",
    scope:
      scope === "worker" || scope === "playout" || scope === "twitch" || scope === "source" || scope === "system"
        ? scope
        : "all",
    query
  });

  return NextResponse.json({ incidents });
}

export async function POST(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const body = (await request.json()) as {
    fingerprint?: string;
    action?: "acknowledge" | "resolve";
  };

  const fingerprint = (body.fingerprint ?? "").trim();
  if (!fingerprint || !body.action) {
    return NextResponse.json({ message: "Incident fingerprint and action are required." }, { status: 400 });
  }

  if (body.action === "acknowledge") {
    await acknowledgeIncident(fingerprint, user.email);
    await appendAuditEvent("incident.acknowledged", `${user.email} acknowledged incident ${fingerprint}.`);
    return NextResponse.json({ ok: true });
  }

  await resolveIncident(fingerprint, `Resolved by ${user.email}.`);
  await appendAuditEvent("incident.resolved", `${user.email} resolved incident ${fingerprint}.`);
  return NextResponse.json({ ok: true });
}
