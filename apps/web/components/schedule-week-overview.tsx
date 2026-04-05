import {
  formatMinuteOfDay,
  type MaterializedProgrammingDay,
  type ScheduleBlock,
  summarizeScheduleWeek
} from "@stream247/core";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleWeekOverview(props: { blocks: ScheduleBlock[]; materializedDays?: MaterializedProgrammingDay[] }) {
  const summary = summarizeScheduleWeek(props.blocks);
  const materializedByDay = new Map((props.materializedDays || []).map((day) => [day.dayOfWeek, day]));

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
          {materializedByDay.get(day.dayOfWeek) ? (
            <div className="programming-day-flags">
              {materializedByDay.get(day.dayOfWeek)?.underfilledCount ? (
                <span className="programming-status-pill programming-status-underfilled">
                  {materializedByDay.get(day.dayOfWeek)?.underfilledCount} repeat risk
                </span>
              ) : null}
              {materializedByDay.get(day.dayOfWeek)?.overflowCount ? (
                <span className="programming-status-pill programming-status-overflow">
                  {materializedByDay.get(day.dayOfWeek)?.overflowCount} overflow
                </span>
              ) : null}
              {materializedByDay.get(day.dayOfWeek)?.emptyCount ? (
                <span className="programming-status-pill programming-status-empty">
                  {materializedByDay.get(day.dayOfWeek)?.emptyCount} empty
                </span>
              ) : null}
              {!materializedByDay.get(day.dayOfWeek)?.underfilledCount &&
              !materializedByDay.get(day.dayOfWeek)?.overflowCount &&
              !materializedByDay.get(day.dayOfWeek)?.emptyCount &&
              (materializedByDay.get(day.dayOfWeek)?.blockCount ?? 0) > 0 ? (
                <span className="programming-status-pill programming-status-balanced">Balanced</span>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
