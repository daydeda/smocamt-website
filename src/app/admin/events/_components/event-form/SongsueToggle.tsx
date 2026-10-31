"use client";

import { ExternalLink } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ChoiceFieldset, OptionRow } from "./FormControls";

export function SongsueToggle({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, editingId, formData, resyncSongsue, set, songsueResyncMessage, songsueResyncing, t } = ctx;
  return (
    <ChoiceFieldset legend={t.adminEvfIntegrations} locked={!canEditRestrictedFields}>
      <OptionRow
        checked={formData.songsueLinked}
        onChange={(checked) => set("songsueLinked", checked)}
        icon={<ExternalLink size={16} />}
        showState
        title={t.songsueLinkedLabel}
        hint={t.songsueLinkedHint}
      />
      {canEditRestrictedFields && editingId && formData.songsueLinked && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-ghost btn-sm" disabled={songsueResyncing} onClick={resyncSongsue}>
            {songsueResyncing && <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14 }} />}
            {songsueResyncing ? t.songsueResyncing : t.songsueResyncButton}
          </button>
          {songsueResyncMessage && (
            <span role="status" className="adm-field-hint">{songsueResyncMessage}</span>
          )}
        </div>
      )}
    </ChoiceFieldset>
  );
}
