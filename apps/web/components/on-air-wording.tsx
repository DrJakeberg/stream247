import { describeOnAirWording } from "@/lib/overlay-headline-wording";

/** Under a headline field whose stored built-in default airs in other words (M104, U14). */
export function OnAirWording({ locale, value }: { locale: string; value: string }) {
  const onAir = describeOnAirWording(value, locale);
  return onAir ? <span className="subtle">Viewers see: {onAir}</span> : null;
}
