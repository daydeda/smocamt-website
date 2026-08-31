import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isShopManager } from "@/lib/shop-auth";
import AdminShopClient from "./AdminShopClient";

export const dynamic = "force-dynamic";

// Defense-in-depth on top of the API gate: super_admin/admin get the full shop,
// club_president/major_president get a scoped one (own products + their orders).
// registration/organizer/smo can enter /admin but not touch money/merch.
export default async function AdminShopPage() {
  const session = await auth();
  if (!isShopManager(session)) {
    redirect("/admin/dashboard");
  }
  return <AdminShopClient />;
}
