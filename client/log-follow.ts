/**
 * Live log following, over the same `jobs.log` RPC the Refresh button uses.
 *
 * The upstream plugin had to borrow a workspace terminal and run `tail -f` in
 * it, because launchd owned the process and the plugin had nothing else that
 * could stream. This plugin owns the process, so following is just re-reading
 * the tail: one request a second while the pane is looking, nothing left
 * running afterwards, and no workspace needed.
 *
 * Async **function expressions**, never async arrows — see `client/jobs.tsx`.
 */
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";

import { readJobLog } from "../shared/jobs";
import type { Job } from "../shared/jobs";

/** How often the tail is re-read. The panel is the only thing that sees it. */
const POLL_MS = 1_000;

/** More than this is scrollback nobody scrolls back to. */
const MAX_LINES = 500;

export interface LogFollow {
  /** True from the moment `start` is pressed, including the first read. */
  readonly following: boolean;
  /** Null until the first answer, so the pane can keep the static log. */
  readonly lines: readonly string[] | null;
  readonly error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * A log tail ends on a newline whenever the job is between runs; the empty
 * string after it is not a line. A run still writing leaves a partial line,
 * which is shown as one.
 */
function toLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-MAX_LINES);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLogFollow(job: Job): LogFollow {
  const readLog = useRpc(readJobLog);
  const [following, setFollowing] = useState(false);
  const [lines, setLines] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Guards a read that lands after `stop`, a job switch, or an unmount. */
  const generation = useRef(0);
  /** The last tail rendered, so a job that is quiet does not repaint once a second. */
  const lastText = useRef<string | null>(null);

  const stop = useCallback(function stop() {
    generation.current += 1;
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
    lastText.current = null;
    setFollowing(false);
    setLines(null);
    setError(null);
  }, []);

  const start = useCallback(
    function start() {
      generation.current += 1;
      const mine = generation.current;
      if (timer.current !== null) clearInterval(timer.current);
      lastText.current = null;
      setFollowing(true);
      setLines(null);
      setError(null);

      async function capture(): Promise<void> {
        try {
          const tail = await readLog({ id: job.id });
          if (mine !== generation.current) return;
          if (tail.text === lastText.current) return;
          lastText.current = tail.text;
          setLines(toLines(tail.text));
        } catch (cause) {
          if (mine !== generation.current) return;
          // A daemon that has gone away stops the follow rather than failing
          // once a second; the pane reports the error and offers Follow again.
          // `stop()` is not used here because it would clear the error.
          if (timer.current !== null) {
            clearInterval(timer.current);
            timer.current = null;
          }
          setError(errorText(cause));
          setFollowing(false);
        }
      }

      void capture();
      timer.current = setInterval(() => void capture(), POLL_MS);
    },
    [job.id, readLog, stop],
  );

  // A job swapped underneath a running follow, or an unmounted pane, must not
  // leave a timer polling for something nobody is looking at.
  useEffect(() => {
    return function cleanup() {
      stop();
    };
  }, [job.id, stop]);

  return { following, lines, error, start, stop };
}
