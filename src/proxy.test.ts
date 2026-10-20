import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The proxy is the only guard between a signed-in, un-onboarded student and the
// dashboard (there is no layout/page-level check on /dashboard), so these tests pin it.
const state = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown> },
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => state.session) }));
vi.mock("@/lib/site-moved", () => ({ isSiteMoved: vi.fn(() => false) }));

import { proxy } from "@/proxy";

const ORIGIN = "http://localhost:3000";

const student = (profileCompleted: boolean) => ({
  user: { id: "u1", email: "s@example.test", role: "student", roles: ["student"], profileCompleted },
});

async function visit(pathname: string) {
  const res = await proxy(new NextRequest(`${ORIGIN}${pathname}`));
  const location = res.headers.get("location");
  return {
    status: res.status,
    // NextResponse.next() marks pass-through with this header; a redirect never has it.
    passedThrough: res.headers.get("x-middleware-next") === "1",
    redirectedTo: location ? new URL(location).pathname : null,
  };
}

beforeEach(() => {
  state.session = null;
});

describe("proxy: signed-in student who has NOT finished onboarding", () => {
  beforeEach(() => {
    state.session = student(false);
  });

  it.each(["/dashboard", "/", "/dashboard/id"])("redirects %s to /onboarding", async (path) => {
    const r = await visit(path);
    expect(r.redirectedTo).toBe("/onboarding");
    expect(r.status).toBe(307);
  });

  it("does not let the dashboard through", async () => {
    const r = await visit("/dashboard");
    expect(r.passedThrough).toBe(false);
  });

  it("redirects other (non-public) dashboard pages to /onboarding too", async () => {
    const r = await visit("/dashboard/history");
    expect(r.redirectedTo).toBe("/onboarding");
    expect(r.passedThrough).toBe(false);
  });

  it("still lets them open /onboarding and the public /privacy page", async () => {
    expect((await visit("/onboarding")).passedThrough).toBe(true);
    expect((await visit("/privacy")).passedThrough).toBe(true);
  });
});

describe("proxy: signed-in student who HAS finished onboarding", () => {
  beforeEach(() => {
    state.session = student(true);
  });

  it.each(["/dashboard", "/", "/dashboard/id", "/dashboard/history"])(
    "reaches %s with no redirect",
    async (path) => {
      const r = await visit(path);
      expect(r.redirectedTo).toBeNull();
      expect(r.passedThrough).toBe(true);
    },
  );

  it("is sent from /onboarding back to /dashboard", async () => {
    const r = await visit("/onboarding");
    expect(r.redirectedTo).toBe("/dashboard");
  });
});

describe("proxy: logged-out visitor", () => {
  it.each(["/dashboard", "/", "/dashboard/id"])("can still open %s (renders its own sign-in prompt)", async (path) => {
    const r = await visit(path);
    expect(r.redirectedTo).toBeNull();
    expect(r.passedThrough).toBe(true);
  });

  it("is sent to /login from a protected page", async () => {
    const r = await visit("/dashboard/history");
    expect(r.redirectedTo).toBe("/login");
  });
});
