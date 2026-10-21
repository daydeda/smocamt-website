import type { Metadata } from "next";
import { auth } from "@/auth";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import { normalizeTagCode } from "@/lib/property-tag";
import { rateLimit } from "@/lib/rate-limit";
import { captureException } from "@/lib/logger";
import TagView, { type TagViewState } from "./TagView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Property tag — ActiveCAMT",
  // Owner names must never end up in a search index or a link preview.
  robots: { index: false, follow: false },
};

// Landing page for a printed property-tag sticker (the QR encodes /t/<code>).
// Public ROUTE, not public data (see src/proxy.ts): a logged-out visitor only
// gets a sign-in prompt that returns here, and only a signed-in, onboarded
// viewer sees the owner — and then only name, รหัสนักศึกษา, major and year.
// Rate-limited per viewer so a signed-in account can't sweep codes.
export default async function PropertyTagPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = normalizeTagCode(decodeURIComponent(rawCode));
  const callbackUrl = `/t/${code ?? encodeURIComponent(rawCode)}`;

  let state: TagViewState;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      state = { kind: "signed_out" };
    } else if (!session.user.profileCompleted) {
      state = { kind: "needs_profile" };
    } else if (!code) {
      state = { kind: "invalid" };
    } else {
      const limit = await rateLimit(`property-tag:${session.user.id}`, 30, 60_000);
      if (!limit.success) {
        state = { kind: "rate_limited" };
      } else {
        const view = await PropertyTagsService.getPublicView(code, session.user.id);
        state =
          view.status === "assigned"
            ? { kind: "assigned", isMine: view.isMine, owner: view.owner }
            : view.status === "unassigned"
              ? { kind: "unassigned" }
              : { kind: "invalid" };
      }
    }
  } catch (e) {
    captureException(e, { route: "GET /t/[code]" });
    state = { kind: "error" };
  }

  return <TagView state={state} callbackUrl={callbackUrl} />;
}
