"use client";

import { Trash2 } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function BuilderFooter({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormId, closeFormBuilder, deleteActiveForm, formIsAwarded, formSaving, saveForm, setConfirmModal, t } = ctx;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", borderTop: "1px solid var(--border-subtle)", paddingTop: 28, marginTop: 12 }}>
                      <div>
                        {activeFormId && !formIsAwarded && (
                          <button
                            className="btn btn-danger"
                            type="button"
                            style={{ height: 40, borderRadius: 12, padding: "0 16px", fontSize: 12 }}
                            onClick={() => setConfirmModal({
                              show: true,
                              title: t.fbDeleteFormTitle || "Delete this form?",
                              message: t.fbDeleteFormMessage || "This will permanently delete the form and all its submissions.",
                              confirmText: t.fbBtnDeleteForm || "Delete Form",
                              cancelText: t.cancel || "Cancel",
                              isDanger: true,
                              onConfirm: () => { setConfirmModal(prev => ({ ...prev, show: false })); deleteActiveForm(); }
                            })}
                          >
                            <Trash2 size={13} style={{ marginRight: 6 }} /> {t.fbBtnDeleteForm || "Delete Form"}
                          </button>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "flex-end", flex: 1 }}>
                        <button
                          className="btn btn-ghost"
                          type="button"
                          style={{ height: 46, borderRadius: 12, padding: "0 24px", whiteSpace: "nowrap" }}
                          onClick={closeFormBuilder}
                        >
                          {t.cancel || "Cancel"}
                        </button>
                        <button
                          className="btn btn-primary"
                          type="button"
                          style={{ height: 46, borderRadius: 12, padding: "0 24px", whiteSpace: "nowrap" }}
                          disabled={formSaving}
                          onClick={() => saveForm()}
                        >
                          {formSaving ? <div className="spinner w-4 h-4 border-2" /> : formIsAwarded ? (t.fbBtnReopen || "Re-open & Save") : activeFormId ? (t.fbBtnSaveChanges || "Save Changes") : (t.fbBtnCreateForm || "Create Form")}
                        </button>
                      </div>
                    </div>
  );
}
