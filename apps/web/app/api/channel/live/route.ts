import { NextResponse } from "next/server";
import { getPublicChannelSnapshot, readAppState } from "@/lib/server/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readAppState();
  return NextResponse.json(getPublicChannelSnapshot(state));
}
