/**
 * Cron expressions to and from the sentence the screen shows while one is
 * typed. Shared on purpose: this file lands in both bundles and must stay free
 * of Node imports.
 *
 * Validation lives here so the form can refuse a bad expression before it is
 * sent, and the server re-validates by handing the same expression to the
 * scheduler library. Scheduling itself is not here — the daemon does that.
 */

export interface CalendarEntry {
  minute?: number;
  hour?: number;
  day?: number;
  month?: number;
  weekday?: number;
}

export const CALENDAR_FIELDS = ["minute", "hour", "day", "month", "weekday"] as const;
export type CalendarField = (typeof CALENDAR_FIELDS)[number];

/** A parsed expression: per field, every value it allows, or null for `*`. */
export type CronFields = Record<CalendarField, number[] | null>;

export type CronResult = { ok: true; fields: CronFields } | { ok: false; error: string };

interface FieldSpec {
  min: number;
  max: number;
  names?: readonly string[];
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const FIELD_SPECS: Record<CalendarField, FieldSpec> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: { min: 1, max: 12, names: MONTH_NAMES },
  // 7 is accepted as Sunday on the way in and folded to 0 below.
  weekday: { min: 0, max: 7, names: WEEKDAY_NAMES },
};

function parseNumber(token: string, spec: FieldSpec, field: CalendarField): number | string {
  const lowered = token.toLowerCase();
  const named = spec.names?.indexOf(lowered) ?? -1;
  if (named >= 0) return named + spec.min;
  if (!/^\d+$/.test(token)) return `"${token}" is not a valid ${field}`;
  const value = Number(token);
  if (value < spec.min || value > spec.max) {
    return `${field} ${value} is outside ${spec.min}–${spec.max}`;
  }
  return value;
}

/**
 * One comma-separated cron field to the sorted set of values it names, or
 * null for an unrestricted `*`. Accepts `N`, `A-B`, `*\/S`, `A-B/S`, `A/S`
 * (from A to the field's max, as Vixie cron reads it) and three-letter names.
 */
function parseField(text: string, field: CalendarField): number[] | null | string {
  const spec = FIELD_SPECS[field];
  const values = new Set<number>();
  let restricted = false;
  for (const part of text.split(",")) {
    if (part === "") return `${field} has an empty entry`;
    const [rangeText, stepText, extra] = part.split("/");
    if (extra !== undefined || rangeText === undefined) return `"${part}" is not a valid ${field}`;
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) === 0) {
        return `"${part}" has an invalid step`;
      }
      step = Number(stepText);
    }
    let low: number;
    let high: number;
    if (rangeText === "*") {
      if (stepText === undefined) {
        // A bare `*` anywhere in the list makes the whole field unrestricted.
        if (part === text) return null;
        return `"${text}" mixes * with other values`;
      }
      low = spec.min;
      high = spec.max;
    } else {
      const [lowText, highText, more] = rangeText.split("-");
      if (more !== undefined || lowText === undefined) return `"${part}" is not a valid ${field}`;
      const parsedLow = parseNumber(lowText, spec, field);
      if (typeof parsedLow === "string") return parsedLow;
      low = parsedLow;
      if (highText === undefined) {
        high = stepText === undefined ? low : spec.max;
      } else {
        const parsedHigh = parseNumber(highText, spec, field);
        if (typeof parsedHigh === "string") return parsedHigh;
        high = parsedHigh;
      }
      if (high < low) return `"${part}" runs backwards`;
    }
    restricted = true;
    for (let value = low; value <= high; value += step) values.add(value);
  }
  if (!restricted) return null;
  const list = [...values];
  if (field === "weekday" && list.includes(7)) {
    // Both spellings of Sunday were given, or only 7.
    const folded = new Set(list.map((value) => (value === 7 ? 0 : value)));
    return [...folded].sort((a, b) => a - b);
  }
  return list.sort((a, b) => a - b);
}

/** Parses a five-field cron expression. Six fields (with seconds) are refused. */
export function parseCron(expression: string): CronResult {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || parts[0] === "") {
    return {
      ok: false,
      error: `Expected five fields (minute hour day month weekday), got ${parts[0] === "" ? 0 : parts.length}`,
    };
  }
  const fields: Partial<CronFields> = {};
  for (let index = 0; index < CALENDAR_FIELDS.length; index += 1) {
    const field = CALENDAR_FIELDS[index];
    if (field === undefined) continue;
    const parsed = parseField(parts[index] ?? "", field);
    if (typeof parsed === "string") return { ok: false, error: parsed };
    fields[field] = parsed;
  }
  return { ok: true, fields: fields as CronFields };
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `1,2,3,4,5` reads as `Mon–Fri`; anything not contiguous is listed. */
function labelRange(values: readonly number[], labels: readonly string[]): string {
  const contiguous = values.every((value, index) => index === 0 || value === (values[index - 1] ?? 0) + 1);
  if (contiguous && values.length > 2) {
    return `${labels[values[0] ?? 0]}–${labels[values[values.length - 1] ?? 0]}`;
  }
  return joinList(values.map((value) => labels[value] ?? String(value)));
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Whether `values` is every S-th value from the field's minimum. */
function evenStep(values: readonly number[], min: number, max: number): number | null {
  if (values.length < 2 || values[0] !== min) return null;
  const step = (values[1] ?? 0) - min;
  if (step <= 0) return null;
  const even = values.every((value, index) => value === min + index * step);
  const last = values[values.length - 1] ?? 0;
  return even && last + step > max ? step : null;
}

/**
 * A sentence for the job list: "At 09:00 on Mon–Fri", "Every 15 minutes",
 * "At minute 30 past every hour on day 1". It describes what cron does, so it
 * is worth showing next to the expression while it is typed.
 */
export function describeCron(fields: CronFields): string {
  const { minute, hour, day, month, weekday } = fields;
  let when: string;
  if (minute === null && hour === null) {
    when = "Every minute";
  } else if (hour === null) {
    const step = minute === null ? null : evenStep(minute, 0, 59);
    if (minute !== null && step !== null) {
      when = step === 1 ? "Every minute" : `Every ${step} minutes`;
    } else if (minute !== null && minute.length === 1) {
      when = minute[0] === 0 ? "Every hour" : `At minute ${minute[0]} past every hour`;
    } else {
      when = `At minutes ${joinList((minute ?? []).map(String))} past every hour`;
    }
  } else if (minute === null) {
    const hours = hour.map((value) => `${pad(value)}:00–${pad(value)}:59`);
    when = `Every minute between ${joinList(hours)}`;
  } else {
    const hourStep = evenStep(hour, 0, 23);
    if (hourStep !== null && hourStep > 1 && minute.length === 1) {
      when = `Every ${hourStep} hours at :${pad(minute[0] ?? 0)}`;
    } else {
      const times: string[] = [];
      for (const h of hour) for (const m of minute) times.push(`${pad(h)}:${pad(m)}`);
      when = times.length > 6 ? `${times.length} times a day` : `At ${joinList(times)}`;
    }
  }
  const dayClause = day === null ? null : day.length === 1 ? `on day ${day[0]}` : `on days ${joinList(day.map(String))}`;
  const weekdayClause = weekday === null ? null : `on ${labelRange(weekday, WEEKDAY_LABELS)}`;
  const monthClause = month === null ? null : `in ${labelRange(month.map((value) => value - 1), MONTH_LABELS)}`;
  const clauses: string[] = [];
  // Cron's rule: a restricted day-of-month and a restricted weekday are
  // alternatives, not a conjunction.
  if (dayClause !== null && weekdayClause !== null) {
    clauses.push(`${dayClause} or ${weekdayClause}`);
  } else if (dayClause !== null) {
    clauses.push(dayClause);
  } else if (weekdayClause !== null) {
    clauses.push(weekdayClause);
  }
  if (monthClause !== null) clauses.push(monthClause);
  return [when, ...clauses].join(" ");
}

/** For an interval job: "Every 30 seconds", "Every 5 minutes", "Every 2 hours". */
export function describeInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
  }
  return seconds === 1 ? "Every second" : `Every ${seconds} seconds`;
}
