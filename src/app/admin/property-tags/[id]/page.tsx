import { notFound, redirect } from "next/navigation";
import { resolvePropertyTagStaff, UUID_PATTERN } from "@/lib/property-tags/property-tag-access";
import PropertyTagGroupClient from "./PropertyTagGroupClient";

export const dynamic = "force-dynamic";

export default async function PropertyTagGroupPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await resolvePropertyTagStaff())) redirect("/admin");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  return <PropertyTagGroupClient groupId={id} />;
}
