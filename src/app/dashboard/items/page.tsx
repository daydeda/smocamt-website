import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import ItemsClient from "./ItemsClient";

export const dynamic = "force-dynamic";

// "My Items": the property tags staff have registered to the signed-in
// student. The list is read with the SESSION user id and nothing the request
// can override, so a student can only ever see their own. See
// docs/features/property-tags.md.
export default async function MyItemsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const rows = await PropertyTagsService.getMyTags(session.user.id);
  const items = rows.map((r) => ({
    label: r.label,
    groupName: r.groupName,
    groupDescription: r.groupDescription,
    assignedAt: r.assignedAt ? r.assignedAt.toISOString() : null,
  }));

  return <ItemsClient items={items} />;
}
