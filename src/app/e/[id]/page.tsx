import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { buildViewer } from "@/lib/access/event-access";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { UsersService } from "@/modules/users/users.service";
import { EventsService } from "@/modules/events/events.service";
import { PublicEventView } from "./PublicEventView";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public event page (/e/<id>). Public ROUTE; the service returns null for anything
// the viewer may not see (guest rules when logged out, their own roles when signed
// in), so restricted events 404 here as well.
// Registration itself still needs a sign-in (handled by /dashboard?event=<id>).
async function loadEvent(id: string) {
  if (!UUID_RE.test(id)) return null;
  const session = await auth();
  if (!session?.user?.id) return EventsService.getPublicEvent(id);
  const [me, clubIds] = await Promise.all([
    UsersService.getMajorById(session.user.id),
    ClubsService.getMemberClubIds(session.user.id),
  ]);
  const viewer = buildViewer({
    roles: session.user.roles || [session.user.role || "student"],
    studentId: session.user.studentId,
    major: me?.major,
    clubIds,
  });
  return EventsService.getPublicEvent(id, viewer);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const event = await loadEvent((await params).id);
  if (!event) return { title: "ActiveCAMT" };
  const description = event.description?.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
  return {
    title: `${event.title} — ActiveCAMT`,
    description,
    openGraph: {
      title: event.title,
      description,
      type: "website",
      images: event.imageUrls[0] ? [event.imageUrls[0]] : undefined,
    },
  };
}

export default async function PublicEventPage({ params }: { params: Promise<{ id: string }> }) {
  const event = await loadEvent((await params).id);
  if (!event) notFound();
  return <PublicEventView event={event} />;
}
