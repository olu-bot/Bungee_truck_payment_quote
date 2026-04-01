import { describe, it, expect } from "vitest";
import {
  getCompanyRole,
  can,
  canAll,
  canAny,
  isManager,
  isOwner,
  isSuperAdmin,
  canManageUser,
  assignableRoles,
} from "./permissions";
import type { AppUser } from "@/components/firebase-auth";

// ── Test fixtures ───────────────────────────────────────────────

function makeUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    uid: "u1",
    email: "test@test.com",
    companyRole: "member",
    ...overrides,
  } as AppUser;
}

// ── getCompanyRole ──────────────────────────────────────────────

describe("getCompanyRole", () => {
  it("returns member for null user", () => {
    expect(getCompanyRole(null)).toBe("member");
  });

  it("returns member for undefined user", () => {
    expect(getCompanyRole(undefined)).toBe("member");
  });

  it("returns the companyRole when set", () => {
    expect(getCompanyRole(makeUser({ companyRole: "owner" }))).toBe("owner");
    expect(getCompanyRole(makeUser({ companyRole: "admin" }))).toBe("admin");
    expect(getCompanyRole(makeUser({ companyRole: "member" }))).toBe("member");
  });

  it("defaults legacy users without companyRole to member (least privilege)", () => {
    const legacyUser = makeUser({ companyRole: undefined } as any);
    expect(getCompanyRole(legacyUser)).toBe("member");
  });

  it("defaults legacy admin-role users without companyRole to member", () => {
    const legacyAdmin = makeUser({ companyRole: undefined, role: "admin" } as any);
    expect(getCompanyRole(legacyAdmin)).toBe("member");
  });
});

// ── can() ───────────────────────────────────────────────────────

describe("can", () => {
  it("owner has all standard permissions", () => {
    const owner = makeUser({ companyRole: "owner" });
    expect(can(owner, "route:create")).toBe(true);
    expect(can(owner, "quote:create")).toBe(true);
    expect(can(owner, "profile:edit")).toBe(true);
    expect(can(owner, "company:edit")).toBe(true);
    expect(can(owner, "team:manage")).toBe(true);
    expect(can(owner, "billing:manage")).toBe(true);
  });

  it("admin has most permissions but not billing", () => {
    const admin = makeUser({ companyRole: "admin" });
    expect(can(admin, "route:create")).toBe(true);
    expect(can(admin, "profile:edit")).toBe(true);
    expect(can(admin, "team:manage")).toBe(true);
    expect(can(admin, "billing:manage")).toBe(false);
  });

  it("member has limited permissions", () => {
    const member = makeUser({ companyRole: "member" });
    expect(can(member, "route:create")).toBe(true);
    expect(can(member, "quote:create")).toBe(true);
    expect(can(member, "profile:edit")).toBe(false);
    expect(can(member, "company:edit")).toBe(false);
    expect(can(member, "team:manage")).toBe(false);
    expect(can(member, "billing:manage")).toBe(false);
  });

  it("no user has admin:viewAllUsers", () => {
    expect(can(makeUser({ companyRole: "owner" }), "admin:viewAllUsers")).toBe(false);
    expect(can(makeUser({ companyRole: "admin" }), "admin:viewAllUsers")).toBe(false);
    expect(can(makeUser({ companyRole: "member" }), "admin:viewAllUsers")).toBe(false);
  });
});

// ── canAll / canAny ─────────────────────────────────────────────

describe("canAll / canAny", () => {
  it("canAll returns true only when user has all permissions", () => {
    const owner = makeUser({ companyRole: "owner" });
    expect(canAll(owner, ["route:create", "billing:manage"])).toBe(true);
    const member = makeUser({ companyRole: "member" });
    expect(canAll(member, ["route:create", "billing:manage"])).toBe(false);
  });

  it("canAny returns true when user has at least one permission", () => {
    const member = makeUser({ companyRole: "member" });
    expect(canAny(member, ["billing:manage", "route:create"])).toBe(true);
    expect(canAny(member, ["billing:manage", "company:edit"])).toBe(false);
  });
});

// ── isManager / isOwner / isSuperAdmin ──────────────────────────

describe("role checks", () => {
  it("isManager returns true for owner and admin", () => {
    expect(isManager(makeUser({ companyRole: "owner" }))).toBe(true);
    expect(isManager(makeUser({ companyRole: "admin" }))).toBe(true);
    expect(isManager(makeUser({ companyRole: "member" }))).toBe(false);
  });

  it("isOwner returns true only for owner", () => {
    expect(isOwner(makeUser({ companyRole: "owner" }))).toBe(true);
    expect(isOwner(makeUser({ companyRole: "admin" }))).toBe(false);
  });

  it("isSuperAdmin checks role field, not companyRole", () => {
    expect(isSuperAdmin(makeUser({ role: "admin" } as any))).toBe(true);
    expect(isSuperAdmin(makeUser({ role: "user" } as any))).toBe(false);
    expect(isSuperAdmin(makeUser({}))).toBe(false);
  });
});

// ── canManageUser / assignableRoles ─────────────────────────────

describe("role management", () => {
  it("owner can manage admins and members but not other owners", () => {
    const owner = makeUser({ companyRole: "owner" });
    expect(canManageUser(owner, "admin")).toBe(true);
    expect(canManageUser(owner, "member")).toBe(true);
    expect(canManageUser(owner, "owner")).toBe(false);
  });

  it("admin can only manage members", () => {
    const admin = makeUser({ companyRole: "admin" });
    expect(canManageUser(admin, "member")).toBe(true);
    expect(canManageUser(admin, "admin")).toBe(false);
    expect(canManageUser(admin, "owner")).toBe(false);
  });

  it("member cannot manage anyone", () => {
    const member = makeUser({ companyRole: "member" });
    expect(canManageUser(member, "member")).toBe(false);
  });

  it("assignableRoles returns correct roles per actor", () => {
    expect(assignableRoles(makeUser({ companyRole: "owner" }))).toEqual(["admin", "member"]);
    expect(assignableRoles(makeUser({ companyRole: "admin" }))).toEqual(["member"]);
    expect(assignableRoles(makeUser({ companyRole: "member" }))).toEqual([]);
  });
});
