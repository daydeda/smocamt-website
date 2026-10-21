import { notFound, redirect } from "next/navigation";
import { resolvePropertyTagStaff, UUID_PATTERN } from "@/lib/property-tag-access";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import PrintSheet from "./PrintSheet";

export const dynamic = "force-dynamic";

// The A4 sticker sheet, saved/printed with the browser (⌘P), like the prize
// report. Carries no personal data — only codes and serials — so it isn't
// audit-logged; every label printed here is still empty until a staff scan.
export default async function PropertyTagPrintPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await resolvePropertyTagStaff())) redirect("/admin");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await PropertyTagsService.getGroup(id);
  if (!data) notFound();

  return (
    <PrintSheet
      groupId={id}
      groupName={data.group.name}
      tags={data.tags.map((tg) => ({ code: tg.code, series: tg.series, serial: tg.serial, empty: !tg.ownerId }))}
    />
  );
}
