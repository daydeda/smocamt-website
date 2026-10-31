"use client";

import { FileText, Trophy } from "lucide-react";
import { Tabs, type TabItem } from "@/components/admin/ui";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export const BUILDER_TABS_ID = "evf-builder";

export function BuilderTabs({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { canManageForms, formSubmissions, formTab, setFormTab, t } = ctx;
  const tabs: TabItem<"edit" | "stats">[] = [
    ...(canManageForms ? [{ id: "edit" as const, label: t.adminEvfTabDesign, icon: <FileText size={16} /> }] : []),
    { id: "stats" as const, label: t.adminEvfTabResults, icon: <Trophy size={16} />, count: formSubmissions.length },
  ];
  return (
    <div className="sticky top-0 z-[2] -mx-1 px-1 pb-3 pt-1" style={{ background: "var(--bg-surface)" }}>
      <Tabs tabs={tabs} value={formTab} onChange={setFormTab} ariaLabel={t.adminEvfTabsLabel} idBase={BUILDER_TABS_ID} />
    </div>
  );
}
