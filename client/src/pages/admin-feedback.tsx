import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import type { FeedbackTicket } from "@/lib/firebaseDb";
import { auth, firebaseConfigured } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail } from "lucide-react";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CAT_LABEL: Record<string, string> = {
  feature: "Feature",
  bug: "Bug",
  improvement: "Improve",
  other: "Other",
};

export default function AdminFeedback() {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<FeedbackTicket | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["firebase", "feedback", "admin"],
    queryFn: () => firebaseDb.listAllFeedbackForAdmin(),
    enabled: Boolean(isAdmin && firebaseConfigured),
  });

  const selectedId = selected?.id;

  const saveReplyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId || !user?.uid) throw new Error("Nothing selected");
      const text = replyDraft.trim();
      if (!text) throw new Error("Enter a reply");
      await firebaseDb.updateFeedbackByAdmin(selectedId, {
        adminReply: text,
        adminReplyAt: new Date().toISOString(),
        adminReplyByUid: user.uid,
        readByAdmin: true,
        status: "replied",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "feedback"] });
      toast({ title: "Reply saved", description: "The user can see it in Feedback on their next visit." });
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", title: "Save failed", description: e.message });
    },
  });

  const emailMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Nothing selected");
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetch(`/api/feedback/${encodeURIComponent(selectedId)}/email-reply`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "feedback"] });
      toast({ title: "Email sent", description: "The user was emailed a copy of your saved reply." });
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", title: "Email failed", description: e.message });
    },
  });

  const openRow = useCallback((row: FeedbackTicket) => {
    setSelected(row);
    setReplyDraft(row.adminReply?.trim() ?? "");
    setSheetOpen(true);
    if (!row.readByAdmin && row.id) {
      void firebaseDb.updateFeedbackByAdmin(row.id, { readByAdmin: true }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["firebase", "feedback"] });
      });
    }
  }, [queryClient]);

  useEffect(() => {
    if (!selectedId) return;
    const fresh = items.find((i) => i.id === selectedId);
    if (fresh) setSelected(fresh);
  }, [items, selectedId]);

  const unreadCount = useMemo(() => items.filter((i) => !i.readByAdmin).length, [items]);

  if (!isAdmin) {
    return (
      <div className="text-sm text-muted-foreground py-10 text-center">
        Feedback inbox is available to company admins only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Feedback inbox</CardTitle>
          <p className="text-sm text-muted-foreground">
            New submissions appear here. Save a reply in the app so users see it in{" "}
            <strong>Feedback</strong>; optionally email the same reply to them (requires SMTP + Firebase Admin on the
            server).
          </p>
          {unreadCount > 0 && (
            <p className="text-sm font-medium text-primary">
              {unreadCount} unread {unreadCount === 1 ? "item" : "items"}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No feedback yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">When</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="w-[90px]">Type</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => openRow(row)}
                    data-state={selectedId === row.id ? "selected" : undefined}
                  >
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{row.name || row.email || "—"}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{row.companyName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {!row.readByAdmin && (
                          <span className="inline-block w-2 h-2 rounded-full bg-primary shrink-0" title="Unread" />
                        )}
                        <span className="text-sm truncate max-w-[280px]">{row.subject}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {CAT_LABEL[row.category] ?? row.category}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.adminReply ? (
                        <Badge variant="outline" className="text-[10px]">
                          Replied
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          Open
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected?.subject ?? "Feedback"}</SheetTitle>
            <SheetDescription>
              {selected && (
                <>
                  {formatDate(selected.createdAt)} · {selected.email} · {selected.companyName}
                </>
              )}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-4">
              <div>
                <Label className="text-muted-foreground">Message</Label>
                <p className="text-sm mt-1 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3">
                  {selected.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>Priority: {selected.priority}</span>
                {selected.area ? <span>· Area: {selected.area}</span> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="admin-reply">Your reply (visible in the app)</Label>
                <Textarea
                  id="admin-reply"
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder="Type your reply…"
                  className="min-h-[140px]"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  disabled={saveReplyMutation.isPending || !replyDraft.trim()}
                  onClick={() => saveReplyMutation.mutate()}
                >
                  {saveReplyMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save reply"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={emailMutation.isPending || !selected.adminReply?.trim()}
                  title={
                    !selected.adminReply?.trim()
                      ? "Save a reply first, then you can email it."
                      : undefined
                  }
                  onClick={() => emailMutation.mutate()}
                >
                  {emailMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 mr-2" />
                      Email user
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <strong>Email user</strong> emails the <em>saved</em> reply to {selected.email || "their address"} (SMTP +
                Firebase Admin on the server). Save your reply first.
              </p>
              {selected.replyEmailedAt && (
                <p className="text-xs text-muted-foreground">
                  Last emailed: {formatDate(selected.replyEmailedAt)}
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
