"use client";

import { Field, Modal } from "@/components/admin/ui";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function RequestChangesModal({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { formReviewSaving, requestChangesNote, requestChangesOpen, reviewActiveForm, setRequestChangesNote, setRequestChangesOpen, t } = ctx;
  const send = async () => {
    const note = requestChangesNote.trim();
    if (!note) return;
    setRequestChangesOpen(false);
    await reviewActiveForm("requestChanges", note);
  };
  return (
    <Modal
      open={requestChangesOpen}
      onClose={() => setRequestChangesOpen(false)}
      dismissible={!formReviewSaving}
      size="sm"
      title={t.fbReviewRequestChangesBtn}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => setRequestChangesOpen(false)} disabled={formReviewSaving}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn-primary" disabled={formReviewSaving || !requestChangesNote.trim()} onClick={send}>
            {formReviewSaving && <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14 }} />}
            {formReviewSaving ? t.adminEvfSending : t.adminEvfSendRequest}
          </button>
        </>
      }
    >
      <Field
        label={t.fbReviewRequestChangesPrompt}
        required
        hint={`${requestChangesNote.length} / 1000`}
      >
        {(p) => (
          <textarea
            {...p}
            className="input"
            value={requestChangesNote}
            onChange={(e) => setRequestChangesNote(e.target.value)}
            maxLength={1000}
            rows={5}
            style={{ resize: "vertical" }}
          />
        )}
      </Field>
    </Modal>
  );
}
