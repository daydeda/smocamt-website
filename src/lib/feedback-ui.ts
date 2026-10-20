// Client-safe display metadata for Feedback & Complaints — icons, i18n keys,
// and English fallback text for categories/severity/status. Shared by the
// submission form (/feedback/new) and the admin triage queue
// (/admin/feedback) so the two surfaces can't drift on labels/icons. Mirrors
// admin-nav-config.ts's i18nKey+fallback pattern (`tr[key] || fallback`), not
// a new convention.
import {
  Calendar,
  UserX,
  ShieldAlert,
  Trophy,
  ShoppingBag,
  Bug,
  Building2,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import type { FeedbackCategory, FeedbackSeverity, FeedbackStatus } from "@/lib/feedback-token";

export interface FeedbackCategoryMeta {
  id: FeedbackCategory;
  icon: LucideIcon;
  i18nKey: string;
  fallback: string;
  descI18nKey: string;
  descFallback: string;
}

// Order matters — this is the order category cards render in on /feedback/new.
export const FEEDBACK_CATEGORY_META: FeedbackCategoryMeta[] = [
  {
    id: "event", icon: Calendar,
    i18nKey: "feedbackCategoryEvent", fallback: "Event / Activity",
    descI18nKey: "feedbackCategoryEventDesc", descFallback: "Scheduling, on-the-day organization, event safety",
  },
  {
    id: "staff_conduct", icon: UserX,
    i18nKey: "feedbackCategoryStaffConduct", fallback: "Staff / Organizer Conduct",
    descI18nKey: "feedbackCategoryStaffConductDesc", descFallback: "Behavior of an organizer, registration, or other staff member",
  },
  {
    id: "harassment_safety", icon: ShieldAlert,
    i18nKey: "feedbackCategoryHarassmentSafety", fallback: "Harassment / Safety",
    descI18nKey: "feedbackCategoryHarassmentSafetyDesc", descFallback: "Always treated as urgent",
  },
  {
    id: "house_points", icon: Trophy,
    i18nKey: "feedbackCategoryHousePoints", fallback: "House Points / Scoring",
    descI18nKey: "feedbackCategoryHousePointsDesc", descFallback: "Not for no-show strikes — use Appeals for those",
  },
  {
    id: "shop_order", icon: ShoppingBag,
    i18nKey: "feedbackCategoryShopOrder", fallback: "Shop / Order Issue",
    descI18nKey: "feedbackCategoryShopOrderDesc", descFallback: "Payment, delivery, product",
  },
  {
    id: "technical", icon: Bug,
    i18nKey: "feedbackCategoryTechnical", fallback: "Technical / Bug Report",
    descI18nKey: "feedbackCategoryTechnicalDesc", descFallback: "The app isn't working as expected",
  },
  {
    id: "facility", icon: Building2,
    i18nKey: "feedbackCategoryFacility", fallback: "Facility / Venue",
    descI18nKey: "feedbackCategoryFacilityDesc", descFallback: "Physical space or equipment",
  },
  {
    id: "other", icon: MessageCircle,
    i18nKey: "feedbackCategoryOther", fallback: "Other / Suggestion",
    descI18nKey: "feedbackCategoryOtherDesc", descFallback: "Anything else — including positive feedback",
  },
];

export function categoryMeta(id: FeedbackCategory): FeedbackCategoryMeta {
  return FEEDBACK_CATEGORY_META.find((c) => c.id === id) ?? FEEDBACK_CATEGORY_META[FEEDBACK_CATEGORY_META.length - 1];
}

export const FEEDBACK_SEVERITY_META: Record<FeedbackSeverity, { i18nKey: string; fallback: string; color: string; bg: string }> = {
  low: { i18nKey: "feedbackSeverityLow", fallback: "Low", color: "var(--teal-600)", bg: "rgb(var(--teal-500-rgb) / 0.12)" },
  normal: { i18nKey: "feedbackSeverityNormal", fallback: "Normal", color: "var(--indigo-600)", bg: "rgb(var(--indigo-500-rgb) / 0.12)" },
  urgent: { i18nKey: "feedbackSeverityUrgent", fallback: "Urgent", color: "var(--red-600)", bg: "rgb(var(--red-500-rgb) / 0.12)" },
};

export const FEEDBACK_STATUS_META: Record<FeedbackStatus, { i18nKey: string; fallback: string; color: string; bg: string }> = {
  new: { i18nKey: "feedbackStatusNew", fallback: "New", color: "var(--indigo-600)", bg: "rgb(var(--indigo-500-rgb) / 0.12)" },
  in_review: { i18nKey: "feedbackStatusInReview", fallback: "In Review", color: "var(--amber-700)", bg: "rgb(var(--amber-500-rgb) / 0.12)" },
  resolved: { i18nKey: "feedbackStatusResolved", fallback: "Resolved", color: "var(--teal-600)", bg: "rgb(var(--teal-500-rgb) / 0.12)" },
  closed: { i18nKey: "feedbackStatusClosed", fallback: "Closed", color: "var(--gray-500)", bg: "rgb(var(--gray-500-rgb) / 0.12)" },
};
