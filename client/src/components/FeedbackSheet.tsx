import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFirebaseAuth } from "@/components/firebase-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import * as firebaseDb from "@/lib/firebaseDb";
import type { FeedbackTicket } from "@/lib/firebaseDb";
import { firebaseConfigured } from "@/lib/firebase";
import { workspaceFirestoreId } from "@/lib/workspace";

type FeedbackCategory = "feature" | "bug" | "improvement" | "other";
type FeedbackPriority = "low" | "medium" | "high";

const CATEGORIES: { id: FeedbackCategory; label: string }[] = [
  { id: "feature", label: "Feature Request" },
  { id: "bug", label: "Bug Report" },
  { id: "improvement", label: "Improvement" },
  { id: "other", label: "Other" },
];

const AREAS: { value: string; label: string }[] = [
  { value: "", label: "Select an area (optional)" },
  { value: "quoting", label: "Route Quoting" },
  { value: "cost-profile", label: "Cost Profiles" },
  { value: "pricing", label: "Pricing / Margins" },
  { value: "ai-chatbot", label: "AI Chatbot" },
  { value: "team", label: "Team Management" },
  { value: "onboarding", label: "Onboarding / Signup" },
  { value: "billing", label: "Billing / Subscription" },
  { value: "ui", label: "User Interface / Design" },
  { value: "mobile", label: "Mobile Experience" },
  { value: "other", label: "Other" },
];

type FeedbackSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FeedbackSheet({ open, onOpenChange }: FeedbackSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useFirebaseAuth();
  const [userName, setUserName] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>("feature");
  const [priority, setPriority] = useState<FeedbackPriority>("medium");
  const [area, setArea] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const scopeId = workspaceFirestoreId(user as Record<string, unknown>);

  const { data: tickets = [] } = useQuery<FeedbackTicket[]>({
    queryKey: ["firebase", "feedback", "user", user?.uid ?? "", scopeId ?? ""],
    queryFn: () => firebaseDb.listFeedbackForUser(user?.uid, scopeId),
    enabled: Boolean(user?.uid && firebaseConfigured),
  });

  useEffect(() => {
    if (open) {
      if (user?.name) setUserName((prev) => prev || user.name);
      void queryClient.invalidateQueries({ queryKey: ["firebase", "feedback", "user", user?.uid ?? ""] });
    }
  }, [open, user?.name, user?.uid, queryClient]);

  useEffect(() => {
    if (!open) {
      setSuccess((wasSuccess) => {
        if (wasSuccess) {
          setSubject("");
          setDescription("");
          setArea("");
          setCategory("feature");
          setPriority("medium");
        }
        return false;
      });
    }
  }, [open]);

  function resetForm() {
    setSuccess(false);
    setSubject("");
    setDescription("");
    setArea("");
    setCategory("feature");
    setPriority("medium");
    setUserName(user?.name ?? "");
  }

  async function handleSubmit() {
    const subj = subject.trim();
    const desc = description.trim();
    if (!subj || !desc) {
      return;
    }
    if (!firebaseConfigured || !user?.uid) {
      toast({ variant: "destructive", title: "Not available", description: "Firebase is not configured." });
      return;
    }

    setSubmitting(true);
    try {
      await firebaseDb.createFeedbackTicket(user.uid, scopeId, {
        companyId: user.companyId,
        companyName: user.companyName?.trim() ?? "",
        name: userName.trim(),
        email: user.email?.trim() ?? "",
        category,
        subject: subj,
        description: desc,
        priority,
        area,
      });
      await queryClient.invalidateQueries({ queryKey: ["firebase", "feedback"] });
      setSuccess(true);
      toast({ title: "Feedback sent", description: "Our team will review it in the admin inbox." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not send feedback",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const formatTicketDate = useCallback((iso: string) => {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto max-h-screen flex flex-col gap-0 p-0"
      >
        <div className="p-6 pb-4 border-b border-border">
          <SheetHeader className="text-left space-y-1">
            <SheetTitle>Help Us Build What You Need</SheetTitle>
            <SheetDescription>
              Your feedback shapes Bungee Connect. Report a bug, request a feature, or tell us how we can improve
              your quoting workflow.
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {!success ? (
            <>
              <div className="flex flex-wrap justify-center gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    className={cn(
                      "px-4 py-2 rounded-full text-xs font-semibold border transition-colors",
                      category === c.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-muted-foreground/50"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-sm">
                <div className="space-y-2">
                  <Label htmlFor="feedback-name">Your Name</Label>
                  <Input
                    id="feedback-name"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="John Smith"
                    autoComplete="name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="feedback-subject">
                    Subject <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="feedback-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g., Add multi-stop route support"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="feedback-desc">
                    Description <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="feedback-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what you'd like to see, the problem you're facing, or the bug you encountered. The more detail, the better we can help."
                    className="min-h-[120px] resize-y"
                  />
                  <p className="text-xs text-muted-foreground">
                    Be as specific as possible. Include steps to reproduce for bugs.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Priority</Label>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["low", "Low", "border-green-500 text-green-600 bg-green-500/10"],
                        ["medium", "Medium", "border-amber-500 text-amber-600 bg-amber-500/10"],
                        ["high", "High", "border-red-500 text-red-600 bg-red-500/10"],
                      ] as const
                    ).map(([id, label, activeCls]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPriority(id)}
                        className={cn(
                          "flex-1 min-w-[calc(50%-4px)] sm:flex-none sm:min-w-0 px-3 py-2.5 rounded-md border text-sm font-semibold transition-colors",
                          priority === id ? activeCls : "border-border bg-background text-muted-foreground hover:border-muted-foreground/40"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="feedback-area">Which area of Bungee Connect?</Label>
                  <Select
                    value={area || "__none__"}
                    onValueChange={(v) => setArea(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger id="feedback-area" className="w-full">
                      <SelectValue placeholder="Select an area (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select an area (optional)</SelectItem>
                      {AREAS.filter((a) => a.value !== "").map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                  <p className="text-xs text-muted-foreground order-2 sm:order-1">
                    Saved to your account. Admins are notified in the Feedback inbox.
                  </p>
                  <Button
                    type="button"
                    className="order-1 sm:order-2 shrink-0"
                    onClick={() => void handleSubmit()}
                    disabled={submitting || !subject.trim() || !description.trim()}
                  >
                    {submitting ? "Sending…" : "Submit Feedback"}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-border bg-card p-8 text-center space-y-4 shadow-sm">
              <div className="mx-auto w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-7 h-7 stroke-green-600" fill="none" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <h2 className="text-xl font-bold">Thank you for your feedback!</h2>
              <p className="text-sm text-muted-foreground">
                We read every submission. You can track replies below when our team responds in the app or by email.
              </p>
              <Button type="button" variant="outline" onClick={resetForm}>
                Submit Another
              </Button>
            </div>
          )}

          {tickets.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-bold">Your feedback</h3>
              <ul className="space-y-3">
                {tickets.map((sub) => {
                  const badgeClass =
                    sub.category === "bug"
                      ? "bg-red-500/10 text-red-600"
                      : sub.category === "feature"
                        ? "bg-green-500/10 text-green-600"
                        : sub.category === "improvement"
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-muted text-muted-foreground";
                  const label =
                    sub.category === "feature"
                      ? "Feature"
                      : sub.category === "bug"
                        ? "Bug"
                        : sub.category === "improvement"
                          ? "Improve"
                          : "Other";
                  return (
                    <li
                      key={sub.id}
                      className="rounded-lg border border-border bg-card p-3 text-left space-y-2"
                    >
                      <div className="flex items-start gap-3">
                        <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold uppercase shrink-0", badgeClass)}>
                          {label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold">{sub.subject}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatTicketDate(sub.createdAt)} · {sub.priority} priority
                            {sub.area ? ` · ${sub.area}` : ""}
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-primary whitespace-nowrap shrink-0">
                          {sub.adminReply ? "Replied" : "Received"}
                        </span>
                      </div>
                      {sub.adminReply ? (
                        <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-sm">
                          <span className="text-xs font-semibold text-muted-foreground block mb-1">Team reply</span>
                          <p className="whitespace-pre-wrap">{sub.adminReply}</p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="text-center text-xs text-muted-foreground border-t border-border pt-6 pb-2">
            <a href="mailto:support@shipbungee.com" className="text-primary hover:underline">
              support@shipbungee.com
            </a>
            <span className="mx-2">·</span>
            © {new Date().getFullYear()} Bungee Supply Chain Ltd.
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
