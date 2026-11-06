import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Feed } from "../shared/github";
import { REFRESH_MS } from "./view";

export interface FeedState {
  feed: Feed | null;
  loading: boolean;
  error: string | null;
  setup: string | null;
}

type ListFeed = (input: { force?: boolean }) => Promise<Feed>;

const initial: FeedState = { feed: null, loading: false, error: null, setup: null };
let state: FeedState = initial;
const listeners = new Set<() => void>();
let invoke: ListFeed | null = null;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;

function emit(): void {
  listeners.forEach(function (listener) {
    listener();
  });
}

function setState(next: FeedState): void {
  state = next;
  emit();
}

export function feedSnapshot(): FeedState {
  return state;
}

export function subscribeFeed(listener: () => void): () => void {
  listeners.add(listener);
  return function () {
    listeners.delete(listener);
  };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function setupText(error: unknown): string | null {
  const text = messageOf(error);
  const marker = "GITHUB_SETUP:";
  const index = text.indexOf(marker);
  if (index === -1) return null;
  const tail = text.slice(index + marker.length).trim();
  return tail.split(/["\n]/)[0]?.trim() || tail;
}

export function refreshFeed(force = false): Promise<void> {
  const current = inFlight;
  if (current !== null) {
    if (!force) return current;
    return current.then(function () {
      return refreshFeed(true);
    });
  }
  const call = invoke;
  if (call === null) return Promise.resolve();

  setState({ ...state, loading: true });
  const run = call({ force })
    .then(function (feed) {
      setState({ feed, loading: false, error: feed.error, setup: null });
    })
    .catch(function (error: unknown) {
      const setup = setupText(error);
      if (setup !== null) {
        setState({ ...state, loading: false, setup, error: null });
        return;
      }
      setState({ ...state, loading: false, error: messageOf(error), setup: null });
    })
    .finally(function () {
      inFlight = null;
    });

  inFlight = run;
  return run;
}

export function requestRefresh(): void {
  void refreshFeed(true);
}

export function useFeed(list: ListFeed): FeedState {
  const snapshot = useSyncExternalStore(subscribeFeed, feedSnapshot, feedSnapshot);
  const listRef = useRef(list);
  listRef.current = list;

  useEffect(function () {
    invoke = listRef.current;
    subscribers += 1;
    if (subscribers === 1) {
      timer = setInterval(function () {
        void refreshFeed();
      }, REFRESH_MS);
    }
    void refreshFeed();

    return function () {
      subscribers -= 1;
      if (subscribers === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return snapshot;
}
