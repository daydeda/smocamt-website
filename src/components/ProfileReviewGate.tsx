"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProfileReviewModal } from "@/components/ProfileReviewModal";
import { shouldShowProfileReview } from "@/lib/profile-review";

/**
 * Shows the periodic profile check-in modal on the dashboard. Same modal and same
 * trigger as /dashboard/profile (shouldShowProfileReview). One fetch on mount: a
 * failed fetch just means no modal, and the profile page still prompts.
 * "Update" hands off to the profile form, flagged so it doesn't prompt a second time.
 */
export function ProfileReviewGate() {
  const router = useRouter();
  const [due, setDue] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/profile", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((user) => setDue(shouldShowProfileReview(user)))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  if (!due) return null;
  return (
    <ProfileReviewModal
      onUpdate={() => router.push("/dashboard/profile?review=update")}
      onKept={() => setDue(false)}
    />
  );
}
