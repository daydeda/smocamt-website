import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventsService } from "@/modules/events/events.service";
import { PublicEventView } from "./PublicEventView";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public, logged-out event page (/e/<id>). Public ROUTE; the service returns null
// for anything not open to guests, so restricted events 404 here as well.
// Registration itself still needs a sign-in (handled by /dashboard?event=<id>).
async function loadEvent(id: string) {
  if (!UUID_RE.test(id)) return null;
  return EventsService.getPublicEvent(id);
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
