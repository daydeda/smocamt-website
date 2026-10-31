"use client";

import { useRef } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { Modal } from "@/components/admin/ui";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";

/** Confirm dialog driven by the page hook's `confirmModal` state, built on the kit Modal. */
export function ConfirmModal({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { confirmModal, setConfirmModal, t } = ctx;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const close = () => setConfirmModal((prev) => ({ ...prev, show: false }));
  const danger = !!confirmModal.isDanger;
  return (
    <Modal
      open={confirmModal.show}
      onClose={close}
      size="sm"
      title={confirmModal.title}
      icon={danger ? <AlertTriangle size={20} /> : <HelpCircle size={20} />}
      // Destructive: focus starts on Cancel so Enter can't delete by accident.
      initialFocusRef={danger ? cancelRef : undefined}
      footer={
        <>
          <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={close}>
            {confirmModal.cancelText || t.cancel}
          </button>
          <button type="button" className={danger ? "btn adm-btn-danger-solid" : "btn btn-primary"} onClick={confirmModal.onConfirm}>
            {confirmModal.confirmText || t.adminUiConfirm}
          </button>
        </>
      }
    >
      <p className="adm-modal-text">{confirmModal.message}</p>
    </Modal>
  );
}
