"use client";

import { XCircle } from "lucide-react";
import { Modal } from "@/components/admin/ui";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";

/** Error dialog driven by the page hook's `errorModal` state, built on the kit Modal. */
export function ErrorModal({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { errorModal, setErrorModal, t } = ctx;
  const close = () => setErrorModal((prev) => ({ ...prev, show: false }));
  return (
    <Modal
      open={errorModal.show}
      onClose={close}
      size="sm"
      title={errorModal.title}
      icon={<XCircle size={20} />}
      footer={
        <button type="button" className="btn btn-primary" onClick={close}>
          {t.adminEvlClose}
        </button>
      }
    >
      <p className="adm-modal-text" role="alert">{errorModal.message}</p>
    </Modal>
  );
}
