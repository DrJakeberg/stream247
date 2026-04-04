import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { runBroadcastAction } from "@/lib/server/broadcast";

export async function POST(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const payload = (await request.json()) as Partial<{ minutes: number }>;
    return NextResponse.json(await runBroadcastAction({ type: "skip", minutes: payload.minutes }));
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Playout action failed." },
      { status: 400 }
    );
  }
}
