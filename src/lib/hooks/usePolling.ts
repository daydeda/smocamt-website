import { useEffect, useRef } from "react";

/**
 * Lightweight polling hook used in place of a websocket/SSE real-time layer.
 *
 * Why polling: on the Supabase free tier, Realtime is capped at 200 concurrent
 * connections — a single busy event could exceed that with student devices alone.
 * Polling has no connection cap, needs no extra infrastructure, and costs $0 on
 * Vercel Hobby + Supabase free.
 *
 * Free-tier friendly behaviour:
 *  - Fires `callback` immediately on mount (when the tab is visible) and again
 *    each time the tab regains focus, so data is fresh the moment the user looks.
 *  - Polls every `intervalMs` only while the tab is visible.
 *  - Pauses entirely when the tab is hidden, so idle background tabs don't burn
 *    function invocations or database queries.
 *
 * Overlap-safe (this is the important part for the DB pooler): the next tick is
 * scheduled only AFTER the current one settles, and a tick is skipped while one is
 * still in flight. With the old setInterval, a single slow response (e.g. the
 * pooler momentarily queueing a connection) caused requests to STACK — every
 * `intervalMs` fired another, each opening its own pooled connections, which piled
 * load onto the very pooler that was already struggling and turned one slow request
 * into a site-wide wave of 504s. Awaiting each tick caps every tab at exactly one
 * in-flight request, so polling load stays flat no matter how slow the backend is.
 *
 * A request that overruns is also aborted via the AbortSignal handed to the
 * callback (pass it to `fetch`), so a stalled request is dropped — and its
 * connection released — instead of being held until the platform 504s it.
 *
 * The callback is read from a ref, so passing a fresh inline function each render
 * is fine — the loop always invokes the latest version without restarting.
 */
export function usePolling(
  callback: (signal: AbortSignal) => void | Promise<unknown>,
  intervalMs: number,
) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    let stopped = false;
    // Bumped on every start()/stop(); a running loop whose epoch no longer matches
    // the current one quietly exits, so we never end up with two loops scheduling.
    let epoch = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let inFlight = false;
    // Current gap before the next tick. Starts at the base interval, doubles on
    // each consecutive failure (see loop) and resets to the base on the first
    // success, so a flapping/overloaded backend isn't hammered every interval.
    let currentDelay = intervalMs;

    // Hard ceiling on a single request. Generous (a few intervals) so a normally
    // slow-but-fine response is never cut off, but bounded so a truly stuck request
    // is abandoned rather than held open indefinitely.
    const hardStopMs = Math.max(intervalMs * 3, 15000);
    // Upper bound for the exponential backoff: ~5 min (or the base interval, if
    // that's already larger), so a long outage settles to an occasional retry.
    const maxBackoffMs = Math.max(intervalMs, 300000);

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    // Resolves true if the tick settled cleanly, false if the callback threw
    // (a real fetch failure, or an aborted/overrun request) — the loop uses this
    // to decide whether to back off. A skipped tick counts as success (no failure).
    const runOnce = async (): Promise<boolean> => {
      if (stopped || inFlight || document.visibilityState !== "visible") return true;
      inFlight = true;
      controller = new AbortController();
      const ac = controller;
      const hardStop = setTimeout(() => ac.abort(), hardStopMs);
      try {
        await savedCallback.current(ac.signal);
        return true;
      } catch {
        // Best-effort polling: swallow errors (including AbortError) and try again
        // on the next tick, after backing off.
        return false;
      } finally {
        clearTimeout(hardStop);
        inFlight = false;
      }
    };

    const loop = async (myEpoch: number) => {
      if (stopped || myEpoch !== epoch) return;
      const ok = await runOnce();
      if (stopped || myEpoch !== epoch || document.visibilityState !== "visible") return;
      // Exponential backoff on failure, reset to the base interval on success.
      currentDelay = ok ? intervalMs : Math.min(currentDelay * 2, maxBackoffMs);
      timer = setTimeout(() => loop(myEpoch), currentDelay);
    };

    const start = () => {
      epoch += 1; // invalidate any prior loop before starting a fresh one
      clearTimer();
      currentDelay = intervalMs; // fresh visible session starts at the base cadence
      loop(epoch);
    };

    const stop = () => {
      epoch += 1; // invalidate the running loop's continuation
      clearTimer();
      controller?.abort();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };

    // Kick off based on the current visibility state.
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs]);
}
