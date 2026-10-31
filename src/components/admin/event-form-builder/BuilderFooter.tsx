"use client";

import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/admin/ui";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

// Rendered into the builder Modal's sticky footer: Delete (left, set apart
// from the everyday actions), then Cancel, then the primary Save.
export function BuilderFooter({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormId, closeFormBuilder, deleteActiveForm, formIsAwarded, formSaving, formTitle, saveForm, t } = ctx;
  const confirm = useConfirm();

  const onDelete = async () => {
    const ok = await confirm({
      title: t.adminEvfDeleteFormTitle.replace("{title}", formTitle || t.fbFormSuffix),
      message: t.fbDeleteFormMessage,
      confirmLabel: t.fbBtnDeleteForm,
      tone: "danger",
    });
    if (ok) deleteActiveForm();
  };

  return (
    <>
      {activeFormId && !formIsAwarded && (
        <button type="button" className="btn btn-danger sm:mr-auto" disabled={formSaving} onClick={onDelete}>
          <Trash2 size={14} aria-hidden="true" /> {t.fbBtnDeleteForm}
        </button>
      )}
      <button type="button" className="btn btn-ghost" disabled={formSaving} onClick={closeFormBuilder}>
        {t.cancel}
      </button>
      <button type="button" className="btn btn-primary" disabled={formSaving} aria-busy={formSaving} onClick={() => saveForm()}>
        {formSaving && <span className="spinner" aria-hidden="true" style={{ width: 16, height: 16 }} />}
        {formSaving ? t.adminEvfSaving : formIsAwarded ? t.fbBtnReopen : activeFormId ? t.fbBtnSaveChanges : t.fbBtnCreateForm}
      </button>
    </>
  );
}
