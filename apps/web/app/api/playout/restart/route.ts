import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { runBroadcastAction } from "@/lib/server/broadcast";

export async function POST() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    return NextResponse.json(await runBroadcastAction({ type: "restart" }));
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Playout action failed." },
      { status: 400 }
    );
  }
}
