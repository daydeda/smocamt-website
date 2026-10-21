import { describe, it, expect } from "vitest";
import { serializePushPayload, PushNotificationPayload } from "./push-payload";

describe("serializePushPayload", () => {
  it("round-trips a normal payload correctly via JSON.parse", () => {
    const payload: PushNotificationPayload = {
      title: "New Order",
      body: "Your order has been confirmed",
      url: "/dashboard/shop/orders/123",
      tag: "order-123",
    };
    const serialized = serializePushPayload(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.title).toBe("New Order");
    expect(parsed.body).toBe("Your order has been confirmed");
    expect(parsed.url).toBe("/dashboard/shop/orders/123");
    expect(parsed.tag).toBe("order-123");
  });

  it("falls back to 'ActiveCAMT' when title is empty", () => {
    const payload: PushNotificationPayload = {
      title: "",
      body: "Some notification body",
      url: "/path",
    };
    const serialized = serializePushPayload(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.title).toBe("ActiveCAMT");
  });

  it("falls back to 'ActiveCAMT' when title is whitespace-only", () => {
    const payload: PushNotificationPayload = {
      title: "   \t\n  ",
      body: "Some body",
      url: "/path",
    };
    const serialized = serializePushPayload(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.title).toBe("ActiveCAMT");
  });

  it("falls back to '/' when url is falsy", () => {
    const payload: PushNotificationPayload = {
      title: "Test",
      body: "Test body",
      url: "",
    };
    const serialized = serializePushPayload(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.url).toBe("/");
  });

  it("trims the body", () => {
    const payload: PushNotificationPayload = {
      title: "Test",
      body: "   Trimmed body   ",
      url: "/",
    };
    const serialized = serializePushPayload(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.body).toBe("Trimmed body");
  });

  it("passes through tag when defined", () => {
    const payload: PushNotificationPayload = {
      title: "Test",
      body: "Body",
      url: "/",
      tag: "event-456",
    };
    const serialized = serializePushPayload(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.tag).toBe("event-456");
  });

  it("passes through tag as undefined when not provided", () => {
    const payload: PushNotificationPayload = {
      title: "Test",
      body: "Body",
      url: "/",
    };
    const serialized = serializePushPayload(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.tag).toBeUndefined();
  });

  it("handles a payload with all default values", () => {
    const payload: PushNotificationPayload = {
      title: "",
      body: "",
      url: "",
    };
    const serialized = serializePushPayload(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.title).toBe("ActiveCAMT");
    expect(parsed.body).toBe("");
    expect(parsed.url).toBe("/");
    expect(parsed.tag).toBeUndefined();
  });

  it("trims whitespace from title but preserves non-whitespace content", () => {
    const payload: PushNotificationPayload = {
      title: "  Important Update  ",
      body: "Content",
      url: "/",
    };
    const serialized = serializePushPayload(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.title).toBe("Important Update");
  });
});
