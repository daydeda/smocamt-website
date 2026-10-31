# Admin UI kit and design rules

Every screen under `/admin` is built from one shared kit, `src/components/admin/ui/` (import from `@/components/admin/ui`), plus the base classes in `src/app/globals.css` (`.btn`, `.input`, `.data-table`, …). This page is the rulebook. The `ui-ux-reviewer` agent checks screens against it.

## Who we design for

- **Scanner and shop handover** (`smo`, presidents): a phone, one hand, a queue at the door, often outdoors. Big targets, one obvious next action, results you can read at arm's length.
- **Events, proposals, rosters** (organizers, registration): laptop or tablet, many forms, before and during events.
- **Dashboard, students, clubs, majors, prizes, shop, audit** (admin, super_admin): laptop, long sessions, bulk and destructive actions.
- All users are students or staff who rotate every year, so **assume no training**. The screen has to explain itself.

## The rules (with the Human Factors reason)

1. **One page header.** Use `<PageHeader title description actions />`. There is one `h1` per page, and a one-line description says what the page is for. The primary action goes last in `actions`. *(Consistency, Jakob's law, visual hierarchy.)*
2. **Never `alert()`, `confirm()` or `prompt()`.**
   - Results of an action → `useToast()`: `toast.success("Saved")`, `toast.error("Couldn't approve", serverMessage)`.
   - Decisions → `await useConfirm()({...})`. Name the object, state the consequence, and repeat the verb on the button ("Delete product", not "OK"). Use `tone: "danger"` for destructive actions, which also puts focus on Cancel. Use `requireText` only for irreversible bulk actions.
   - Free-text input (what `prompt()` did) → a small `<Modal>` with a labelled `<Field>`.
   *(Error prevention, Nielsen #5; error recovery, #9; Shneiderman's "permit easy reversal".)*
3. **Every modal is `<Modal>`.** Don't hand-roll a `position: fixed` overlay. It already handles Escape, the focus trap and focus return, scroll lock, ARIA, the bottom sheet on phones, and a sticky footer. In the footer, Cancel goes first and the primary action last. Set `dismissible={false}` while a request is in flight. *(User control and freedom, #3; accessibility.)*
4. **Every async view has three states:**
   - `<LoadingState />` (or `variant="skeleton"` for lists).
   - `<ErrorState onRetry />`, which says what failed and offers Retry.
   - `<EmptyState title description action />`, which says *why* the view is empty and what to do next.
   *(Visibility of system status, #1.)*
5. **Feedback for every action.** A button shows a pending state (`disabled` plus a spinner or "Saving…") and can't be double-submitted. A success always shows a toast or a visible change. Don't call `window.location.reload()` to refresh data; refetch instead. *(Doherty threshold; feedback, Norman.)*
6. **Status is colour + icon + text.** Use `<StatusBadge tone>`. Never use colour alone, because house colours and red/green are not reliable for colour-blind users. *(WCAG 1.4.1.)*
7. **Touch targets are ≥ 44 px.** An icon-only button is `<IconButton label icon />`, and `label` is required: it becomes the `aria-label` and the tooltip. Keep destructive buttons away from frequent ones, never next to them. *(Fitts's law; prevents slips.)*
8. **Limit choices.** Show one primary action per view, and group secondary ones. Use `<Tabs>` for 2–6 parallel views. Hide rare options behind progressive disclosure (an "Advanced" section, a details expander). Break long forms into labelled groups of about 5–9 fields with `<Panel title>`. *(Hick's law; cognitive load.)*
9. **Recognition over recall.** Show the current context in titles and confirmations ("Award points to House Mom"). Keep selected filters visible. Prefill sensible defaults. Use pickers instead of free text where the set is known.
10. **Forms.** Use `<Field label hint error required>{(p) => <input className="input" {...p} />}</Field>`. Every control has a real label, because a placeholder is not a label. Show validation inline, next to the field. Keep the user's input when something fails. Use `inputMode` and `type` so phones show the right keyboard.
11. **Tables.**
    - Wrap a `<table className="data-table">` in `<TableScroll label>` so it scrolls inside itself on phones, not the whole page.
    - Right-align numbers (`className="num"`).
    - For lists that are mostly read on phones, prefer cards below `sm`.
12. **Typography.**
    - Use the kit sizes: page title 24–30 px, panel title 16 px, body 14 px, and secondary text no smaller than 12 px.
    - Use line-height ≥ 1.4 anywhere Thai text may appear, because tall marks get clipped.
    - No uppercase or wide letter-spacing on labels.
    - Don't make a giant number the most prominent thing unless it is what the user came for.
13. **Language.** Admin is **EN + TH only** (`src/lib/i18n/locales/en.ts` and `th.ts`; TH is enforced at compile time). New strings go in the locale files as `t.key`. The older `lang === "th" ? … : …` ternaries are allowed only where a file already uses them heavily, and must never add MM/CN for admin. Use plain, campus words, not DB field names or enum values.
14. **Honest copy.** Never imply CMU-affiliation verification: the `@cmu.ac.th` restriction is not live.
15. **Styling.**
    - Prefer kit components and classes over big inline `style={{}}` blocks.
    - Global CSS in `globals.css` is **unlayered**, so it beats Tailwind utilities. To override `.btn`, `.input` or `.badge` with a Tailwind class, use the `!` suffix (`rounded-full!`) or an inline style.
    - Colours come from tokens (`var(--…)`), never raw hex. Use `alpha()` from `@/lib/ui/color` for translucency.

## What the kit gives you

| Import | Use for |
|---|---|
| `PageHeader` | Page title, description, actions, `back` link, `meta` badges |
| `Panel` | A titled card section (`padded={false}` for tables) |
| `Toolbar` | Search, filters and secondary actions above a list |
| `TableScroll` | Contained horizontal scroll for `.data-table` |
| `StatCard` | A number + its meaning (`hint`), optional `trend`, `href` makes it a link |
| `StatusBadge` | Colour + icon + text status pill |
| `Tabs` / `TabPanel` | Accessible tab bar (arrow keys) and its panel |
| `Field` | Label, hint and error wired to the control |
| `Modal` | Every dialog |
| `useConfirm()` | Replaces `confirm()` |
| `useToast()` | Replaces `alert()` for results |
| `LoadingState` / `Skeleton` | Loading |
| `EmptyState` | Nothing to show + why + next step |
| `ErrorState` | Load failed + Retry |
| `InlineAlert` | A notice inside a form or panel |
| `IconButton` | Icon-only button with a mandatory label |

## Admin-wide CSS already applied

These live in `globals.css` under `:root:has(.admin-shell)`:
- A visible focus ring.
- `--text-muted` darkened on light theme to pass 4.5:1.
- 44 px buttons on touch screens.
- No hover lift on non-link stat cards.
- No uppercase labels.
- Reduced motion respected.

## Hard limits (a redesign never changes these)

- **Access control and data.** Don't change role checks, `fetch` URLs, request bodies, response handling semantics, or which fields each role can see. Server routes, `src/modules/**`, `src/lib/access/**` and `src/db/**` are out of scope for UI work.
- **PDPA.** The registration desk (`smo` + global `registration` position) sees only the medical *signal*. Medical detail stays behind its per-member expand and keeps its audit-logged fetch. Keep any "this access is logged" confirmation, converted to `useConfirm` with the same wording.
- **The scanner's deliberate behaviour** (no native `confirm`, scan cooldowns, camera handling) stays as is.
