import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    services: {
      web: "ok",
      worker: "planned",
      playout: "planned"
    }
  });
}

