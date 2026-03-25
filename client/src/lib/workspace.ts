import type { AppUser } from "@/components/firebase-auth";

/** Firestore scope: company workspace id, or user uid as fallback. */
export function workspaceFirestoreId(user: AppUser | null | undefined): string | undefined {
  return user?.companyId ?? user?.uid;
}
