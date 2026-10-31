"use client";

import { useEffect } from "react";
import { ClipboardList } from "lucide-react";
import { EmptyState, InlineAlert, LoadingState, Modal, TabPanel, useToast } from "@/components/admin/ui";
import { EventFormBuilderModalProps } from "./event-form-builder/form-builder-model";
import { useEventFormBuilder } from "./event-form-builder/useEventFormBuilder";
import { FormSelector } from "./event-form-builder/FormSelector";
import { NewFormTypePicker } from "./event-form-builder/NewFormTypePicker";
import { BuilderTabs, BUILDER_TABS_ID } from "./event-form-builder/BuilderTabs";
import { ReviewGateBanner } from "./event-form-builder/ReviewGateBanner";
import { RequestChangesModal } from "./event-form-builder/RequestChangesModal";
import { GeneralSettings } from "./event-form-builder/GeneralSettings";
import { RewardsSettings } from "./event-form-builder/RewardsSettings";
import { ScheduleWindow } from "./event-form-builder/ScheduleWindow";
import { RespondentVisibility } from "./event-form-builder/RespondentVisibility";
import { SFormAssignment } from "./event-form-builder/SFormAssignment";
import { SectionsEditor } from "./event-form-builder/SectionsEditor";
import { BuilderFooter } from "./event-form-builder/BuilderFooter";
import { AutoAwardBanner } from "./event-form-builder/AutoAwardBanner";
import { SubmissionStats } from "./event-form-builder/SubmissionStats";
import { SubmissionsList } from "./event-form-builder/SubmissionsList";
import { ConfirmModal } from "./event-form-builder/ConfirmModal";

// Feedback-form builder for one event. Mounting IS "open", unmounting (via
// onClose) IS "close". The shared kit <Modal> portals itself to <body>, so this
// still pins to the viewport when mounted from admin/clubs and admin/majors
// inside a transformed wrapper.
export function EventFormBuilderModal({ eventId, eventTitle, onClose, onChanged }: EventFormBuilderModalProps) {
  const ctx = useEventFormBuilder({ eventId, eventTitle, onClose, onChanged });
  const { activeFormId, canManageForms, closeFormBuilder, formBuilderError, formBuilderSuccess, formLoading, formReviewSaving, formSaving, formTab, setFormBuilderSuccess, showNewFormPicker, t } = ctx;
  const toast = useToast();

  // Results of an action go to a toast; the success state is consumed so it
  // cannot linger or re-fire.
  useEffect(() => {
    if (!formBuilderSuccess) return;
    toast.success(formBuilderSuccess);
    setFormBuilderSuccess(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formBuilderSuccess]);

  useEffect(() => {
    if (formBuilderError) toast.error(formBuilderError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formBuilderError]);

  const pickingType = showNewFormPicker && !activeFormId;
  // Only a genuine "nothing to show" case for view-only viewers (smo) with zero
  // forms. A manager with activeFormId === null is either mid-pick (above) or
  // drafting a brand-new, not-yet-saved form (see startNewForm) — that must
  // fall through to the editor, not this placeholder.
  const viewOnlyEmpty = !activeFormId && !canManageForms;
  const editing = !formLoading && !pickingType && !viewOnlyEmpty && formTab === "edit" && canManageForms;

  return (
    <>
      <Modal
        open
        onClose={closeFormBuilder}
        dismissible={!formSaving && !formReviewSaving}
        size="xl"
        title={t.adminEvfBuilderTitle.replace("{event}", eventTitle || t.adminEvfEventFallback)}
        description={t.adminEvfBuilderDesc}
        icon={<ClipboardList size={20} />}
        footer={editing ? <BuilderFooter ctx={ctx} /> : undefined}
      >
        {/* Which form of this event, and a way to add another */}
        <FormSelector ctx={ctx} />
        <NewFormTypePicker ctx={ctx} />
        <BuilderTabs ctx={ctx} />

        <div className="pt-4">
          {formLoading ? (
            <LoadingState label={t.fbFetchingData} />
          ) : pickingType ? (
            <EmptyState icon={<ClipboardList size={24} />} title={t.fbSelectFormTypeToStart} description={t.fbSelectFormTypeDesc} />
          ) : viewOnlyEmpty ? (
            <EmptyState icon={<ClipboardList size={24} />} title={t.fbNoFormsYetTitle} description={t.fbNoFormsYetDesc} />
          ) : (
            <TabPanel idBase={BUILDER_TABS_ID} id={formTab}>
              <div className="flex flex-col gap-5">
                {formBuilderError && <InlineAlert tone="error">{formBuilderError}</InlineAlert>}

                {/* Review gate (see forms.reviewStatus in schema.ts) — a president's
                    form stays hidden from participants until staff approves it;
                    editing an approved form sends it back to pending (server-side). */}
                <ReviewGateBanner ctx={ctx} />
                <RequestChangesModal ctx={ctx} />

                {formTab === "edit" && canManageForms ? (
                  <>
                    <GeneralSettings ctx={ctx} />
                    <RewardsSettings ctx={ctx} />
                    {/* Schedule window (auto open/close by date and time) */}
                    <ScheduleWindow ctx={ctx} />
                    {/* Who sees respondent identity (admin/super_admin always do) */}
                    <RespondentVisibility ctx={ctx} />
                    {/* S-form assignment — who may see and fill this skill form */}
                    <SFormAssignment ctx={ctx} />
                    <SectionsEditor ctx={ctx} />
                  </>
                ) : (
                  <>
                    {/* Points are awarded automatically when the close time passes. */}
                    <AutoAwardBanner ctx={ctx} />
                    <SubmissionStats ctx={ctx} />
                    <SubmissionsList ctx={ctx} />
                  </>
                )}
              </div>
            </TabPanel>
          )}
        </div>
      </Modal>

      <ConfirmModal ctx={ctx} />
    </>
  );
}
