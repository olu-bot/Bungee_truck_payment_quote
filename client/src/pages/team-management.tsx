import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { firebaseConfigured } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import type { TeamMember } from "@shared/schema";
import { Plus, Trash2 } from "lucide-react";

export default function TeamManagement() {
  const { toast } = useToast();
  const { user } = useFirebaseAuth();
  const scopeId = workspaceFirestoreId(user);
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [role, setRole] = useState("driver");
  const [pin, setPin] = useState("");

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["firebase", "team", scopeId ?? ""],
    queryFn: () => firebaseDb.getTeamMembers(scopeId),
    enabled: !!scopeId && firebaseConfigured,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!scopeId) throw new Error("No workspace.");
      if (!name.trim() || !pin.trim()) throw new Error("Name and PIN are required.");
      return firebaseDb.createTeamMember(scopeId, {
        name: name.trim(),
        role,
        pin: pin.trim(),
        createdAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["firebase", "team", scopeId ?? ""] });
      setName("");
      setPin("");
      toast({ title: "Team member added" });
    },
    onError: (e: Error) => toast({ title: "Could not add member", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!scopeId) throw new Error("No workspace.");
      const ok = await firebaseDb.deleteTeamMember(scopeId, id);
      if (!ok) throw new Error("Not found.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["firebase", "team", scopeId ?? ""] });
      toast({ title: "Removed" });
    },
    onError: (e: Error) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  const sorted = useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );

  if (!firebaseConfigured) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Firebase is not configured — team data lives in Firestore.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add team member</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="tm-name">Name</Label>
            <Input
              id="tm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Driver name"
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="driver">Driver</SelectItem>
                <SelectItem value="dispatcher">Dispatcher</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tm-pin">PIN</Label>
            <Input
              id="tm-pin"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4–6 digits"
              type="password"
              autoComplete="new-password"
            />
          </div>
          <Button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !scopeId}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="capitalize">{m.role}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => deleteMutation.mutate(m.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
