import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isShopManager } from "@/lib/shop-auth";
import AdminShopClient from "./AdminShopClient";

export const dynamic = "force-dynamic";

// Defense-in-depth on top of the API gate: super_admin/admin and SMO Finance get
// the full shop; approved sellers and club/major presidents get their scoped shop.
// Every API still resolves the authoritative DB-backed scope independently.
export default async function AdminShopPage() {
  const session = await auth();
  if (!isShopManager(session)) {
    redirect("/admin/dashboard");
  }
  return <AdminShopClient />;
}
