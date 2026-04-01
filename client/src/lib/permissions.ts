/**
 * Role-based permission system for Bungee Connect.
 *
 * Three company roles:
 *   owner  — account creator; full control including billing & team
 *   admin  — operations manager; can manage profiles, yards, and invite/remove members
 *   member — dispatcher/driver; can build routes & quotes, view history
 *
 * Legacy mapping:
 *   - Existing users without `companyRole` default to "owner" on first login.
 *   - The old `role` field ("admin"/"user") is kept for backward compat but
 *     `companyRole` is the single source of truth for permissions.
 */

import type { CompanyRole, AppUser } from "@/components/firebase-auth";

// ── Permission Actions ───────────────────────────────────────────

export type Permission =
  | "route:create"
  | "route:view"
  | "quote:create"
  | "quote:view"
  | "quote:sharePdf"      // generate & download branded PDF quotes (premium)
  | "lane:favorite"
  | "profile:edit"        // cost profiles
  | "profile:view"
  | "company:edit"        // company info, home base, yards
  | "team:view"
  | "team:manage"         // invite, remove, change roles
  | "admin:viewAllUsers"
  | "admin:feedback"
  | "billing:manage";

// ── Permission Matrix ────────────────────────────────────────────

const PERMISSION_MATRIX: Record<CompanyRole, Set<Permission>> = {
  owner: new Set<Permission>([
    "route:create",
    "route:view",
    "quote:create",
    "quote:view",
    "quote:sharePdf",
    "lane:favorite",
    "profile:edit",
    "profile:view",
    "company:edit",
    "team:view",
    "team:manage",
    "billing:manage",
    // admin:viewAllUsers and admin:feedback are Bungee super-admin only — not granted to any company role
  ]),
  admin: new Set<Permission>([
    "route:create",
    "route:view",
    "quote:create",
    "quote:view",
    "quote:sharePdf",
    "lane:favorite",
    "profile:edit",
    "profile:view",
    "company:edit",
    "team:view",
    "team:manage",
  ]),
  member: new Set<Permission>([
    "route:create",
    "route:view",
    "quote:create",
    "quote:view",
    "lane:favorite",
    "profile:view",
    "team:view",
  ]),
};

// ── Helpers ──────────────────────────────────────────────────────

/** Resolve the effective company role — defaults legacy users to "member" (least privilege). */
export function getCompanyRole(user: AppUser | null | undefined): CompanyRole {
  if (!user) return "member";
  return user.companyRole ?? "member";
}

/** Check if the user has a specific permission. */
export function can(user: AppUser | null | undefined, permission: Permission): boolean {
  const role = getCompanyRole(user);
  return PERMISSION_MATRIX[role]?.has(permission) ?? false;
}

/** Check if the user has ALL of the given permissions. */
export function canAll(user: AppUser | null | undefined, permissions: Permission[]): boolean {
  return permissions.every((p) => can(user, p));
}

/** Check if the user has ANY of the given permissions. */
export function canAny(user: AppUser | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((p) => can(user, p));
}

/** Returns true if the user is owner or admin (can manage company-level things). */
export function isManager(user: AppUser | null | undefined): boolean {
  const role = getCompanyRole(user);
  return role === "owner" || role === "admin";
}

/** Returns true if the user is the company owner. */
export function isOwner(user: AppUser | null | undefined): boolean {
  return getCompanyRole(user) === "owner";
}

/** Returns true if the user is a Bungee super-admin (app-level, not company-level). */
export function isSuperAdmin(user: AppUser | null | undefined): boolean {
  return user?.role === "admin";
}

// ── Role Management Rules ────────────────────────────────────────

/** Roles that a given role is allowed to assign or remove. */
const MANAGEABLE_ROLES: Record<CompanyRole, CompanyRole[]> = {
  owner: ["admin", "member"],
  admin: ["member"],
  member: [],
};

/** Can userA change the role of userB? */
export function canManageUser(
  actor: AppUser | null | undefined,
  targetRole: CompanyRole
): boolean {
  const actorRole = getCompanyRole(actor);
  // Owner can manage admins and members
  // Admin can only manage members
  // Member can't manage anyone
  if (actorRole === "owner") return targetRole !== "owner";
  if (actorRole === "admin") return targetRole === "member";
  return false;
}

/** Roles the actor is allowed to assign when inviting or changing a role. */
export function assignableRoles(actor: AppUser | null | undefined): CompanyRole[] {
  const actorRole = getCompanyRole(actor);
  return MANAGEABLE_ROLES[actorRole] ?? [];
}

// ── Role Display ─────────────────────────────────────────────────

export const ROLE_LABELS: Record<CompanyRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export const ROLE_COLORS: Record<CompanyRole, string> = {
  owner: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  admin: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  member: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
};
