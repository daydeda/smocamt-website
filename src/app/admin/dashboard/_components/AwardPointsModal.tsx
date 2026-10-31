"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Field, Modal, useConfirm, useToast } from "@/components/admin/ui";

const MAX_AMOUNT = 10000; // mirrors the server's bound on a single manual adjustment
const CONFIRM_FROM = 100; // large additions ask for a second confirmation

type Mode = "add" | "deduct";

const fmt = (n: number) => n.toLocaleString("en-US");
const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);

/**
 * Award or deduct house points. Explicit Add / Deduct choice plus a positive
 * amount (instead of a signed number), a live before → after preview, and a
 * confirmation for deductions and large awards. The request body is unchanged:
 * `{ houseId, delta, reason }` with delta negative for a deduction.
 */
export function AwardPointsModal({
  house,
  onClose,
  onDone,
}: {
  house: { id: string; label: string; points: number };
  onClose: () => void;
  /** Called after a successful save so the caller can refetch. */
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const formId = useId();

  const [mode, setMode] = useState<Mode>("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const amountNum = /^\d+$/.test(amount.trim()) ? parseInt(amount.trim(), 10) : NaN;
  const amountValid = amountNum >= 1 && amountNum <= MAX_AMOUNT;
  const reasonTrim = reason.trim();
  const delta = amountValid ? (mode === "add" ? amountNum : -amountNum) : 0;
  const after = house.points + delta;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (submitting || !amountValid || !reasonTrim) return;

    if (mode === "deduct" || amountNum >= CONFIRM_FROM) {
      const ok = await confirm({
        title: fill(mode === "deduct" ? t.adminOvConfirmDeductTitle : t.adminOvConfirmAddTitle, { n: fmt(amountNum), house: house.label }),
        message: fill(t.adminOvConfirmBody, { house: house.label, before: fmt(house.points), after: fmt(after), reason: reasonTrim }),
        confirmLabel: fill(mode === "deduct" ? t.adminOvSubmitDeduct : t.adminOvSubmitAdd, { n: fmt(amountNum) }),
        tone: mode === "deduct" ? "danger" : "primary",
      });
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/houses/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId: house.id, delta, reason: reasonTrim }),
      });
      if (res.ok) {
        toast.success(t.adminOvAwardSuccess, fill(t.adminOvPreview, { house: house.label, before: fmt(house.points), after: fmt(after) }));
        onDone();
        onClose();
      } else {
        const err = await res.json().catch(() => null);
        toast.error(t.adminOvAwardFailed, err?.error || t.adminOvAwardFailedBody);
      }
    } catch (err) {
      console.error(err);
      toast.error(t.adminOvAwardFailed, t.adminOvAwardFailedBody);
    } finally {
      setSubmitting(false);
    }
  };

  const modeButton = (value: Mode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={mode === value}
      disabled={submitting}
      className={`adm-tab${mode === value ? " adm-tab-active" : ""}`}
      style={{ flex: 1, justifyContent: "center", minHeight: 44, color: mode === value && value === "deduct" ? "var(--red-600)" : undefined }}
      onClick={() => setMode(value)}
    >
      <span aria-hidden="true" style={{ display: "inline-flex" }}>{icon}</span>
      {label}
    </button>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      dismissible={!submitting}
      title={fill(t.adminOvAwardTitle, { house: house.label })}
      description={t.adminOvAwardDesc}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            {t.adminUiCancel}
          </button>
          <button
            type="submit"
            form={formId}
            className={mode === "deduct" ? "btn adm-btn-danger-solid" : "btn btn-primary"}
            disabled={submitting}
          >
            {submitting
              ? t.saving
              : amountValid
                ? fill(mode === "deduct" ? t.adminOvSubmitDeduct : t.adminOvSubmitAdd, { n: fmt(amountNum) })
                : t.adminOvConfirmPoints}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="field">
          <span className="adm-field-label" id={`${formId}-mode`}>{t.adminOvActionLabel}</span>
          <div role="group" aria-labelledby={`${formId}-mode`} className="adm-tabs" style={{ marginBottom: 0 }}>
            {modeButton("add", t.adminOvActionAdd, <Plus size={16} />)}
            {modeButton("deduct", t.adminOvActionDeduct, <Minus size={16} />)}
          </div>
        </div>

        <Field
          label={t.adminOvAmountLabel}
          hint={t.adminOvAmountHint}
          error={touched && !amountValid ? t.adminOvInvalidAmount : undefined}
          required
        >
          {(p) => (
            <input
              {...p}
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_AMOUNT}
              step={1}
              value={amount}
              disabled={submitting}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t.adminOvReasonLabel}
          hint={t.adminOvReasonHint}
          error={touched && !reasonTrim ? t.adminOvReasonRequired : undefined}
          required
        >
          {(p) => (
            <input
              {...p}
              className="input"
              type="text"
              placeholder={t.adminOvReasonPlaceholder}
              value={reason}
              disabled={submitting}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>

        <div
          aria-live="polite"
          className={`adm-inline-alert adm-inline-alert-${mode === "deduct" ? "warning" : "info"}`}
          style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
        >
          {amountValid
            ? fill(t.adminOvPreview, { house: house.label, before: fmt(house.points), after: fmt(after) })
            : fill(t.adminOvPreviewIdle, { house: house.label, points: fmt(house.points) })}
        </div>
      </form>
    </Modal>
  );
}
