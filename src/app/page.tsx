import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { EventsService } from "@/modules/events/events.service";
import { HousesService } from "@/modules/houses/houses.service";
import { AnnouncementService } from "@/modules/announcement/announcement.service";
import { PublicHome } from "@/components/home/PublicHome";

export const dynamic = "force-dynamic";

// "/" — signed-in users go straight to their dashboard (as before). Logged-out
// visitors (the proxy lets "/" through) get the public landing page, built only from
// guest-safe data: upcoming guest-eligible events, team totals and the public
// announcement. No student names are read here.
export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const [events, standings, announcement] = await Promise.all([
    EventsService.listUpcomingPublic(6),
    HousesService.getLeaderboard(),
    AnnouncementService.getCurrent(),
  ]);

  return (
    <PublicHome
      events={events}
      houses={standings.slice(0, 4)}
      announcementBody={announcement?.enabled && announcement.body?.trim() ? announcement.body : null}
    />
  );
}
