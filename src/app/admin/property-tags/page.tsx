import { redirect } from "next/navigation";
import { resolvePropertyTagStaff } from "@/lib/property-tags/property-tag-access";
import PropertyTagsClient from "./PropertyTagsClient";

export const dynamic = "force-dynamic";

// Defense-in-depth on top of the proxy (which lets every scanner-only role
// reach this path) and each API's own gate: presidents/sellers bounce here.
export default async function AdminPropertyTagsPage() {
  if (!(await resolvePropertyTagStaff())) redirect("/admin");
  return <PropertyTagsClient />;
}
