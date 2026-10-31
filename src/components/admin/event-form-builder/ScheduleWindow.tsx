"use client";

import { Calendar } from "lucide-react";
import { Field, InlineAlert, Panel } from "@/components/admin/ui";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function ScheduleWindow({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { formClosesAt, formIsAwarded, formOpensAt, setFormClosesAt, setFormOpensAt, t } = ctx;
  const closeError = !formClosesAt
    ? t.fbValidationCloseRequired
    : formOpensAt && new Date(formClosesAt) <= new Date(formOpensAt)
    ? t.fbValidationCloseBeforeOpen
    : undefined;
  return (
    <Panel
      title={t.fbScheduleHeading}
      icon={<Calendar size={16} />}
      description={
        <>
          {t.fbScheduleDescPart1}<b>{t.fbOpensAt}</b>{t.fbScheduleDescPart2}<b>{t.fbClosesAt}</b>{t.fbScheduleDescPart3}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {formIsAwarded && (
          <InlineAlert tone="warning">
            {t.fbReopenWarningPart1}<b>{t.fbClosesAt}</b>{t.fbReopenWarningPart2}<b>{t.fbReopenWarningBold}</b>{t.fbReopenWarningPart3}
          </InlineAlert>
        )}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t.fbOpensAt} hint={t.adminEvfOpensHint}>
            {(p) => (
              <input {...p} type="datetime-local" lang="en-GB" className="input" value={formOpensAt} onChange={(e) => setFormOpensAt(e.target.value)} />
            )}
          </Field>
          <Field label={t.fbClosesAt} required error={closeError}>
            {(p) => (
              <input {...p} type="datetime-local" lang="en-GB" className="input" value={formClosesAt} onChange={(e) => setFormClosesAt(e.target.value)} />
            )}
          </Field>
        </div>
      </div>
    </Panel>
  );
}
