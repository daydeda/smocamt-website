"use client";

import { Calendar, CheckCircle2, Lock, Trophy } from "lucide-react";
import { Panel, StatusBadge } from "@/components/admin/ui";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function AutoAwardBanner({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { formClosesAt, formIsAwarded, formPoints, t } = ctx;
  const closes = formClosesAt ? new Date(formClosesAt) : null;
  const hasClosed = !!closes && new Date() > closes;

  if (formIsAwarded) {
    return (
      <Panel
        title={t.fbContestFinalizedTitle}
        icon={<CheckCircle2 size={18} />}
        actions={<StatusBadge tone="success" icon={<Lock size={12} />}>{t.fbPermanentLock}</StatusBadge>}
      >
        <p className="adm-modal-text">{t.fbContestFinalizedDesc}</p>
      </Panel>
    );
  }

  const body = hasClosed
    ? t.adminEvfAwardClosedBody
    : formClosesAt
    ? t.adminEvfAwardPendingBody
    : t.adminEvfAwardNoCloseBody;
  return (
    <Panel
      title={hasClosed ? t.fbClosedAwaitingAward : t.fbAwardsWhenFormCloses}
      icon={hasClosed ? <Trophy size={18} /> : <Calendar size={18} />}
    >
      <p className="adm-modal-text">{body.replace("{points}", String(formPoints))}</p>
    </Panel>
  );
}
