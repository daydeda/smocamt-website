import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { buildViewer } from "@/lib/access/event-access";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { UsersService } from "@/modules/users/users.service";
import { EventsService } from "@/modules/events/events.service";
import { eventPath, eventRef, parseEventRef } from "@/lib/events/event-slug";
import { summarizeRestrictions, unmetRestrictions } from "@/lib/events/restriction-summary";
import { PublicEventView } from "./PublicEventView";
import { RestrictedEventView, type RestrictedEventInfo } from "./RestrictedEventView";

export const dynamic = "force-dynamic";

// Public event page (/e/<id>). Public ROUTE. Three outcomes:
//  - event exists and this visitor may see it -> guest view, or the dashboard for a
//    signed-in visitor (their theme, account menu and a working Register button);
//  - event exists but this visitor is not eligible -> "you can't access this event"
//    page that lists the requirements and which of them they fail;
//  - no such event -> 404.
// Registration itself still needs a sign-in (handled by /dashboard?event=<id>).
async function loadEvent(ref: string) {
  const returnPath = `/e/${ref}`;
  // Accepts a full UUID (older shares) or the short /e/<slug>-<8 hex> form.
  // An owner-chosen link name wins over the id-based forms.
  const bySlug = await EventsService.findIdByShortSlug(ref.toLowerCase());
  const parsed = bySlug ? null : parseEventRef(ref);
  if (!bySlug && !parsed) return { event: null, restricted: null, signedIn: false };
  const id = bySlug ?? (parsed!.kind === "id" ? parsed!.id : await EventsService.resolveIdByPrefix(parsed!.prefix));
  if (!id) return { event: null, restricted: null, signedIn: false };
  const session = await auth();
  const viewer = session?.user?.id
    ? buildViewer({
        roles: session.user.roles || [session.user.role || "student"],
        studentId: session.user.studentId,
        major: (await UsersService.getMajorById(session.user.id))?.major,
        clubIds: await ClubsService.getMemberClubIds(session.user.id),
      })
    : undefined;
  const signedIn = Boolean(viewer);
  const event = await EventsService.getPublicEvent(id, viewer);
  if (event) return { event, restricted: null, signedIn };

  // Not visible to this viewer. Missing event -> 404; otherwise explain why.
  const source = await EventsService.getEligibilitySource(id);
  if (!source) return { event: null, restricted: null, signedIn };
  const summary = summarizeRestrictions(source);
  const clubNames = (
    await Promise.all(summary.clubIds.map((cid) => ClubsService.getClubName(cid)))
  ).flatMap((c) => (c?.name ? [c.name] : []));
  const restricted: RestrictedEventInfo = {
    title: source.title,
    nationality: summary.nationality,
    roles: summary.roles,
    majors: summary.majors,
    clubNames,
    years: summary.years,
    unmet: viewer ? unmetRestrictions(source, viewer) : [],
    signedIn,
    returnPath,
  };
  return { event: null, restricted, signedIn };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { event } = await loadEvent((await params).id);
  if (!event) return { title: "ActiveCAMT" };
  const description = event.description?.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
  return {
    title: `${event.title} — ActiveCAMT`,
    description,
    alternates: { canonical: eventPath(event.id, event.title, event.shortSlug) },
    openGraph: {
      url: eventPath(event.id, event.title, event.shortSlug),
      title: event.title,
      description,
      type: "website",
      images: event.imageUrls[0] ? [event.imageUrls[0]] : undefined,
    },
  };
}

export default async function PublicEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { event, restricted, signedIn } = await loadEvent((await params).id);
  if (restricted) return <RestrictedEventView event={restricted} />;
  if (!event) notFound();
  // A signed-in visitor gets the real dashboard (their theme, account menu and the
  // event card with a working Register button) instead of a guest page that tells
  // them to sign in and then bounces them there anyway.
  if (signedIn) redirect(`/dashboard?event=${encodeURIComponent(eventRef(event.id, event.title, event.shortSlug))}`);
  return <PublicEventView event={event} />;
}
