import { describe, expect, it } from "vitest";
import { describeCron, describeInterval, parseCron, type CronFields } from "./cron";

function fields(expression: string): CronFields {
  const result = parseCron(expression);
  if (!result.ok) throw new Error(result.error);
  return result.fields;
}

describe("parseCron", () => {
  it("reads every field form", () => {
    expect(fields("0 9 * * 1-5")).toEqual({
      minute: [0],
      hour: [9],
      day: null,
      month: null,
      weekday: [1, 2, 3, 4, 5],
    });
    expect(fields("*/15 * * * *").minute).toEqual([0, 15, 30, 45]);
    expect(fields("5/20 * * * *").minute).toEqual([5, 25, 45]);
    expect(fields("0 9-17/4 * * *").hour).toEqual([9, 13, 17]);
    expect(fields("0 0 1,15 * *").day).toEqual([1, 15]);
    expect(fields("0 0 * jan,jul *").month).toEqual([1, 7]);
    expect(fields("0 0 * * mon,WED").weekday).toEqual([1, 3]);
  });

  it("folds 7 into Sunday", () => {
    expect(fields("0 0 * * 7").weekday).toEqual([0]);
    expect(fields("0 0 * * 0,7").weekday).toEqual([0]);
    expect(fields("0 0 * * 5-7").weekday).toEqual([0, 5, 6]);
  });

  it("rejects malformed expressions", () => {
    expect(parseCron("")).toMatchObject({ ok: false });
    expect(parseCron("0 9 * *")).toMatchObject({ ok: false });
    expect(parseCron("0 9 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("60 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("* 24 * * *")).toMatchObject({ ok: false });
    expect(parseCron("*/0 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("5-2 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("*,5 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("a * * * *")).toMatchObject({ ok: false });
    // The old launchd entry cap is gone: a dense expression is just a schedule.
    expect(parseCron("*/1 */1 */1 * *")).toMatchObject({ ok: true });
  });
});

describe("describeCron", () => {
  it("names the time", () => {
    expect(describeCron(fields("0 9 * * *"))).toBe("At 09:00");
    expect(describeCron(fields("*/15 * * * *"))).toBe("Every 15 minutes");
    expect(describeCron(fields("0 0 * * *"))).toBe("At 00:00");
  });

  it("keeps weekday, month and day clauses", () => {
    expect(describeCron(fields("0 9 * * 1-5"))).toBe("At 09:00 on Mon–Fri");
    expect(describeCron(fields("0 3 1 * *"))).toBe("At 03:00 on day 1");
    expect(describeCron(fields("0 3 * jan *"))).toBe("At 03:00 in Jan");
  });

  it("reads a restricted day and weekday as alternatives, as cron does", () => {
    expect(describeCron(fields("0 20 1 * mon"))).toBe("At 20:00 on day 1 or on Mon");
  });
});

describe("describeInterval", () => {
  it("picks the largest whole unit", () => {
    expect(describeInterval(1)).toBe("Every second");
    expect(describeInterval(45)).toBe("Every 45 seconds");
    expect(describeInterval(60)).toBe("Every minute");
    expect(describeInterval(900)).toBe("Every 15 minutes");
    expect(describeInterval(3600)).toBe("Every hour");
    expect(describeInterval(7200)).toBe("Every 2 hours");
  });
});
