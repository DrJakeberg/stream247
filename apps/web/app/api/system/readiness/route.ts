import { NextResponse } from "next/server";
import { getSystemReadiness } from "@/lib/server/readiness";

export async function GET() {
  return NextResponse.json(await getSystemReadiness());
}

