import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isShopManager } from "@/lib/shop/shop-auth";
import ProductOrdersClient from "./ProductOrdersClient";

export const dynamic = "force-dynamic";

// Per-product order/slip view. Same defense-in-depth gate as /admin/shop; the
// orders API still applies the authoritative DB-backed scope on every request.
export default async function AdminShopProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const session = await auth();
  if (!isShopManager(session)) {
    redirect("/admin/dashboard");
  }
  const { productId } = await params;
  return <ProductOrdersClient productId={productId} />;
}
