import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import sharp from "sharp";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SLIP_COUNT = 850; // past the old 500 cap

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "admin-1" } })) }));
vi.mock("@/lib/shop/shop-scope", () => ({
  resolveShopAccess: vi.fn(async () => ({ ok: true, unscoped: true, userId: "admin-1", scope: null, sellerId: null })),
  classifyOrdersByScope: vi.fn(),
}));
vi.mock("@/lib/shop/shop-auth", () => ({ isProductOwnedByScope: vi.fn(() => true) }));
vi.mock("@/modules/audit/audit.service", () => ({
  AuditService: { logAction: vi.fn(async () => undefined) },
  getClientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/util/logger", () => ({ captureException: vi.fn() }));

let inFlight = 0;
let maxInFlight = 0;
vi.mock("@/lib/shop/shop-storage", () => ({
  downloadSlip: vi.fn(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 0));
    const buffer = await sharp({ create: { width: 40, height: 60, channels: 3, background: "#fff" } }).webp().toBuffer();
    inFlight--;
    return { buffer, contentType: "image/webp" };
  }),
}));
vi.mock("@/modules/shop/shop-admin.service", () => ({
  ShopAdminService: {
    getProductWithOwnership: vi.fn(async () => ({ id: PRODUCT_ID, name: "Test shirt" })),
    listOrderLinesForProductExport: vi.fn(async () =>
      Array.from({ length: SLIP_COUNT }, (_, i) => ({
        orderId: `order-${i}`, status: "approved", createdAt: new Date(), reviewedAt: null, rejectionReason: null,
        orderTotal: 100, slipPath: `slip-${i}.webp`, slipFlag: null, slipQrPayload: null, note: null,
        fulfillment: "pickup", shippingFee: 0, discountAmount: 0, recipientName: null, recipientPhone: null,
        shippingAddress: null, variantLabel: "M", customValues: [], quantity: 1, unitPrice: 100,
        buyerName: `Buyer ${i}`, nickname: null, studentId: null, email: null, phone: null, major: null, houseId: null,
      })),
    ),
  },
}));

import { GET } from "./route";

describe("product export with many slips", () => {
  it(`embeds every slip past the old cap (${SLIP_COUNT}), a few at a time`, async () => {
    const res = await GET(new Request("http://localhost/export"), { params: Promise.resolve({ id: PRODUCT_ID }) });
    expect(res.status).toBe(200);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const slips = wb.getWorksheet("Slips")!;
    expect(slips.getImages()).toHaveLength(SLIP_COUNT);

    const text = JSON.stringify(slips.getSheetValues());
    expect(text).not.toContain("not embedded");
    expect(text).not.toContain("could not load");
    expect(maxInFlight).toBeLessThanOrEqual(6);
  }, 120_000);
});
