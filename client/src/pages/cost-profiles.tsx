import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { CostProfileWizard } from "@/components/CostProfileWizard";
import { CostDiscoveryWizard } from "@/components/CostDiscoveryWizard";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { safeStorageGet, safeStorageRemove } from "@/lib/safeStorage";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Save,
  Package,
  Snowflake,
  Layers,
  Truck,
  Shield,
  Wrench,
  Fuel,
  Clock,
  User,
  Timer,
  DollarSign,
  Calendar,
  Pencil,
  X,
  ChevronRight,
  Lock,
  Check,
  Loader2,
  Building2,
  MapPin,
  Globe,
  Ruler,
  Container,
  Mail,
  UserCog,
  FileText,
  Phone,
  Upload,
  ImageIcon,
  KeyRound,
  LogOut,
  CreditCard,
  Crown,
  AlertTriangle,
} from "lucide-react";
import type { CostProfile, Yard } from "@shared/schema";
import {
  formatCurrencyAmount,
  localizeMoneySuffix,
  resolveWorkspaceCurrency,
  convertCostProfileCurrency,
  type SupportedCurrency,
} from "@/lib/currency";
import {
  resolveMeasurementUnit,
  displayFuelConsumption,
  fuelConsumptionLabel,
  displayDistance,
  distanceLabel,
  inputToLPer100km,
  type MeasurementUnit,
} from "@/lib/measurement";
import { apiRequest } from "@/lib/queryClient";
import { geocodeLocation } from "@/lib/geo";
import { useLocation } from "wouter";
import { auth } from "@/lib/firebase";
import { updateProfile as firebaseUpdateProfile, verifyBeforeUpdateEmail, sendPasswordResetEmail } from "firebase/auth";
import { can, getCompanyRole, ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions";
import { isPaid, canCustomizePdfTemplate, tierLabel, getUserTier, yardLimit, TIER_LABELS } from "@/lib/subscription";
import { ALL_STATES } from "@/lib/regionalCostData";
import { LocationSuggestInput } from "@/components/LocationSuggestInput";
import { UpgradeDialog } from "@/components/UpgradeDialog";

/** Free tier: two profiles. Third profile and beyond require upgrade. */
const FREE_COST_PROFILE_LIMIT = 2;

// ── Constants ──────────────────────────────────────────────────────

const TRUCK_LABELS: Record<string, string> = {
  dry_van: "Dry Van",
  straight_truck: "Straight Truck",
  reefer: "Reefer",
  flatbed: "Flatbed",
  step_deck: "Step Deck",
  tanker: "Tanker",
};

const TRUCK_ICONS: Record<string, typeof Package> = {
  dry_van: Package,
  straight_truck: Truck,
  reefer: Snowflake,
  flatbed: Layers,
  step_deck: Layers,
  tanker: Container,
};

function computeDerived(p: CostProfile) {
  const monthlyFixed =
    p.monthlyTruckPayment +
    p.monthlyInsurance +
    p.monthlyMaintenance +
    p.monthlyPermitsPlates +
    p.monthlyOther +
    (p.monthlyTrailerLease ?? 0) +
    (p.monthlyEldTelematics ?? 0) +
    (p.monthlyAccountingOffice ?? 0) +
    (p.monthlyTireReserve ?? 0);
  const monthlyHours = p.workingDaysPerMonth * p.workingHoursPerDay;
  const fixedCostPerHour = monthlyHours > 0 ? monthlyFixed / monthlyHours : 0;
  const allInHourlyRate = fixedCostPerHour + p.driverPayPerHour;
  return { monthlyFixed, fixedCostPerHour, allInHourlyRate };
}

// ── All editable field metadata (for detail/edit view) ─────────────

type EditableField = {
  key: keyof CostProfile;
  label: string;
  suffix: string;
  step: string;
  icon: typeof Truck;
  group: string;
};

function getEditableFields(fuelLabel: string, fuelSuffix: string, measureUnit: MeasurementUnit = "imperial"): EditableField[] {
  return [
    { key: "monthlyTruckPayment", label: "Monthly Truck Payment", suffix: "$", step: "100", icon: Truck, group: "Vehicle" },
    { key: "monthlyInsurance", label: "Monthly Insurance", suffix: "$", step: "50", icon: Shield, group: "Insurance & Overhead" },
    { key: "monthlyMaintenance", label: "Monthly Maintenance", suffix: "$", step: "50", icon: Wrench, group: "Insurance & Overhead" },
    { key: "monthlyPermitsPlates", label: "Monthly Permits & Plates", suffix: "$", step: "25", icon: Shield, group: "Insurance & Overhead" },
    { key: "monthlyOther", label: "Monthly Other Costs", suffix: "$", step: "25", icon: DollarSign, group: "Insurance & Overhead" },
    { key: "monthlyTrailerLease", label: "Trailer Lease/Payment", suffix: "$", step: "50", icon: Truck, group: "Advanced Fixed Costs" },
    { key: "monthlyEldTelematics", label: "ELD / Telematics", suffix: "$", step: "10", icon: Shield, group: "Advanced Fixed Costs" },
    { key: "monthlyAccountingOffice", label: "Accounting & Office", suffix: "$", step: "25", icon: DollarSign, group: "Advanced Fixed Costs" },
    { key: "monthlyTireReserve", label: "Tire Reserve", suffix: "$", step: "25", icon: Wrench, group: "Advanced Fixed Costs" },
    { key: "workingDaysPerMonth", label: "Working Days/Month", suffix: "days", step: "1", icon: Calendar, group: "Operations" },
    { key: "workingHoursPerDay", label: "Working Hours/Day", suffix: "hrs", step: "1", icon: Clock, group: "Operations" },
    { key: "driverPayPerHour", label: "Driver Pay/Hour", suffix: "$/hr", step: "1", icon: User, group: "Driver" },
    { key: "driverPayPerMile", label: "Driver Per-Mile Rate", suffix: measureUnit === "imperial" ? "$/mi" : "$/km", step: "0.05", icon: User, group: "Driver" },
    { key: "deadheadPayPercent", label: "Deadhead Rate %", suffix: "%", step: "5", icon: User, group: "Driver" },
    { key: "fuelConsumptionPer100km", label: `Consumption (${fuelLabel})`, suffix: fuelSuffix, step: "1", icon: Fuel, group: "Fuel Consumption" },
    { key: "defaultDockTimeMinutes", label: "Default Dock Time", suffix: "min", step: "15", icon: Timer, group: "Dock & Detention" },
    { key: "detentionRatePerHour", label: "Detention Rate/Hr", suffix: "$/hr", step: "5", icon: Timer, group: "Dock & Detention" },
  ];
}

// ── Section Heading ────────────────────────────────────────────────

function SectionHeading({ icon: Icon, title, subtitle }: { icon: typeof Building2; title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-900">
        <Icon className="w-4 h-4 text-orange-500" />
        {title}
      </h2>
      <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
    </div>
  );
}

// ── Personal Info Section (Name + Email) ──────────────────────────

function AccountIdentityCard() {
  const { user, logout } = useFirebaseAuth();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    if (user) {
      const parts = (user.name || "").trim().split(/\s+/);
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");
      setNewEmail(user.email || "");
      setNewPhone(user.phone || "");
    }
  }, [user]);

  function openEdit() {
    if (user) {
      const parts = (user.name || "").trim().split(/\s+/);
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");
      setNewEmail(user.email || "");
      setNewPhone(user.phone || "");
    }
    setIsEditing(true);
  }

  function cancelEdit() {
    if (user) {
      const parts = (user.name || "").trim().split(/\s+/);
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");
      setNewEmail(user.email || "");
      setNewPhone(user.phone || "");
    }
    setIsEditing(false);
  }

  async function saveAll() {
    if (!user) return;
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (!trimmedFirst) {
      toast({ title: "First name is required", variant: "destructive" });
      return;
    }
    const trimmedEmail = newEmail.trim();
    if (!trimmedEmail) {
      toast({ title: "Email is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // ── Save name + phone to Firestore ──
      const fullName = trimmedLast ? `${trimmedFirst} ${trimmedLast}` : trimmedFirst;
      const nameChanged = fullName !== (user.name || "").trim();
      const phoneChanged = (newPhone.trim() || "") !== (user.phone || "");
      const emailChanged = trimmedEmail.toLowerCase() !== user.email.toLowerCase();

      if (nameChanged || phoneChanged) {
        const updates: Record<string, unknown> = {};
        if (nameChanged) updates.name = fullName;
        if (phoneChanged) updates.phone = newPhone.trim();
        await firebaseDb.updateUserProfile(user.uid, updates);
        const fbUser = auth?.currentUser;
        if (nameChanged && fbUser) await firebaseUpdateProfile(fbUser, { displayName: fullName });
      }

      // ── Email change requires verification ──
      if (emailChanged) {
        const fbUser = auth?.currentUser;
        if (fbUser) {
          try {
            await verifyBeforeUpdateEmail(fbUser, trimmedEmail);
            await firebaseDb.updateUserProfile(user.uid, { email: trimmedEmail });
            toast({
              title: "Verification email sent",
              description: `Check ${trimmedEmail} for a verification link. Your login email won't change until you confirm.`,
            });
          } catch (emailErr: unknown) {
            const msg = emailErr instanceof Error ? emailErr.message : "";
            if (msg.includes("requires-recent-login")) {
              toast({
                title: "Re-authentication required",
                description: "For security, please log out and log back in before changing your email.",
                variant: "destructive",
              });
            } else {
              toast({ title: "Error updating email", description: msg, variant: "destructive" });
            }
            // Name/phone still saved — don't block the rest
          }
        }
      }

      if (nameChanged || phoneChanged) {
        toast({ title: "Profile updated" });
      }
      setIsEditing(false);
      if (nameChanged || phoneChanged) {
        setReloading(true);
        window.location.reload();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast({ title: "Error updating profile", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordReset() {
    if (!user?.email || !auth) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetEmailSent(true);
      toast({
        title: "Password reset email sent",
        description: `Check ${user.email} for a link to reset your password.`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send reset email";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  }

  if (!user) return null;

  if (reloading) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm text-slate-500">Updating profile...</span>
        </div>
      </div>
    );
  }

  const nameParts = (user.name || "").trim().split(/\s+/);
  const initials = ((nameParts[0]?.[0] || "") + (nameParts[1]?.[0] || "")).toUpperCase() || "?";
  const companyRole = getCompanyRole(user);
  const roleLabel = ROLE_LABELS[companyRole];
  const roleColor = ROLE_COLORS[companyRole];
  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;
  const tier = getUserTier(user);
  const tierName = TIER_LABELS[tier];
  const tierBadgeColor = tier === "fleet"
    ? "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700"
    : tier === "pro"
      ? "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700"
      : "bg-slate-100 text-slate-500 border-slate-200";

  return (
    <div className="space-y-4">
      {/* ── Profile Card ─────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {/* Identity Header — avatar + name + role */}
        <div className="bg-gradient-to-r from-orange-500/5 via-orange-500/10 to-orange-500/5 border-b border-slate-200 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-full bg-orange-500/15 flex items-center justify-center ring-2 ring-orange-500/20">
                <span className="text-sm font-bold text-orange-600">{initials}</span>
              </div>
              <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-background" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold truncate">{user.name || "Unnamed"}</h3>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${roleColor}`}>
                  {roleLabel}
                </Badge>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${tierBadgeColor}`}>
                  {tier === "fleet" && <Crown className="w-2.5 h-2.5 mr-0.5" />}
                  {tierName}
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-slate-500 truncate">{user.email}</span>
                {memberSince && (
                  <span className="text-[11px] text-slate-400 hidden sm:inline">
                    Member since {memberSince}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Profile Fields */}
        <CardContent className="p-0">
          {isEditing ? (
            /* ── Edit Mode: all three fields at once ── */
            <div className="px-4 py-3 space-y-4 border-b border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">First Name</label>
                  <Input
                    data-testid="input-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                    className="h-9"
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Last Name</label>
                  <Input
                    data-testid="input-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                    className="h-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Email</label>
                <Input
                  data-testid="input-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="h-9"
                />
                {newEmail.trim().toLowerCase() !== user.email.toLowerCase() && newEmail.trim() && (
                  <p className="text-xs text-amber-600 mt-1">
                    A verification email will be sent to the new address.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Phone Number</label>
                <Input
                  data-testid="input-phone"
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+1 (416) 555-0123"
                  className="h-9"
                />
                <p className="text-xs text-slate-500">Visible to your team and on PDF quotes.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={saveAll} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save Changes
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            /* ── Read Mode: display rows + single Edit button ── */
            <>
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Personal Info</span>
                <Button variant="ghost" size="sm" className="text-slate-500 h-7 px-2 gap-1.5 text-xs" onClick={openEdit}>
                  <Pencil className="w-3 h-3" />
                  Edit
                </Button>
              </div>
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100">
                <User className="w-4 h-4 text-slate-500 shrink-0" />
                <div>
                  <div className="text-xs text-slate-500">Display Name</div>
                  <div className="text-sm font-medium">{user.name || "—"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100">
                <Mail className="w-4 h-4 text-slate-500 shrink-0" />
                <div>
                  <div className="text-xs text-slate-500">Email</div>
                  <div className="text-sm font-medium">{user.email || "—"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100">
                <Phone className="w-4 h-4 text-slate-500 shrink-0" />
                <div>
                  <div className="text-xs text-slate-500">Phone Number</div>
                  <div className="text-sm font-medium">{user.phone || <span className="text-slate-500 italic">Not set</span>}</div>
                </div>
              </div>
            </>
          )}

          {/* Info strip — Role + Company + Auth method */}
          <div className="px-4 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <Shield className="w-4 h-4 text-slate-500 shrink-0" />
                <div>
                  <div className="text-xs text-slate-500">Role</div>
                  <div className="text-sm font-medium">{roleLabel}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Company</div>
                  <div className="text-sm font-medium truncate">{user.companyName || "—"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                <div>
                  <div className="text-xs text-slate-500">Authentication</div>
                  <div className="text-sm font-medium">Email + Password</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Subscription & Plan ──────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <CreditCard className="w-4 h-4 text-slate-500 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Current Plan</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{tierName}</span>
                  <Badge variant="outline" className={`text-[10px] px-2 py-0 border ${tierBadgeColor}`}>
                    {tier === "free" ? "Free forever" : tier === "pro" ? "$29/mo" : "$59/mo"}
                  </Badge>
                </div>
              </div>
            </div>
            {tier !== "fleet" && (
              <Button size="sm" variant="outline" className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950/30" onClick={() => setUpgradeOpen(true)}>
                <Crown className="w-3.5 h-3.5" />
                {tier === "free" ? "Upgrade" : "Upgrade to Premium"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Security ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-0 px-4 pt-3">
          <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Security</CardTitle>
        </CardHeader>
        <CardContent className="p-0 mt-3">
          {/* Change Password */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <KeyRound className="w-4 h-4 text-slate-500 shrink-0" />
              <div>
                <div className="text-sm font-medium">Change Password</div>
                <div className="text-xs text-slate-500">
                  {resetEmailSent
                    ? `Reset link sent to ${user.email}`
                    : "We'll send a password reset link to your email"}
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePasswordReset}
              disabled={resetEmailSent}
              className="gap-1.5"
            >
              {resetEmailSent ? <Check className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
              {resetEmailSent ? "Sent" : "Send Reset Link"}
            </Button>
          </div>

          {/* Sign Out */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <LogOut className="w-4 h-4 text-slate-500 shrink-0" />
              <div>
                <div className="text-sm font-medium">Sign Out</div>
                <div className="text-xs text-slate-500">Sign out of this device</div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={logout}
              className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Danger Zone ──────────────────────────────────────── */}
      <Card className="border-red-200 dark:border-red-900/50">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <div>
                <div className="text-sm font-medium text-red-600 dark:text-red-400">Delete Account</div>
                <div className="text-xs text-slate-500">Permanently delete your account and all data. This cannot be undone.</div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
              onClick={() => {
                toast({
                  title: "Contact support",
                  description: "To delete your account, please email adam@shipbungee.com.",
                });
              }}
            >
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>

      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} title="Upgrade your plan" description="Unlock more features and grow your business." />
    </div>
  );
}

// ── Company Info Section ───────────────────────────────────────────

function CompanyInfoSection() {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const canEditCompany = can(user, "company:edit");
  const [isEditing, setIsEditing] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [fleetSize, setFleetSize] = useState("");
  const [measurementUnit, setMeasurementUnit] = useState("metric");
  const [preferredCurrency, setPreferredCurrency] = useState("CAD");
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (user) {
      setCompanyName(user.companyName || "");
      setFleetSize(user.fleetSize || "");
      setMeasurementUnit(user.measurementUnit || "metric");
      setPreferredCurrency((user as Record<string, unknown>).preferredCurrency as string || resolveWorkspaceCurrency(user));
    }
  }, [user]);

  function startEdit() {
    if (user) {
      setCompanyName(user.companyName || "");
      setFleetSize(user.fleetSize || "");
      setMeasurementUnit(user.measurementUnit || "metric");
      setPreferredCurrency((user as Record<string, unknown>).preferredCurrency as string || resolveWorkspaceCurrency(user));
    }
    setIsEditing(true);
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      await firebaseDb.updateUserProfile(user.uid, {
        companyName,
        fleetSize,
        measurementUnit,
        preferredCurrency,
      });
      toast({ title: "Company info updated" });
      setIsEditing(false);
      // Show full-screen loading overlay, then reload to pick up changes
      setReloading(true);
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast({ title: "Error saving company info", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const FLEET_SIZE_OPTIONS = [
    { value: "1", label: "1 truck" },
    { value: "2-5", label: "2–5 trucks" },
    { value: "6-20", label: "6–20 trucks" },
    { value: "21-50", label: "21–50 trucks" },
    { value: "51+", label: "51+ trucks" },
  ];

  if (reloading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
        <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
        <p className="text-lg font-medium text-foreground">Applying changes...</p>
        <p className="text-sm text-slate-500 mt-1">Updating your preferences</p>
      </div>
    );
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <SectionHeading icon={Building2} title="Company Info" subtitle="Your company name, fleet size, and measurement preferences." />
          {!isEditing && canEditCompany && (
            <Button variant="outline" size="sm" onClick={startEdit} data-testid="company-info-edit">
              <Pencil className="w-3.5 h-3.5 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0 space-y-3">
        {isEditing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> Company Name
                </label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Your company name"
                  data-testid="input-company-name"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5" /> Fleet Size
                </label>
                <Select value={fleetSize} onValueChange={setFleetSize}>
                  <SelectTrigger data-testid="select-fleet-size">
                    <SelectValue placeholder="Select fleet size" />
                  </SelectTrigger>
                  <SelectContent>
                    {FLEET_SIZE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <Ruler className="w-3.5 h-3.5" /> Measurement Unit
                </label>
                <Select value={measurementUnit} onValueChange={setMeasurementUnit}>
                  <SelectTrigger data-testid="select-measurement-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="metric">KM / L (Metric)</SelectItem>
                    <SelectItem value="imperial">MPG (Imperial)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" /> Preferred Currency
                </label>
                <Select value={preferredCurrency} onValueChange={setPreferredCurrency}>
                  <SelectTrigger data-testid="select-preferred-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CAD">CAD (CA$)</SelectItem>
                    <SelectItem value="USD">USD ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> Operating Region
                </label>
                <Input
                  value={[user?.operatingCity, user?.operatingCountryCode].filter(Boolean).join(", ") || "—"}
                  disabled
                  className="bg-slate-50"
                />
                <p className="text-[11px] text-slate-500">Change your city in Home Base below.</p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={saving} className="bg-orange-400 hover:bg-orange-500 text-white">
                {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Saving...</> : <><Save className="w-3.5 h-3.5 mr-1" /> Save Changes</>}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
              <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Company Name</div>
                <div className="text-sm font-medium">{user?.companyName || "—"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
              <Truck className="w-4 h-4 text-slate-500 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Fleet Size</div>
                <div className="text-sm font-medium">{user?.fleetSize || "—"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
              <Ruler className="w-4 h-4 text-slate-500 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Measurement</div>
                <div className="text-sm font-medium">{user?.measurementUnit === "imperial" ? "MPG (Imperial)" : "KM / L (Metric)"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
              <DollarSign className="w-4 h-4 text-slate-500 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Preferred Currency</div>
                <div className="text-sm font-medium">{((user as Record<string, unknown>)?.preferredCurrency as string) === "USD" ? "USD ($)" : "CAD (CA$)"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
              <Globe className="w-4 h-4 text-slate-500 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Operating Region</div>
                <div className="text-sm font-medium">{[user?.operatingCity, user?.operatingCountryCode].filter(Boolean).join(", ") || "—"}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Home Base / Yard Section ──────────────────────────────────────

function HomeBaseSection() {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEditCompanySettings = can(user, "company:edit");
  const scopeId = workspaceFirestoreId(user);

  const { data: yards = [], isLoading } = useQuery<Yard[]>({
    queryKey: ["firebase", "yards", scopeId ?? ""],
    queryFn: () => firebaseDb.getYards(scopeId),
    enabled: !!scopeId,
  });

  const [editingYardId, setEditingYardId] = useState<string | null>(null);
  const [yardName, setYardName] = useState("");
  const [yardAddress, setYardAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingYard, setAddingYard] = useState(false);
  const [yardUpgradeOpen, setYardUpgradeOpen] = useState(false);

  function startEditYard(yard: Yard) {
    setEditingYardId(yard.id);
    setYardName(yard.name);
    setYardAddress(yard.address);
  }

  async function saveYard() {
    if (!editingYardId || !scopeId) return;
    setSaving(true);
    try {
      const coords = await geocodeLocation(yardAddress || yardName);
      await firebaseDb.updateYard(scopeId, editingYardId, {
        name: yardName,
        address: yardAddress,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });
      queryClient.invalidateQueries({ queryKey: ["firebase", "yards", scopeId] });
      setEditingYardId(null);
      toast({ title: "Home base updated" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast({ title: "Error updating yard", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function openAddYardForm() {
    const limit = yardLimit(user);
    if (limit !== -1 && yards.length >= limit) {
      setYardUpgradeOpen(true);
      return;
    }
    setAddingYard(true);
    setYardName("");
    setYardAddress("");
  }

  async function addYard() {
    if (!scopeId) return;
    setSaving(true);
    try {
      // Geocode the address at save time so route builder has coordinates ready
      const coords = await geocodeLocation(yardAddress || yardName);
      await firebaseDb.createYard(scopeId, {
        name: yardName,
        address: yardAddress,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        isDefault: yards.length === 0,
      });
      queryClient.invalidateQueries({ queryKey: ["firebase", "yards", scopeId] });
      setAddingYard(false);
      setYardName("");
      setYardAddress("");
      toast({ title: "Yard added" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add";
      toast({ title: "Error adding yard", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteYard(yardId: string) {
    if (!scopeId) return;
    try {
      await firebaseDb.deleteYard(scopeId, yardId);
      queryClient.invalidateQueries({ queryKey: ["firebase", "yards", scopeId] });
      toast({ title: "Yard removed" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete";
      toast({ title: "Error deleting yard", description: msg, variant: "destructive" });
    }
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <SectionHeading icon={MapPin} title="Home Base" subtitle="Your yards and depot locations. Used for deadhead (return trip) calculations." />
          {canEditCompanySettings && (
            <Button
              variant="outline"
              size="sm"
              onClick={openAddYardForm}
              data-testid="button-add-yard"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Yard
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {isLoading ? (
          <div className="text-sm text-slate-500 py-4 text-center">Loading yards...</div>
        ) : yards.length === 0 && !addingYard ? (
          <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-md">
            <MapPin className="w-7 h-7 text-slate-500 mb-2" />
            <p className="text-sm text-slate-500 mb-3">No home base set yet. Add your first yard or depot.</p>
            <Button
              size="sm"
              className="bg-orange-400 hover:bg-orange-500 text-white"
              onClick={openAddYardForm}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Your First Yard
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {yards.map((yard) => (
              <div key={yard.id} className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
                {editingYardId === yard.id ? (
                  <div className="flex-1 space-y-2">
                    <Input value={yardName} onChange={(e) => setYardName(e.target.value)} placeholder="Yard name" className="h-8" />
                    <LocationSuggestInput value={yardAddress} onChange={setYardAddress} placeholder="Address (e.g. Mississauga, ON)" inputClassName="h-8" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveYard} disabled={saving} className="bg-orange-400 hover:bg-orange-500 text-white">
                        {saving ? "Saving..." : "Save"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingYardId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <MapPin className="w-4 h-4 text-slate-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {yard.name}
                        {yard.isDefault && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{yard.address}</div>
                    </div>
                    {canEditCompanySettings && (
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEditYard(yard)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-500 hover:text-destructive" onClick={() => deleteYard(yard.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            {addingYard && (
              <div className="rounded-md border border-dashed border-slate-200 p-3 space-y-2">
                <Input value={yardName} onChange={(e) => setYardName(e.target.value)} placeholder="Yard name (e.g. Main Depot)" className="h-8" />
                <LocationSuggestInput value={yardAddress} onChange={setYardAddress} placeholder="City (e.g. Mississauga, ON)" inputClassName="h-8" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={addYard} disabled={saving || !yardName.trim()} className="bg-orange-400 hover:bg-orange-500 text-white">
                    {saving ? "Adding..." : "Add Yard"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAddingYard(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
      <UpgradeDialog
        open={yardUpgradeOpen}
        onOpenChange={setYardUpgradeOpen}
        title="Upgrade to add more yards"
        description="Your Free plan includes 1 yard. Upgrade to Pro or Premium for unlimited yards."
      />
    </Card>
  );
}

// ── Accessorial Policy Section (company-wide defaults) ────────────

function AccessorialPolicySection() {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = can(user, "company:edit");
  const scopeId = workspaceFirestoreId(user);
  const currency = useMemo(() => resolveWorkspaceCurrency(user as Record<string, unknown>), [user]);
  const sym = currency === "CAD" ? "CA$" : "$";

  const { data: policy } = useQuery({
    queryKey: ["firebase", "accessorial-policy", scopeId ?? ""],
    queryFn: () => firebaseDb.getAccessorialPolicy(scopeId),
    enabled: !!scopeId,
  });

  const [editing, setEditing] = useState(false);
  const [detentionRate, setDetentionRate] = useState("");
  const [stopOffRate, setStopOffRate] = useState("");
  const [inflationPct, setInflationPct] = useState("");
  const [saving, setSaving] = useState(false);

  function openEdit() {
    setDetentionRate(String(policy?.detentionRate ?? 75));
    setStopOffRate(String(policy?.stopOffRate ?? 75));
    setInflationPct(String(policy?.costInflationPct ?? 0));
    setEditing(true);
  }

  async function save() {
    if (!scopeId) return;
    setSaving(true);
    try {
      await firebaseDb.updateAccessorialPolicy(scopeId, {
        detentionRate: parseFloat(detentionRate) || 75,
        stopOffRate: parseFloat(stopOffRate) || 75,
        costInflationPct: parseFloat(inflationPct) || 0,
      });
      queryClient.invalidateQueries({ queryKey: ["firebase", "accessorial-policy", scopeId] });
      setEditing(false);
      toast({ title: "Accessorial policy updated" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const dr = policy?.detentionRate ?? 75;
  const sr = policy?.stopOffRate ?? 75;
  const ip = policy?.costInflationPct ?? 0;

  return (
    <Card className="border-slate-200">
      <CardHeader className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-900">Accessorial Charges Policy</CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-0.5">
              Company-wide default rates applied to quotes in Advanced mode.
            </CardDescription>
          </div>
          {canEdit && !editing && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={openEdit}>
              <Pencil className="w-3 h-3 mr-1" /> Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-500">Detention Rate</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">{sym}</span>
                  <Input className="h-8 text-sm" type="number" min="0" step="5" value={detentionRate} onChange={(e) => setDetentionRate(e.target.value)} />
                  <span className="text-xs text-slate-500 whitespace-nowrap">/hr</span>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-500">Stop-Off Rate</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">{sym}</span>
                  <Input className="h-8 text-sm" type="number" min="0" step="5" value={stopOffRate} onChange={(e) => setStopOffRate(e.target.value)} />
                  <span className="text-xs text-slate-500 whitespace-nowrap">/stop</span>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-500">Surcharge %</label>
                <div className="flex items-center gap-1.5">
                  <Input className="h-8 text-sm" type="number" min="0" max="100" step="0.5" value={inflationPct} onChange={(e) => setInflationPct(e.target.value)} />
                  <span className="text-xs text-slate-500">%</span>
                </div>
                <span className="text-[10px] text-slate-500">Hazmat, regulatory surcharges</span>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={save} disabled={saving} className="bg-orange-400 hover:bg-orange-500 text-white">
                {saving ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Saving...</> : <><Save className="w-3 h-3 mr-1" /> Save</>}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-[11px] text-slate-500">Detention Rate</div>
              <div className="text-sm font-medium">{sym}{dr}/hr</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Stop-Off Rate</div>
              <div className="text-sm font-medium">{sym}{sr}/stop</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Surcharge</div>
              <div className="text-sm font-medium">{ip > 0 ? `${ip}%` : "None"}</div>
              {ip > 0 && <div className="text-[10px] text-slate-500">Hazmat / regulatory</div>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── PDF Quote Template Section ─────────────────────────────────────

function PdfTemplateSection() {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = can(user, "company:edit");
  const scopeId = workspaceFirestoreId(user);
  const [pdfUpgradeOpen, setPdfUpgradeOpen] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["firebase", "pdfTemplate", scopeId ?? ""],
    queryFn: () => firebaseDb.getPdfTemplate(scopeId),
    enabled: !!scopeId,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<firebaseDb.PdfTemplateSettings>(firebaseDb.DEFAULT_PDF_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      toast({ title: "Logo too large", description: "Please use an image under 500 KB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      updateField("logoBase64", base64);
    };
    reader.readAsDataURL(file);
    // Reset the input so the same file can be re-selected
    e.target.value = "";
  }

  function startEdit() {
    if (settings) setForm({ ...settings });
    setIsEditing(true);
  }

  function updateField<K extends keyof firebaseDb.PdfTemplateSettings>(
    key: K,
    value: firebaseDb.PdfTemplateSettings[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!scopeId) return;
    setSaving(true);
    try {
      await firebaseDb.savePdfTemplate(scopeId, form);
      queryClient.invalidateQueries({ queryKey: ["firebase", "pdfTemplate", scopeId] });
      toast({ title: "PDF template saved" });
      setIsEditing(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast({ title: "Error saving template", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const s = settings ?? firebaseDb.DEFAULT_PDF_TEMPLATE;

  function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="flex items-center gap-2.5 group cursor-pointer"
      >
        <div className={`w-9 h-5 rounded-full relative transition-colors ${checked ? "bg-orange-400" : "bg-slate-300"}`}>
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </div>
        <span className="text-sm text-foreground group-hover:text-foreground/80">{label}</span>
      </button>
    );
  }

  const paidTemplate = canCustomizePdfTemplate(user);

  return (
    <Card className="border-slate-200">
      <CardHeader className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <SectionHeading
            icon={FileText}
            title="Quote PDF Template"
            subtitle="Customize how your PDF quotes look when shared with customers."
          />
          <div className="flex items-center gap-2">
            {!paidTemplate && (
              <Badge variant="outline" className="text-[10px] text-orange-600 border-orange-300">
                Pro
              </Badge>
            )}
            {paidTemplate && canEdit && !isEditing && (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="w-3.5 h-3.5 mr-1" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {!paidTemplate ? (
          <div className="text-center py-8 space-y-3">
            <FileText className="w-8 h-8 text-slate-500/40 mx-auto" />
            <p className="text-sm text-slate-500">Customize your PDF quotes with your logo, branding, and terms.</p>
            <Button variant="outline" size="sm" onClick={() => setPdfUpgradeOpen(true)} className="gap-1.5">
              Upgrade to Pro
            </Button>
            <UpgradeDialog
              open={pdfUpgradeOpen}
              onOpenChange={setPdfUpgradeOpen}
              title="Upgrade to customize PDF templates"
              description="Branded quote PDFs with your logo and custom terms are available on Pro and Premium plans."
            />
          </div>
        ) : isLoading ? (
          <div className="text-sm text-slate-500 py-6 text-center">Loading template...</div>
        ) : isEditing ? (
          <div className="space-y-5">
            {/* ── Branding ── */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widerr mb-3">Branding</h4>
              {/* Logo upload */}
              <div className="flex items-start gap-4 mb-4">
                <div className="shrink-0">
                  {form.logoBase64 ? (
                    <div className="relative group">
                      <img
                        src={form.logoBase64}
                        alt="Company logo"
                        className="w-20 h-20 object-contain rounded-lg border border-slate-200 bg-white p-1"
                      />
                      <button
                        type="button"
                        onClick={() => updateField("logoBase64", "")}
                        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-200 hover:border-orange-400 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <Upload className="w-5 h-5 text-slate-500" />
                      <span className="text-[10px] text-slate-500">Logo</span>
                    </button>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                </div>
                <div className="flex-1 space-y-1 pt-1">
                  <p className="text-xs font-medium text-slate-500">Company Logo</p>
                  <p className="text-[11px] text-slate-500/60">
                    PNG, JPG, or SVG — max 500 KB. Appears in the top-left corner of your PDF quotes.
                  </p>
                  {form.logoBase64 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2 mt-1"
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <Upload className="w-3 h-3 mr-1" />
                      Replace
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Business Name on PDF</label>
                  <Input
                    value={form.businessName}
                    onChange={(e) => updateField("businessName", e.target.value)}
                    placeholder={user?.companyName || "Your company name"}
                    className="h-9"
                  />
                  <p className="text-[11px] text-slate-500/60">Leave blank to use your company name.</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Tagline</label>
                  <Input
                    value={form.tagline}
                    onChange={(e) => updateField("tagline", e.target.value)}
                    placeholder="e.g. Reliable freight, every time"
                    className="h-9"
                  />
                </div>
              </div>
            </div>

            {/* ── Contact Info ── */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widerr mb-3">Contact Info on PDF</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Phone
                  </label>
                  <Input
                    value={form.contactPhone}
                    onChange={(e) => updateField("contactPhone", e.target.value)}
                    placeholder="(555) 123-4567"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Email
                  </label>
                  <Input
                    value={form.contactEmail}
                    onChange={(e) => updateField("contactEmail", e.target.value)}
                    placeholder={user?.email || "dispatch@company.com"}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Full Address
                  </label>
                  <Input
                    value={form.address}
                    onChange={(e) => updateField("address", e.target.value)}
                    placeholder="123 Main St, Mississauga, ON L5B 2C9"
                    className="h-9"
                  />
                </div>
              </div>
            </div>

            {/* ── Quote Terms ── */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widerr mb-3">Quote Terms</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Quote Valid For</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      value={form.validityDays}
                      onChange={(e) => updateField("validityDays", parseInt(e.target.value) || 7)}
                      className="h-9 w-20"
                    />
                    <span className="text-sm text-slate-500">days</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Payment Terms</label>
                  <Select value={form.paymentTerms} onValueChange={(v) => updateField("paymentTerms", v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Net 15">Net 15</SelectItem>
                      <SelectItem value="Net 30">Net 30</SelectItem>
                      <SelectItem value="Net 45">Net 45</SelectItem>
                      <SelectItem value="Net 60">Net 60</SelectItem>
                      <SelectItem value="Due on receipt">Due on receipt</SelectItem>
                      <SelectItem value="COD">COD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Detention</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={form.freeDetentionHours}
                      onChange={(e) => updateField("freeDetentionHours", parseInt(e.target.value) || 0)}
                      className="h-9 w-16"
                    />
                    <span className="text-xs text-slate-500">free hrs, then $</span>
                    <Input
                      type="number"
                      min={0}
                      value={form.detentionRate}
                      onChange={(e) => updateField("detentionRate", parseInt(e.target.value) || 0)}
                      className="h-9 w-20"
                    />
                    <span className="text-xs text-slate-500">/hr</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Clause Toggles ── */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widerr mb-3">Include Clauses</h4>
              <div className="space-y-2.5">
                <ToggleSwitch
                  checked={form.showFuelClause}
                  onChange={(v) => updateField("showFuelClause", v)}
                  label="Fuel surcharge adjustment clause (based on DOE index)"
                />
                <ToggleSwitch
                  checked={form.showAccessorialClause}
                  onChange={(v) => updateField("showAccessorialClause", v)}
                  label="Accessorial charges clause (lumper, TONU, layover)"
                />
              </div>
            </div>

            {/* ── Custom Terms ── */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widerr mb-3">Additional Terms</h4>
              <Textarea
                value={form.customTerms}
                onChange={(e) => updateField("customTerms", e.target.value)}
                placeholder="Add any extra terms or notes — one per line. These appear at the bottom of the Terms & Conditions section."
                className="min-h-[80px] text-sm"
              />
            </div>

            {/* ── Footer ── */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widerr mb-3">Footer</h4>
              <Input
                value={form.footerNote}
                onChange={(e) => updateField("footerNote", e.target.value)}
                placeholder="e.g. Thank you for choosing Smith Trucking!"
                className="h-9"
              />
            </div>

            {/* Save / Cancel */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
              <Button onClick={handleSave} disabled={saving} className="gap-1.5 bg-orange-400 hover:bg-orange-500 text-white">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Template
              </Button>
              <Button variant="ghost" onClick={() => setIsEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          /* ── Read-only view ── */
          <div className="space-y-4">
            {/* Logo + Business Name header */}
            <div className="flex items-center gap-4">
              {s.logoBase64 ? (
                <img
                  src={s.logoBase64}
                  alt="Company logo"
                  className="w-14 h-14 rounded-lg object-contain border border-slate-200 bg-white"
                />
              ) : (
                <div className="w-14 h-14 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-slate-500/40" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-base font-semibold truncate">{s.businessName || user?.companyName || "—"}</div>
                {s.tagline && <div className="text-xs text-slate-500 truncate">{s.tagline}</div>}
              </div>
            </div>

            {/* Contact details grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <Phone className="w-4 h-4 text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Phone</div>
                  <div className="text-sm font-medium truncate">{s.contactPhone || "Not set"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <Mail className="w-4 h-4 text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Email</div>
                  <div className="text-sm font-medium truncate">{s.contactEmail || user?.email || "—"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <MapPin className="w-4 h-4 text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Address</div>
                  <div className="text-sm font-medium truncate">{s.address || "Not set"}</div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Terms summary */}
            <div className="text-sm space-y-1.5">
              <div className="flex items-center gap-2 text-slate-500">
                <Clock className="w-3.5 h-3.5" />
                <span>Quote valid for <span className="font-medium text-foreground">{s.validityDays} days</span></span>
              </div>
              <div className="flex items-center gap-2 text-slate-500">
                <DollarSign className="w-3.5 h-3.5" />
                <span>Payment terms: <span className="font-medium text-foreground">{s.paymentTerms}</span></span>
              </div>
              <div className="flex items-center gap-2 text-slate-500">
                <Timer className="w-3.5 h-3.5" />
                <span>Detention: <span className="font-medium text-foreground">{s.freeDetentionHours}h free, then ${s.detentionRate}/hr</span></span>
              </div>
              <div className="flex items-center gap-2 text-slate-500">
                <Fuel className="w-3.5 h-3.5" />
                <span>Fuel surcharge clause: <span className="font-medium text-foreground">{s.showFuelClause ? "Yes" : "No"}</span></span>
              </div>
              <div className="flex items-center gap-2 text-slate-500">
                <Truck className="w-3.5 h-3.5" />
                <span>Accessorial clause: <span className="font-medium text-foreground">{s.showAccessorialClause ? "Yes" : "No"}</span></span>
              </div>
              {s.customTerms && (
                <div className="flex items-start gap-2 text-slate-500 pt-1">
                  <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-xs uppercase tracking-widerr">Custom terms:</span>
                    <p className="text-foreground text-xs mt-0.5 whitespace-pre-line">{s.customTerms}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────

type ViewMode = "list" | "wizard" | "detail";
type SettingsTab = "account" | "company" | "pdf-template";

const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: "account", label: "Account" },
  { key: "company", label: "Company" },
  { key: "pdf-template", label: "PDF Template" },
];

export default function CostProfiles() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useFirebaseAuth();
  const canEditProfiles = can(user, "profile:edit");
  const isPaidTier = isPaid(user);
  const canCreateUnlimitedProfiles = isPaidTier;
  const scopeId = workspaceFirestoreId(user);
  const currency = useMemo(() => resolveWorkspaceCurrency(user as Record<string, unknown>), [user]);
  const measureUnit = useMemo(() => resolveMeasurementUnit(user), [user]);

  // Derive the ISO state code from the user's company operating region (e.g. "Ontario" → "ON")
  const defaultStateCode = useMemo(() => {
    const regionName = user?.operatingRegions?.[0];
    if (!regionName) return undefined;
    const match = ALL_STATES.find(
      (s) => s.name.toLowerCase() === regionName.toLowerCase() || s.code.toLowerCase() === regionName.toLowerCase()
    );
    return match?.code;
  }, [user]);

  const formatCurrency = useCallback(
    (value: number) => formatCurrencyAmount(value, currency),
    [currency]
  );
  const EDITABLE_FIELDS = useMemo(
    () => getEditableFields(fuelConsumptionLabel(measureUnit), measureUnit === "imperial" ? "MPG" : "L", measureUnit),
    [measureUnit]
  );

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Auto-open wizard if redirected from signup onboarding
    if (safeStorageGet("bungee_open_cost_wizard", "local") === "1") {
      safeStorageRemove("bungee_open_cost_wizard", "local");
      return "wizard";
    }
    // Support deep-linking: /#/profiles?action=create
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      const qIdx = hash.indexOf("?");
      if (qIdx >= 0) {
        const params = new URLSearchParams(hash.slice(qIdx + 1));
        if (params.get("action") === "create") return "wizard";
      }
    }
    return "list";
  });
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallMsg, setPaywallMsg] = useState({ title: "", description: "" });
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    // Support deep-linking: /#/profiles?tab=company
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      const qIdx = hash.indexOf("?");
      if (qIdx >= 0) {
        const params = new URLSearchParams(hash.slice(qIdx + 1));
        const tab = params.get("tab");
        if (tab === "company" || tab === "pdf-template") return tab;
      }
    }
    return "account";
  });
  const stripeReturnToastDone = useRef(false);
  const [, setLocation] = useLocation();

  // ── Queries & Mutations ────────────────────────────────────────

  const { data: profiles = [], isLoading } = useQuery<CostProfile[]>({
    queryKey: ["firebase", "profiles", scopeId ?? ""],
    queryFn: () => firebaseDb.getProfiles(scopeId),
    enabled: !!scopeId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<CostProfile, "id">) => {
      const existing = await firebaseDb.getProfiles(scopeId);
      if (!canCreateUnlimitedProfiles && existing.length >= FREE_COST_PROFILE_LIMIT) {
        throw new Error(
          "Your plan includes one equipment cost profile. Upgrade to create additional profiles."
        );
      }
      return firebaseDb.createProfile(scopeId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "profiles", scopeId ?? ""] });
      setViewMode("list");
      toast({ title: "Profile created", description: "Your equipment cost profile has been saved." });
    },
    onError: (err: Error) => {
      const msg = err.message;
      if (msg.includes("Upgrade to create additional")) {
        setPaywallMsg({ title: "Upgrade to add more equipment cost profiles", description: "Your Free plan includes 2 equipment cost profiles. Upgrade to Pro or Premium for unlimited." });
        setPaywallOpen(true);
        return;
      }
      toast({ title: "Error creating profile", description: msg, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CostProfile> }) => {
      const updated = await firebaseDb.updateProfile(scopeId, id, data);
      if (!updated) throw new Error("Profile not found");
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "profiles", scopeId ?? ""] });
      setIsEditing(false);
      toast({ title: "Profile updated", description: "Changes have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error updating profile", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const ok = await firebaseDb.deleteProfile(scopeId, id);
      if (!ok) throw new Error("Profile not found");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "profiles", scopeId ?? ""] });
      if (viewMode === "detail") {
        setViewMode("list");
        setSelectedProfileId(null);
      }
      toast({ title: "Profile deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error deleting profile", description: err.message, variant: "destructive" });
    },
  });

  // ── Detail/Edit helpers ─────────────────────────────────────────

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  function startEditingProfile(profile: CostProfile) {
    const vals: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) {
      // Convert fuel consumption to display unit for editing
      if (f.key === "fuelConsumptionPer100km") {
        const displayVal = displayFuelConsumption(profile[f.key] as number, measureUnit);
        vals[f.key] = String(Math.round(displayVal * 10) / 10);
      } else {
        const val = profile[f.key];
        vals[f.key] = val != null ? String(val) : "";
      }
    }
    setEditValues(vals);
    setIsEditing(true);
  }

  function saveEditedProfile() {
    if (!selectedProfileId) return;
    const payload: Record<string, number> = {};
    for (const f of EDITABLE_FIELDS) {
      const raw = Number(editValues[f.key]);
      // Convert fuel consumption from display unit back to L/100km for storage
      if (f.key === "fuelConsumptionPer100km") {
        payload[f.key] = Math.round(inputToLPer100km(raw, measureUnit) * 100) / 100;
      } else {
        payload[f.key] = raw;
      }
    }
    updateMutation.mutate({ id: selectedProfileId, data: payload });
  }

  function openCreateProfileFlow() {
    if (!canCreateUnlimitedProfiles && profiles.length >= FREE_COST_PROFILE_LIMIT) {
      setPaywallMsg({ title: "Upgrade to add more equipment cost profiles", description: "Your Free plan includes 2 equipment cost profiles. Upgrade to Pro or Premium for unlimited." });
      setPaywallOpen(true);
      return;
    }
    setViewMode("wizard");
  }

  useEffect(() => {
    function consumeStripeCheckoutReturn() {
      if (typeof window === "undefined") return;
      const hash = window.location.hash;
      const qIdx = hash.indexOf("?");
      if (qIdx === -1) return;
      const params = new URLSearchParams(hash.slice(qIdx + 1));
      const checkout = params.get("checkout");
      if (checkout !== "success" && checkout !== "cancel") return;
      if (stripeReturnToastDone.current) return;
      stripeReturnToastDone.current = true;
      if (checkout === "success") {
        toast({
          title: "Checkout complete",
          description: "Thanks! Your subscription is processing. It may take a minute to sync with your account.",
        });
      } else {
        toast({
          title: "Checkout cancelled",
          description: "You can upgrade anytime from Company Profile.",
        });
      }
      const pathOnly = hash.slice(0, qIdx);
      window.history.replaceState(null, "", window.location.pathname + pathOnly);
    }
    consumeStripeCheckoutReturn();
    window.addEventListener("hashchange", consumeStripeCheckoutReturn);
    return () => window.removeEventListener("hashchange", consumeStripeCheckoutReturn);
  }, [toast]);

  useEffect(() => {
    if (isLoading || !scopeId) return;
    if (viewMode !== "wizard") return;
    if (!canCreateUnlimitedProfiles && profiles.length >= FREE_COST_PROFILE_LIMIT) {
      setViewMode("list");
      setPaywallMsg({ title: "Upgrade to add more equipment cost profiles", description: "Your Free plan includes 2 equipment cost profiles. Upgrade to Pro or Premium for unlimited." });
      setPaywallOpen(true);
    }
  }, [isLoading, scopeId, viewMode, profiles.length, canCreateUnlimitedProfiles]);

  // ── Render: Cost Profile List ─────────────────────────────────

  function renderProfileList() {
    return (
      <Card className="border-slate-200">
        <CardHeader className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <SectionHeading
              icon={Truck}
              title="Equipment Cost Profiles"
              subtitle="Each profile represents an equipment type with its operating costs. These are used when calculating route quotes."
            />
            {canEditProfiles && (
              <Button
                size="sm"
                className="bg-orange-400 hover:bg-orange-500 text-white"
                data-testid="button-create-profile"
                onClick={openCreateProfileFlow}
              >
                <Plus className="w-4 h-4 mr-1" />
                Create Profile
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {isLoading ? (
            <div className="text-xs text-slate-400 py-8 text-center">Loading profiles...</div>
          ) : profiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-slate-200 rounded-md">
              <Truck className="w-8 h-8 text-slate-400 mb-3" />
              <p className="text-sm font-medium mb-1">No equipment cost profiles yet</p>
              <p className="text-xs text-slate-500 max-w-sm mb-4">
                An equipment cost profile captures your truck's monthly expenses, driver pay, and fuel consumption so Bungee can calculate accurate per-trip pricing.
              </p>
              <Button
                size="sm"
                className="bg-orange-400 hover:bg-orange-500 text-white"
                data-testid="button-create-first-profile"
                onClick={openCreateProfileFlow}
              >
                <Plus className="w-4 h-4 mr-1" />
                Create Your First Profile
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {profiles.map((profile) => {
                const Icon = TRUCK_ICONS[profile.truckType] || Package;
                // Convert money fields to the user's display currency
                const profileCurrency = (profile.currency as SupportedCurrency) || "USD";
                const displayProfile = convertCostProfileCurrency(profile, profileCurrency, currency) as CostProfile;
                const derived = computeDerived(displayProfile);

                return (
                  <Card
                    key={profile.id}
                    className="border-slate-200 cursor-pointer hover:border-primary/50 transition-colors"
                    data-testid={`card-profile-${profile.id}`}
                    onClick={() => {
                      setSelectedProfileId(profile.id);
                      setIsEditing(false);
                      setViewMode("detail");
                    }}
                  >
                    <CardHeader className="px-3 pt-3 pb-2">
                      <CardTitle className="text-xs font-medium flex items-center justify-between">
                        <span className="flex items-center gap-2 truncate text-slate-900">
                          <Icon className="w-4 h-4 shrink-0" />
                          {profile.name}
                        </span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {TRUCK_LABELS[profile.truckType] || profile.truckType}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3 pt-0 space-y-1.5 text-[13px]">
                      <div className="flex justify-between">
                        <span className="text-slate-500">All-in hourly</span>
                        <span className="font-medium">{formatCurrency(derived.allInHourlyRate)}/hr</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Fuel className="w-3 h-3" /> Consumption
                        </span>
                        <span className="font-medium">{Math.round(displayFuelConsumption(profile.fuelConsumptionPer100km, measureUnit) * 10) / 10} {fuelConsumptionLabel(measureUnit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Monthly fixed</span>
                        <span className="font-medium">{formatCurrency(derived.monthlyFixed)}</span>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-slate-400">View details</span>
                        <div className="flex items-center gap-1">
                          {canEditProfiles && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-slate-500 hover:text-destructive"
                              data-testid={`button-delete-profile-${profile.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteMutation.mutate(profile.id);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <ChevronRight className="w-4 h-4 text-slate-500" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Render: Wizard ──────────────────────────────────────────────

  function renderWizard() {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Create Equipment Cost Profile</h2>
        <CostDiscoveryWizard
          currency={currency}
          measurementUnit={measureUnit}
          defaultValues={defaultStateCode ? { stateCode: defaultStateCode } : undefined}
          onSave={(data) => createMutation.mutate(data)}
          onBack={() => setViewMode("list")}
          backLabel="Back"
          isSaving={createMutation.isPending}
        />
      </div>
    );
  }

  // ── Render: Detail / Edit View ──────────────────────────────────

  function renderDetail() {
    if (!selectedProfile) {
      return (
        <div className="text-sm text-slate-500 py-8 text-center">
          Profile not found.
          <Button variant="link" size="sm" onClick={() => setViewMode("list")}>
            Back to list
          </Button>
        </div>
      );
    }

    const Icon = TRUCK_ICONS[selectedProfile.truckType] || Package;
    // Convert money fields to the user's display currency
    const profileCurrency = (selectedProfile.currency as SupportedCurrency) || "USD";
    const displayProfile = convertCostProfileCurrency(selectedProfile, profileCurrency, currency) as CostProfile;
    const derived = computeDerived(displayProfile);

    // Group fields for display
    const groups: Record<string, EditableField[]> = {};
    for (const f of EDITABLE_FIELDS) {
      if (!groups[f.group]) groups[f.group] = [];
      groups[f.group].push(f);
    }

    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              data-testid="detail-back-to-list"
              onClick={() => {
                setViewMode("list");
                setSelectedProfileId(null);
                setIsEditing(false);
              }}
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Icon className="w-5 h-5 text-orange-500" />
              <h2 className="text-sm font-semibold text-slate-900">{selectedProfile.name}</h2>
              <Badge variant="secondary" className="text-[10px]">
                {TRUCK_LABELS[selectedProfile.truckType] || selectedProfile.truckType}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button
                  size="sm"
                  data-testid="detail-save-edit"
                  disabled={updateMutation.isPending}
                  onClick={saveEditedProfile}
                  className="bg-orange-400 hover:bg-orange-500 text-white"
                >
                  <Save className="w-4 h-4 mr-1" />
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="detail-cancel-edit"
                  onClick={() => setIsEditing(false)}
                >
                  <X className="w-4 h-4 mr-1" />
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {canEditProfiles && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="detail-edit-button"
                      onClick={() => startEditingProfile(selectedProfile)}
                    >
                      <Pencil className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-500 hover:text-destructive"
                      data-testid={`detail-delete-profile-${selectedProfile.id}`}
                      onClick={() => deleteMutation.mutate(selectedProfile.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="border-slate-200">
            <CardContent className="p-3">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">All-in Hourly Rate</div>
              <div className="text-base font-semibold">{formatCurrency(derived.allInHourlyRate)}/hr</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-3">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Fuel Consumption</div>
              <div className="text-base font-semibold">{selectedProfile.fuelConsumptionPer100km} L/100km</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-3">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Monthly Fixed Total</div>
              <div className="text-base font-semibold">{formatCurrency(derived.monthlyFixed)}</div>
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* All fields grouped */}
        <div className="space-y-4">
          {Object.entries(groups).map(([groupName, fields]) => (
            <section key={groupName} className="space-y-2">
              <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{groupName}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {fields.map((f) => {
                  const FieldIcon = f.icon;
                  // Use currency-converted profile for money fields
                  let rawValue = displayProfile[f.key] as number | undefined;
                  // Convert fuel consumption to display unit
                  if (f.key === "fuelConsumptionPer100km" && rawValue != null) {
                    rawValue = Math.round(displayFuelConsumption(rawValue, measureUnit) * 10) / 10;
                  }
                  // Handle undefined/null for optional fields (e.g. old profiles missing driverPayPerMile)
                  const isMoneyField = f.suffix === "$" || f.suffix === "$/hr" || f.suffix === "$/L"
                    || f.suffix === "$/mi" || f.suffix === "$/km";
                  const displayValue =
                    rawValue == null || rawValue === undefined
                      ? "—"
                      : isMoneyField
                        ? formatCurrency(rawValue as number)
                        : `${rawValue} ${f.suffix}`;

                  return (
                    <div
                      key={f.key}
                      className="flex items-center justify-between rounded-md border border-slate-200 p-3"
                      data-testid={`detail-field-${f.key}`}
                    >
                      <span className="text-xs flex items-center gap-2 text-slate-500">
                        <FieldIcon className="w-3.5 h-3.5" />
                        {f.label}
                      </span>
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <Input
                            data-testid={`detail-input-${f.key}`}
                            type="number"
                            step={f.step}
                            className="w-28 text-right h-8"
                            value={editValues[f.key] ?? ""}
                            onChange={(e) =>
                              setEditValues((prev) => ({
                                ...prev,
                                [f.key]: e.target.value,
                              }))
                            }
                          />
                          {f.suffix ? (
                            <span className="text-xs text-slate-500 whitespace-nowrap">
                              {localizeMoneySuffix(f.suffix, currency) ?? f.suffix}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-sm font-medium">{displayValue}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  // ── Main Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-3" data-testid="cost-profiles-page">
      {/* Tab navigation — visible on list view */}
      {viewMode === "list" && (
        <>
          <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                data-testid={`tab-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? "border-orange-500 text-slate-900"
                    : "border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "account" && <AccountIdentityCard />}
          {activeTab === "company" && (
            <div className="space-y-3">
              <CompanyInfoSection />
              <HomeBaseSection />
              <AccessorialPolicySection />
              {renderProfileList()}
            </div>
          )}
          {activeTab === "pdf-template" && <PdfTemplateSection />}
        </>
      )}
      {viewMode === "wizard" && renderWizard()}
      {viewMode === "detail" && renderDetail()}

      <UpgradeDialog
        open={paywallOpen}
        onOpenChange={setPaywallOpen}
        title={paywallMsg.title || "Upgrade your plan"}
        description={paywallMsg.description || "Unlock more features to grow your business."}
      />
    </div>
  );
}
