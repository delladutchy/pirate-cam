// Calendar days in Delaware time (America/New_York), independent of the viewer's
// own timezone, and correct across daylight-saving changes.
const TZ = 'America/New_York';
const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });

function tzOffsetMs(utcMs) {
  const p = Object.fromEntries(parts.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return asUTC - Math.floor(utcMs / 60000) * 60000; // local − UTC
}

/** Midnight (Delaware time) at the start of the day containing `date`, shifted by `addDays`. */
export function dayStart(date, addDays = 0) {
  const p = Object.fromEntries(parts.formatToParts(date).map(x => [x.type, x.value]));
  let guess = Date.UTC(+p.year, +p.month - 1, +p.day + addDays, 0, 0);
  guess -= tzOffsetMs(guess); // US DST changes happen at 2 AM, never at midnight, so one pass is exact
  return new Date(guess);
}

/** The day after `start` (handles 23 h / 25 h DST days). */
export const dayEnd = start => dayStart(new Date(start.getTime() + 36 * 3600e3), 0);

const wk = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const md = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });

/** Forecast days: today + the next two, each with the span that actually has scored data. */
export function forecastDays(timeline, now) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const start = dayStart(now, i), end = dayEnd(start);
    const inDay = timeline.filter(s => s.t >= start && s.t < end);
    const scored = inDay.filter(s => s.score != null);
    out.push({
      index: i, start, end,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : wk.format(start),
      sub: md.format(start),
      dataFrom: inDay[0]?.t ?? null, dataTo: inDay.at(-1)?.t ?? null,
      hasScores: scored.length > 0,
    });
  }
  return out;
}
