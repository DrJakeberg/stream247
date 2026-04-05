import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { runBroadcastAction } from "@/lib/server/broadcast";

type BroadcastActionRequest = {
  type?:
    | "restart"
    | "hard_reload"
    | "refresh"
    | "rebuild_queue"
    | "force_reconnect"
    | "bridge_start"
    | "bridge_release"
    | "fallback"
    | "resume"
    | "trigger_insert"
    | "play_now"
    | "move_next"
    | "remove_next"
    | "replay_previous"
    | "skip"
    | "override";
  minutes?: number;
  assetId?: string;
  inputType?: "rtmp" | "hls";
  inputUrl?: string;
  label?: string;
};

export async function POST(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const payload = (await request.json()) as BroadcastActionRequest;
    const type = payload.type ?? "restart";

    const result =
      type === "skip"
        ? await runBroadcastAction({ type, minutes: payload.minutes })
        : type === "bridge_start"
          ? await runBroadcastAction({
              type,
              inputType: payload.inputType,
              inputUrl: String(payload.inputUrl ?? ""),
              label: String(payload.label ?? "")
            })
        : type === "move_next"
          ? await runBroadcastAction({ type, assetId: String(payload.assetId ?? "") })
          : type === "play_now"
            ? await runBroadcastAction({ type, assetId: String(payload.assetId ?? "") })
            : type === "replay_previous" || type === "remove_next" || type === "bridge_release"
              ? await runBroadcastAction({ type })
        : type === "override"
          ? await runBroadcastAction({ type, assetId: String(payload.assetId ?? ""), minutes: payload.minutes })
          : type === "trigger_insert"
            ? await runBroadcastAction({ type, assetId: String(payload.assetId ?? "") })
          : await runBroadcastAction({ type });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Broadcast action failed." },
      { status: 400 }
    );
  }
}
