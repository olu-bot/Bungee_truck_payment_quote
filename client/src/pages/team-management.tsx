import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth, type CompanyRole } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { firebaseConfigured } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Trash2,
  Mail,
  Shield,
  Crown,
  UserPlus,
  Users,
  Clock,
  X,
  Loader2,
  Send,
  UserMinus,
} from "lucide-react";
import {
  can,
  isOwner,
  isManager,
  getCompanyRole,
  assignableRoles,
  canManageUser,
  ROLE_LABELS,
  ROLE_COLORS,
} from "@/lib/permissions";
import { canInviteTeam, teamMemberLimit, tierLabel, limitLabel } from "@/lib/subscription";
import { UpgradeDialog } from "@/components/UpgradeDialog";

// ── Role badge component ─────────────────────────────────────────

function RoleBadge({ role }: { role: CompanyRole }) {
  const Icon = role === "owner" ? Crown : role === "admin" ? Shield : Users;
  return (
    <Badge
      variant="outline"
      className={`text-xs gap-1 ${ROLE_COLORS[role] || ""}`}
    >
      <Icon className="w-3 h-3" />
      {ROLE_LABELS[role] || role}
    </Badge>
  );
}

// ── Initials avatar ──────────────────────────────────────────────

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const sizeClass = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  return (
    <div
      className={`${sizeClass} rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center shrink-0`}
    >
      {initials || "?"}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export default function TeamManagement() {
  const { toast } = useToast();
  const { user } = useFirebaseAuth();
  const scopeId = workspaceFirestoreId(user);
  const qc = useQueryClient();
  const userRole = getCompanyRole(user);
  const canManageTeam = can(user, "team:manage");

  // ── State ────────────────────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRole>("member");
  const [removeTarget, setRemoveTarget] = useState<{
    uid: string;
    name: string;
  } | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // ── Queries ──────────────────────────────────────────────────
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["firebase", "companyMembers", scopeId ?? ""],
    queryFn: () => firebaseDb.getCompanyMembers(scopeId),
    enabled: !!scopeId && firebaseConfigured,
  });

  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ["firebase", "invites", scopeId ?? ""],
    queryFn: () => firebaseDb.getInvites(scopeId),
    enabled: !!scopeId && firebaseConfigured && canManageTeam,
  });

  const pendingInvites = useMemo(
    () => invites.filter((i) => i.status === "pending"),
    [invites]
  );

  const sortedMembers = useMemo(() => {
    const roleOrder: Record<string, number> = {
      owner: 0,
      admin: 1,
      member: 2,
    };
    return [...members].sort(
      (a, b) =>
        (roleOrder[a.companyRole] ?? 9) - (roleOrder[b.companyRole] ?? 9) ||
        a.name.localeCompare(b.name)
    );
  }, [members]);

  // ── Mutations ────────────────────────────────────────────────

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!scopeId || !user) throw new Error("Not authenticated.");
      const email = inviteEmail.trim().toLowerCase();
      if (!email || !email.includes("@"))
        throw new Error("Please enter a valid email.");

      // Subscription gate
      if (!canInviteTeam(user))
        throw new Error("Upgrade to a paid plan to invite team members.");

      // Check if already a member
      const existing = members.find(
        (m) => m.email.toLowerCase() === email
      );
      if (existing) throw new Error("This person is already on your team.");

      // Check for existing pending invite
      const existingInvite = pendingInvites.find(
        (i) => i.email.toLowerCase() === email
      );
      if (existingInvite)
        throw new Error("An invite is already pending for this email.");

      return firebaseDb.createInvite(scopeId, {
        email,
        role: inviteRole,
        invitedBy: user.uid,
        inviterName: user.name,
        companyName: user.companyName,
        companyId: scopeId,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["firebase", "invites", scopeId ?? ""],
      });
      setInviteEmail("");
      setInviteRole("member");
      setInviteOpen(false);
      toast({
        title: "Invite sent",
        description: `An invitation has been sent to ${inviteEmail.trim()}.`,
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not send invite",
        description: e.message,
        variant: "destructive",
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      if (!scopeId) throw new Error("No workspace.");
      const ok = await firebaseDb.revokeInvite(scopeId, inviteId);
      if (!ok) throw new Error("Invite not found.");
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["firebase", "invites", scopeId ?? ""],
      });
      toast({ title: "Invite revoked" });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not revoke",
        description: e.message,
        variant: "destructive",
      }),
  });

  const changeRoleMutation = useMutation({
    mutationFn: async ({
      uid,
      newRole,
    }: {
      uid: string;
      newRole: CompanyRole;
    }) => {
      await firebaseDb.updateUserCompanyRole(uid, newRole);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["firebase", "companyMembers", scopeId ?? ""],
      });
      toast({ title: "Role updated" });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not change role",
        description: e.message,
        variant: "destructive",
      }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (uid: string) => {
      await firebaseDb.removeUserFromCompany(uid);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["firebase", "companyMembers", scopeId ?? ""],
      });
      setRemoveTarget(null);
      toast({ title: "Team member removed" });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not remove member",
        description: e.message,
        variant: "destructive",
      }),
  });

  // ── Early returns ────────────────────────────────────────────

  if (!firebaseConfigured) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Firebase is not configured — team data lives in Firestore.
      </p>
    );
  }

  const availableRoles = assignableRoles(user);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ─── Header + Invite Button ───────────────────────────── */}
      {canManageTeam && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              {members.length} member{members.length !== 1 ? "s" : ""}
              {pendingInvites.length > 0 &&
                ` · ${pendingInvites.length} pending invite${pendingInvites.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          {canInviteTeam(user) ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const limit = teamMemberLimit(user);
                if (limit !== -1 && members.length >= limit) {
                  setUpgradeOpen(true);
                } else {
                  setInviteOpen(true);
                }
              }}
            >
              <UserPlus className="w-4 h-4" />
              Invite Member
              {teamMemberLimit(user) !== -1 && (
                <span className="text-[10px] opacity-70 ml-1">
                  {members.length}/{teamMemberLimit(user)}
                </span>
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setUpgradeOpen(true)}
            >
              <UserPlus className="w-4 h-4" />
              Invite Member
              <Badge variant="outline" className="text-[10px] ml-1 border-orange-300 text-orange-600">
                Pro
              </Badge>
            </Button>
          )}
        </div>
      )}

      {/* ─── Members List ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-3 sm:px-4 pt-3 sm:pt-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-orange-500" />
            Team Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : sortedMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No team members yet. Invite someone to get started.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {sortedMembers.map((m) => {
                const memberRole = (m.companyRole || "member") as CompanyRole;
                const isCurrentUser = m.uid === user?.uid;
                const canChange = canManageTeam && canManageUser(user, memberRole) && !isCurrentUser;

                return (
                  <div
                    key={m.uid}
                    className="flex items-center gap-3 py-3.5 sm:py-3 first:pt-0 last:pb-0"
                  >
                    <Avatar name={m.name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {m.name}
                        </span>
                        {isCurrentUser && (
                          <span className="text-[10px] text-muted-foreground">(you)</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {m.email}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {canChange ? (
                        <Select
                          value={memberRole}
                          onValueChange={(val) =>
                            changeRoleMutation.mutate({
                              uid: m.uid,
                              newRole: val as CompanyRole,
                            })
                          }
                        >
                          <SelectTrigger className="h-7 w-[110px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* Show current role + roles the actor can assign */}
                            {[memberRole, ...availableRoles]
                              .filter((v, i, a) => a.indexOf(v) === i)
                              .map((r) => (
                                <SelectItem key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <RoleBadge role={memberRole} />
                      )}
                      {canChange && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          title={`Remove ${m.name}`}
                          onClick={() =>
                            setRemoveTarget({ uid: m.uid, name: m.name })
                          }
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Pending Invites ──────────────────────────────────── */}
      {canManageTeam && pendingInvites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Pending Invites
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {pendingInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 py-3.5 sm:py-3 first:pt-0 last:pb-0"
                >
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Send className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {inv.email}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      Invited{" "}
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <RoleBadge role={inv.role as CompanyRole} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      title="Revoke invite"
                      onClick={() => revokeMutation.mutate(inv.id)}
                      disabled={revokeMutation.isPending}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Read-only view for members ───────────────────────── */}
      {!canManageTeam && (
        <p className="text-xs text-muted-foreground text-center">
          Only Owners and Admins can invite or manage team members.
        </p>
      )}

      {/* ─── Invite Dialog ────────────────────────────────────── */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              Enter their email and choose a role. They&apos;ll receive an
              invitation to join your team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && inviteEmail.trim()) {
                    inviteMutation.mutate();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as CompanyRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      <div className="flex flex-col">
                        <span>{ROLE_LABELS[r]}</span>
                        <span className="text-xs text-muted-foreground">
                          {r === "admin"
                            ? "Can manage profiles, yards, and invite members"
                            : "Can build routes and quotes"}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteOpen(false)}
              disabled={inviteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending || !inviteEmail.trim()}
              className="gap-1.5"
            >
              {inviteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Remove Confirmation ──────────────────────────────── */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.name} will lose access to your company&apos;s
              routes, quotes, and equipment cost profiles. This action can be undone by
              re-inviting them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                removeTarget && removeMemberMutation.mutate(removeTarget.uid)
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Upgrade Dialog ─────────────────────────────────────── */}
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        title="Upgrade to add team members"
        description={
          canInviteTeam(user)
            ? `Your Pro plan supports up to ${teamMemberLimit(user)} team members. Upgrade to Premium for unlimited.`
            : "Your Free plan is limited to 1 user. Upgrade to Pro for up to 5 team members, or Premium for unlimited."
        }
      />
    </div>
  );
}
