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

function makeUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    uid: "test-uid",
    email: "test@example.com",
    name: "Test User",
    companyName: "Test Company",
    sector: "brokers",
    role: "user",
    companyRole: "member",
    ...overrides,
  } as AppUser;
}

describe("getCompanyRole", () => {
  it("returns 'member' for null user", () => {
    expect(getCompanyRole(null)).toBe("member");
  });

  it("returns 'member' for undefined user", () => {
    expect(getCompanyRole(undefined)).toBe("member");
  });

  it("returns companyRole when set", () => {
    expect(getCompanyRole(makeUser({ companyRole: "owner" }))).toBe("owner");
    expect(getCompanyRole(makeUser({ companyRole: "admin" }))).toBe("admin");
    expect(getCompanyRole(makeUser({ companyRole: "member" }))).toBe("member");
  });

  it("defaults to 'owner' for legacy admin users without companyRole", () => {
    expect(getCompanyRole(makeUser({ companyRole: undefined, role: "admin" }))).toBe("owner");
  });

  it("defaults to 'member' for legacy non-admin users without companyRole", () => {
    expect(getCompanyRole(makeUser({ companyRole: undefined, role: "user" }))).toBe("member");
  });
});

describe("can", () => {
  it("owner has all standard permissions", () => {
    const owner = makeUser({ companyRole: "owner" });
    expect(can(owner, "route:create")).toBe(true);
    expect(can(owner, "billing:manage")).toBe(true);
    expect(can(owner, "team:manage")).toBe(true);
    expect(can(owner, "profile:edit")).toBe(true);
  });

  it("member cannot edit profiles or manage team", () => {
    const member = makeUser({ companyRole: "member" });
    expect(can(member, "route:create")).toBe(true);
    expect(can(member, "profile:edit")).toBe(false);
    expect(can(member, "team:manage")).toBe(false);
    expect(can(member, "billing:manage")).toBe(false);
  });

  it("admin cannot manage billing", () => {
    const admin = makeUser({ companyRole: "admin" });
    expect(can(admin, "billing:manage")).toBe(false);
    expect(can(admin, "team:manage")).toBe(true);
  });

  it("null user gets member-level permissions", () => {
    expect(can(null, "route:create")).toBe(true);
    expect(can(null, "profile:edit")).toBe(false);
    expect(can(null, "billing:manage")).toBe(false);
  });
});

describe("canAll / canAny", () => {
  it("canAll requires every permission", () => {
    const member = makeUser({ companyRole: "member" });
    expect(canAll(member, ["route:create", "route:view"])).toBe(true);
    expect(canAll(member, ["route:create", "profile:edit"])).toBe(false);
  });

  it("canAny requires at least one permission", () => {
    const member = makeUser({ companyRole: "member" });
    expect(canAny(member, ["profile:edit", "route:create"])).toBe(true);
    expect(canAny(member, ["profile:edit", "billing:manage"])).toBe(false);
  });
});

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

  it("isSuperAdmin checks app-level role, not companyRole", () => {
    expect(isSuperAdmin(makeUser({ role: "admin" }))).toBe(true);
    expect(isSuperAdmin(makeUser({ role: "user" }))).toBe(false);
    expect(isSuperAdmin(makeUser({ companyRole: "owner", role: "user" }))).toBe(false);
  });
});

describe("canManageUser", () => {
  it("owner can manage admin and member", () => {
    const owner = makeUser({ companyRole: "owner" });
    expect(canManageUser(owner, "admin")).toBe(true);
    expect(canManageUser(owner, "member")).toBe(true);
    expect(canManageUser(owner, "owner")).toBe(false);
  });

  it("admin can only manage member", () => {
    const admin = makeUser({ companyRole: "admin" });
    expect(canManageUser(admin, "member")).toBe(true);
    expect(canManageUser(admin, "admin")).toBe(false);
    expect(canManageUser(admin, "owner")).toBe(false);
  });

  it("member cannot manage anyone", () => {
    const member = makeUser({ companyRole: "member" });
    expect(canManageUser(member, "member")).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("owner can assign admin and member", () => {
    expect(assignableRoles(makeUser({ companyRole: "owner" }))).toEqual(["admin", "member"]);
  });

  it("admin can assign member only", () => {
    expect(assignableRoles(makeUser({ companyRole: "admin" }))).toEqual(["member"]);
  });

  it("member cannot assign any roles", () => {
    expect(assignableRoles(makeUser({ companyRole: "member" }))).toEqual([]);
  });
});
