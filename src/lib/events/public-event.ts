// Public (logged-out) event view. Pure: picks the only fields a guest may see
// from a full events row. Owner/president metadata, pending edits, staff roster,
// and eligibility lists are deliberately never copied across.

export type PublicEventSource = {
  id: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
  imageUrl: string | null;
  imageUrls: string[] | null;
  quota: number | null;
  registrationOpenTime: Date | null;
  registrationCloseTime: Date | null;
  walkInsOnly: boolean | null;
};

export type PublicEvent = {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  location: string | null;
  imageUrls: string[];
  quota: number | null;
  registeredCount: number;
  registrationOpenTime: string | null;
  registrationCloseTime: string | null;
  walkInsOnly: boolean;
};

export function toPublicEvent(event: PublicEventSource, registeredCount: number): PublicEvent {
  const imageUrls = event.imageUrls ?? (event.imageUrl ? [event.imageUrl] : []);
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    location: event.location,
    imageUrls,
    quota: event.quota,
    registeredCount,
    registrationOpenTime: event.registrationOpenTime?.toISOString() ?? null,
    registrationCloseTime: event.registrationCloseTime?.toISOString() ?? null,
    walkInsOnly: !!event.walkInsOnly,
  };
}
