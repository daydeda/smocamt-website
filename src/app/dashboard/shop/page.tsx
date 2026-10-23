import ShopClient from "./ShopClient";

export const dynamic = "force-dynamic";

// Public: a logged-out visitor gets the browse-only storefront (see GET /api/shop).
// Orders, slips and seller tools are gated inside ShopClient and by their own APIs.
export default function ShopPage() {
  return <ShopClient />;
}
