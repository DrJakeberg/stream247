import { NextResponse } from "next/server";
import { getSchedulePreview, readAppState } from "@/lib/server/state";

export async function GET() {
  const state = await readAppState();
  return NextResponse.json(getSchedulePreview(state));
}

