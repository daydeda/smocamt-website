import { revalidateTag } from "next/cache";
import { logger } from "@/lib/util/logger";

// Every unstable_cache tag backing a student-facing leaderboard read (house
// standings, individual standings). Kept in one place so every points-write path
// busts the same set — a write that forgets this leaves the dashboard showing
// stale scores until the cache's own TTL happens to expire (up to 15s, longer
// under load), which reads as "the leaderboard isn't real-time".
const LEADERBOARD_TAGS = ["house-standings", "individual-standings"] as const;

/**
 * Busts the cached leaderboard reads after a points-affecting write (scan
 * check-in, manual score, form award, no-show strike, event/contest payout, …)
 * so the change shows up on the next poll instead of waiting out the cache TTL.
 *
 * Best-effort: a purge failure must never fail the write that triggered it —
 * the TTL is the backstop. (Next 16's revalidateTag takes a cache-life profile
 * as its second argument.)
 */
export function revalidateLeaderboards() {
  for (const tag of LEADERBOARD_TAGS) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch (e) {
      logger.warn("leaderboard cache purge failed (TTL will catch up)", { tag, error: String(e) });
    }
  }
}
