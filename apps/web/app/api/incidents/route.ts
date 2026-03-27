import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({ incidents: state.incidents });
}
