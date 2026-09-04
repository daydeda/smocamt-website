import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: null as AuthConfig | null,
  findUser: vi.fn(),
  findClubPositions: vi.fn(),
  updateWhere: vi.fn(),
}));

type SignInUser = {
  id?: string;
  email?: string | null;
};

type JwtToken = Record<string, unknown>;

type AuthConfig = {
  callbacks: {
    signIn(args: { user: SignInUser }): Promise<boolean>;
    jwt(args: {
      token: JwtToken;
      user?: SignInUser;
      trigger?: "signIn" | "signUp" | "update";
    }): Promise<JwtToken | null>;
  };
};

vi.mock("next-auth", () => ({
  default: (config: AuthConfig) => {
    state.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));

vi.mock("next-auth/providers/google", () => ({ default: vi.fn(() => ({})) }));
vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn(() => ({})) }));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: vi.fn(() => ({})) }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNotNull: vi.fn(),
}));
vi.mock("@/db/schema", () => ({
  accounts: {},
  sessions: {},
  users: {},
  verificationTokens: {},
  clubMembers: {},
}));
vi.mock("@/db", () => ({
  db: {
    query: {
      users: { findFirst: state.findUser },
      clubMembers: { findMany: state.findClubPositions },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: state.updateWhere })),
    })),
  },
}));
vi.mock("@/modules/audit/audit.service", () => ({
  AuditService: { log: vi.fn() },
}));
vi.mock("@/lib/site-moved", () => ({ isSiteMoved: vi.fn(() => false) }));
vi.mock("@/db/guard", () => ({ isRemoteDatabase: vi.fn(() => false) }));

await import("@/auth");

function callbacks() {
  if (!state.config) throw new Error("NextAuth configuration was not captured");
  return state.config.callbacks;
}

beforeEach(() => {
  state.findUser.mockReset();
  state.findClubPositions.mockReset();
  state.updateWhere.mockReset();
});

describe("authentication callbacks", () => {
  it("allows Gmail and other Google email domains", async () => {
    state.findUser.mockResolvedValue(null);

    await expect(callbacks().signIn({ user: { email: "student@gmail.com" } })).resolves.toBe(true);
    await expect(callbacks().signIn({ user: { email: "person@example.com" } })).resolves.toBe(true);
  });

  it("invalidates a new JWT when its database user no longer exists", async () => {
    state.findUser.mockResolvedValue(null);

    await expect(
      callbacks().jwt({ token: {}, user: { id: "deleted-user" }, trigger: "signIn" })
    ).resolves.toBeNull();
  });

  it("invalidates an existing JWT when its database user no longer exists", async () => {
    state.findUser.mockResolvedValue(null);

    await expect(
      callbacks().jwt({
        token: {
          id: "deleted-user",
          profileCompleted: true,
          lastDbRefresh: 0,
        },
      })
    ).resolves.toBeNull();
  });
});
