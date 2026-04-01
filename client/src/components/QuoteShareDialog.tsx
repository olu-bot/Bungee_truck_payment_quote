/**
 * QuoteShareDialog.tsx
 *
 * Streamlined modal: enter a reference number → download branded PDF.
 * Pulls saved PDF template settings from Firestore so the user doesn't
 * need to re-enter contact info or terms every time.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/components/firebase-auth";
import { generateQuotePdf } from "@/lib/generateQuotePdf";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import type { Quote } from "@shared/schema";
import {
  FileDown,
  Hash,
  Loader2,
  Settings,
  ArrowRight,
} from "lucide-react";

type QuoteShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: Quote;
};

export function QuoteShareDialog({ open, onOpenChange, quote }: QuoteShareDialogProps) {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const scopeId = useMemo(() => (user ? workspaceFirestoreId(user) : undefined), [user]);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [generating, setGenerating] = useState(false);

  // Fetch saved PDF template settings
  const { data: template } = useQuery({
    queryKey: ["firebase", "pdfTemplate", scopeId ?? ""],
    queryFn: () => firebaseDb.getPdfTemplate(scopeId),
    enabled: !!scopeId && open,
  });

  function handleGenerate() {
    if (!user) return;
    setGenerating(true);

    requestAnimationFrame(async () => {
      try {
        await generateQuotePdf({
          quote,
          user,
          referenceNumber: referenceNumber.trim(),
          template,
        });
        toast({
          title: "PDF downloaded",
          description: `Quote ${quote.quoteNumber} saved to your downloads.`,
        });
        onOpenChange(false);
      } catch (err) {
        toast({
          title: "PDF generation failed",
          description: err instanceof Error ? err.message : "Something went wrong.",
          variant: "destructive",
        });
      } finally {
        setGenerating(false);
      }
    });
  }

  const templateName = template?.businessName || user?.companyName || "Your Company";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileDown className="w-5 h-5 text-orange-500" />
            Share Quote as PDF
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Download a branded quote document for your customer. Only the total price is shown — no internal costs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Quote summary */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-500">{quote.quoteNumber}</span>
              <Badge variant="outline" className="text-[10px]">
                {quote.truckType?.replace("_", " ") || "N/A"}
              </Badge>
            </div>
            <div className="text-sm font-medium flex items-center gap-1.5">
              {quote.origin}
              <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
              {quote.destination}
            </div>
            <div className="text-xl font-bold text-orange-600">
              ${quote.customerPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </div>

          {/* Reference number */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-slate-500" />
              Reference / RFQ Number
            </label>
            <Input
              placeholder="e.g. RFQ-2026-0412, LT-8834, Project ABC"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-slate-500">
              Customer-facing identifier shown on the PDF.
            </p>
          </div>

          {/* Template info */}
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50/40 rounded-md px-3 py-2">
            <Settings className="w-3.5 h-3.5 shrink-0" />
            <span>
              Using template from <span className="font-medium text-slate-900">{templateName}</span>.
              Edit your PDF template in Company Profile.
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-orange-400 hover:bg-orange-500 text-white gap-1.5"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4" />
            )}
            Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
