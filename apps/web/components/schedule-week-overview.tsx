import { formatMinuteOfDay, type ScheduleBlock, summarizeScheduleWeek } from "@stream247/core";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleWeekOverview(props: { blocks: ScheduleBlock[] }) {
  const summary = summarizeScheduleWeek(props.blocks);

  return (
    <div className="week-overview">
      {summary.map((day) => (
        <article className="week-day-card" key={day.dayOfWeek}>
          <span className="label">{dayLabels[day.dayOfWeek]}</span>
          <strong>{day.blockCount === 0 ? "No programming" : `${day.blockCount} block${day.blockCount === 1 ? "" : "s"}`}</strong>
          <div className="subtle">
            {day.scheduledMinutes === 0 ? "No scheduled minutes" : `${Math.round(day.scheduledMinutes / 60)}h scheduled`}
          </div>
          <div className="subtle">
            {day.firstStartMinute !== null && day.lastEndMinute !== null
              ? `${formatMinuteOfDay(day.firstStartMinute)} to ${formatMinuteOfDay(day.lastEndMinute)}`
              : "Open day"}
          </div>
        </article>
      ))}
    </div>
  );
}
