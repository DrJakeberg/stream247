import { localizeViewerBuiltInText } from "@stream247/core";
import { buildProgrammeCalendar } from "@/lib/public-programme-calendar";
import { getPublicProgramme, getViewerLocale, getWorkspaceTimeZone, readAppState } from "@/lib/server/state";

export const dynamic = "force-dynamic";

/** The public programme as a calendar feed (M100): public like /channel, the coming week block by block. */
export async function GET() {
  const state = await readAppState();
  const now = new Date();
  const locale = getViewerLocale(state);
  const body = buildProgrammeCalendar({
    entries: getPublicProgramme(state, now).week,
    locale,
    channelName: localizeViewerBuiltInText(locale, state.overlay.channelName || "Stream247"),
    timeZone: getWorkspaceTimeZone(state),
    now
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="channel.ics"',
      "Cache-Control": "no-store"
    }
  });
}
