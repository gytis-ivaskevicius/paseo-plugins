/**
 * One dialect, two parsers.
 *
 * The form validates with `shared/cron.ts` (it cannot import croner into the
 * client bundle) and the server arms with croner. Anything the form accepts
 * must therefore also be accepted by the library, or the preview lies and the
 * save fails with a different error. `5/20` was exactly that until a test said
 * so.
 */
import { Cron } from "croner";
import { describe, expect, it } from "vitest";

import { parseCron } from "../shared/cron";

const ACCEPTED = [
  "* * * * *",
  "0 9 * * 1-5",
  "*/15 * * * *",
  "0 9-17/4 * * *",
  "0 0 1,15 * *",
  "0 0 * jan,jul *",
  "0 0 * * mon,WED",
  "0 0 * * wed-fri",
  "0 0 * * 0,7",
  "0 0 1-31/2 * *",
  "0 0 29 2 *",
  "30 4 1,15 * 5",
];

describe("the form's dialect is schedulable", () => {
  for (const expression of ACCEPTED) {
    it(expression, () => {
      expect(parseCron(expression).ok).toBe(true);
      expect(() => new Cron(expression, { paused: true }).stop()).not.toThrow();
    });
  }
});

describe("what the form refuses, the library is never asked", () => {
  const refused = ["5/20 * * * *", "*/0 * * * *", "5-2 * * * *", "0 9 * *", "0 9 * * * *"];

  for (const expression of refused) {
    it(expression, () => {
      expect(parseCron(expression).ok).toBe(false);
    });
  }
});
