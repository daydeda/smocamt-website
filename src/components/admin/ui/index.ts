// Shared admin UI kit. Every admin screen builds on these instead of
// re-implementing modals, alerts, spinners and headers inline.
// Design rules and usage: docs/features/admin-ui-kit.md
export { Modal, type ModalProps, type ModalSize } from "./Modal";
export { IconButton, type IconButtonProps } from "./IconButton";
export { AdminFeedbackProvider, useToast, useConfirm, type ConfirmOptions, type ToastApi, type ToastTone } from "./feedback";
export { PageHeader, Panel, Toolbar, TableScroll } from "./layout";
export { LoadingState, EmptyState, ErrorState, InlineAlert, Skeleton } from "./states";
export { StatCard, StatusBadge, Tabs, TabPanel, Field, type Tone, type TabItem } from "./data";
