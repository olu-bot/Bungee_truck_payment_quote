/**
 * generateQuotePdf.ts
 *
 * Generates a clean, professional quote PDF using saved template settings.
 * Uses jsPDF for client-side generation — no server round-trip needed.
 *
 * Design: minimal black & white with subtle gray tones. No colored backgrounds
 * or heavy boxes — just clean typography, thin rules, and generous whitespace.
 */

import type { Quote } from "@shared/schema";
import type { AppUser } from "@/components/firebase-auth";
import type { PdfTemplateSettings } from "@/lib/firebaseDb";
import { DEFAULT_PDF_TEMPLATE } from "@/lib/firebaseDb";
import {
  currencySymbol,
  resolveWorkspaceCurrency,
  type SupportedCurrency,
} from "@/lib/currency";
import {
  resolveMeasurementUnit,
  displayDistance,
  distanceLabel,
} from "@/lib/measurement";

// ── Types ────────────────────────────────────────────────────────

export type QuotePdfInput = {
  quote: Quote;
  user: AppUser;
  /** Customer-facing reference: RFQ#, load tender#, project#, etc. */
  referenceNumber: string;
  /** Saved PDF template settings from Firestore */
  template?: PdfTemplateSettings;
};

// ── Colors — intentionally restrained ────────────────────────────

const C = {
  black:  [30, 30, 30]    as const,
  dark:   [60, 60, 65]    as const,
  gray:   [120, 120, 128] as const,
  light:  [170, 170, 178] as const,
  rule:   [210, 210, 215] as const,
  bg:     [245, 245, 248] as const,
  white:  [255, 255, 255] as const,
};

// ── Helpers ──────────────────────────────────────────────────────

type RGB = readonly [number, number, number];

function txt(doc: jsPDF, c: RGB) { doc.setTextColor(c[0], c[1], c[2]); }
function fill(doc: jsPDF, c: RGB) { doc.setFillColor(c[0], c[1], c[2]); }
function stroke(doc: jsPDF, c: RGB) { doc.setDrawColor(c[0], c[1], c[2]); }

function font(doc: jsPDF, style: "normal" | "bold" | "italic", size: number) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
}

function hRule(doc: jsPDF, y: number, x1: number, x2: number, weight = 0.4) {
  stroke(doc, C.rule);
  doc.setLineWidth(weight);
  doc.line(x1, y, x2, y);
}

const TRUCK_LABELS: Record<string, string> = {
  dry_van: "Dry Van", reefer: "Reefer", flatbed: "Flatbed",
  step_deck: "Step Deck", tanker: "Tanker",
};

// ── Build Terms from Template ────────────────────────────────────

function buildTerms(t: PdfTemplateSettings, currency: string): string[] {
  const terms: string[] = [];
  terms.push(`This quote is valid for ${t.validityDays} day${t.validityDays !== 1 ? "s" : ""} from the date and time of issue.`);
  if (t.showFuelClause) {
    terms.push("Prices are subject to fuel surcharge adjustments based on DOE index changes.");
  }
  terms.push(
    `Detention charges apply after ${t.freeDetentionHours} hour${t.freeDetentionHours !== 1 ? "s" : ""} of free time at $${t.detentionRate}/hr.`,
  );
  if (t.showAccessorialClause) {
    terms.push("Accessorial charges (lumper, TONU, layover) are billed separately if incurred.");
  }
  terms.push(`Payment terms: ${t.paymentTerms} from invoice date.`);
  terms.push(`All rates are in ${currency} and exclude applicable taxes.`);
  if (t.customTerms.trim()) {
    for (const line of t.customTerms.split("\n")) {
      if (line.trim()) terms.push(line.trim());
    }
  }
  return terms;
}

/** Format a date as "Mar 27, 2026 · 2:45 PM" */
function formatDateTime(d: Date): string {
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date}  ·  ${time}`;
}

// ── Main Export ──────────────────────────────────────────────────

export async function generateQuotePdf(input: QuotePdfInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const { quote, user, referenceNumber, template } = input;
  const t = template ?? DEFAULT_PDF_TEMPLATE;

  const currency = resolveWorkspaceCurrency(user as Record<string, unknown>) as SupportedCurrency;
  const measureUnit = resolveMeasurementUnit(user);
  const sym = currencySymbol(currency);
  const dLabel = distanceLabel(measureUnit);
  const distVal = displayDistance(quote.distance, measureUnit);
  const businessName = t.businessName || user.companyName || "Your Company";
  const email = t.contactEmail || user.email;
  const phone = t.contactPhone;
  const address = t.address || user.operatingCity || "";

  const doc = new jsPDF({ unit: "pt", format: "letter" }); // 612 × 792
  const W = 612;
  const M = 50;         // margin
  const CW = W - M * 2; // content width
  let y = 0;

  // ─────────────────────────────────────────────────────────────────
  // HEADER — logo + company info on left, "QUOTE" label on right
  // ─────────────────────────────────────────────────────────────────
  y = M;

  let textX = M;
  const logoData = t.logoBase64;
  if (logoData) {
    try {
      const logoH = 40;
      doc.addImage(logoData, "AUTO", M, y - 6, logoH, logoH);
      textX = M + logoH + 12;
    } catch {
      // skip broken logo
    }
  }

  // Business name
  font(doc, "bold", 16);
  txt(doc, C.black);
  doc.text(businessName, textX, y + 4);

  // Tagline (if any)
  if (t.tagline) {
    font(doc, "italic", 8);
    txt(doc, C.gray);
    doc.text(t.tagline, textX, y + 16);
  }

  // Contact line
  font(doc, "normal", 7.5);
  txt(doc, C.gray);
  const contactParts = [phone, email, address].filter(Boolean);
  if (contactParts.length) {
    doc.text(contactParts.join("   |   "), textX, y + (t.tagline ? 27 : 17));
  }

  // "QUOTE" label — right-aligned
  font(doc, "bold", 22);
  txt(doc, C.black);
  doc.text("QUOTE", W - M, y + 6, { align: "right" });

  y = Math.max(y + 40, textX !== M ? y + 42 : y + 34);

  // Thin rule under header
  hRule(doc, y, M, W - M, 0.6);
  y += 20;

  // ─────────────────────────────────────────────────────────────────
  // QUOTE META — two-column key-value pairs
  // ─────────────────────────────────────────────────────────────────
  const quoteDate = new Date(quote.createdAt);
  const leftCol = M;
  const rightCol = M + CW / 2;

  const metaRows: [string, string, string, string][] = [
    ["Quote #", quote.quoteNumber || "—", "Date & Time", formatDateTime(quoteDate)],
    ["Reference / RFQ", referenceNumber || "—", "Valid For", `${t.validityDays} days`],
    ["Equipment", TRUCK_LABELS[quote.truckType] || quote.truckType || "—", "Distance", `${distVal.toFixed(0)} ${dLabel}`],
  ];

  for (const [lLabel, lVal, rLabel, rVal] of metaRows) {
    font(doc, "normal", 7);
    txt(doc, C.gray);
    doc.text(lLabel, leftCol, y);
    doc.text(rLabel, rightCol, y);

    font(doc, "bold", 9.5);
    txt(doc, C.black);
    doc.text(lVal, leftCol, y + 12);
    doc.text(rVal, rightCol, y + 12);

    y += 28;
  }

  // ─────────────────────────────────────────────────────────────────
  // ROUTE
  // ─────────────────────────────────────────────────────────────────
  hRule(doc, y, M, W - M);
  y += 18;

  font(doc, "normal", 7);
  txt(doc, C.gray);
  doc.text("ROUTE", M, y);
  y += 14;

  // Origin
  font(doc, "normal", 7);
  txt(doc, C.gray);
  doc.text("From", M, y);
  font(doc, "bold", 11);
  txt(doc, C.black);
  doc.text(quote.origin || "—", M + 40, y);

  y += 18;

  // Destination
  font(doc, "normal", 7);
  txt(doc, C.gray);
  doc.text("To", M, y);
  font(doc, "bold", 11);
  txt(doc, C.black);
  doc.text(quote.destination || "—", M + 40, y);

  y += 8;

  // Customer note
  if (quote.customerNote) {
    y += 10;
    font(doc, "italic", 7.5);
    txt(doc, C.gray);
    const noteLines = doc.splitTextToSize(`Note: ${quote.customerNote}`, CW);
    doc.text(noteLines, M, y);
    y += noteLines.length * 10;
  }

  // ─────────────────────────────────────────────────────────────────
  // QUOTED PRICE — clean, prominent section
  // ─────────────────────────────────────────────────────────────────
  y += 16;
  hRule(doc, y, M, W - M);
  y += 22;

  font(doc, "normal", 7);
  txt(doc, C.gray);
  doc.text("QUOTED PRICE", M, y);
  y += 6;

  // Price
  font(doc, "bold", 36);
  txt(doc, C.black);
  const priceStr = `${sym}${quote.customerPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  doc.text(priceStr, M, y + 28);

  // Currency + terms on the right
  font(doc, "bold", 10);
  txt(doc, C.black);
  doc.text(currency, W - M, y + 12, { align: "right" });

  font(doc, "normal", 8);
  txt(doc, C.gray);
  doc.text("All-inclusive rate", W - M, y + 23, { align: "right" });
  doc.text(t.paymentTerms, W - M, y + 34, { align: "right" });

  y += 42;

  // ─────────────────────────────────────────────────────────────────
  // TERMS & CONDITIONS
  // ─────────────────────────────────────────────────────────────────
  y += 16;
  hRule(doc, y, M, W - M);
  y += 16;

  font(doc, "bold", 8);
  txt(doc, C.dark);
  doc.text("TERMS & CONDITIONS", M, y);
  y += 14;

  font(doc, "normal", 7.5);
  txt(doc, C.dark);

  const terms = buildTerms(t, currency);
  for (let i = 0; i < terms.length; i++) {
    if (y > 730) {
      doc.addPage();
      y = M;
      font(doc, "normal", 7.5);
      txt(doc, C.dark);
    }
    const bullet = `${i + 1}.  ${terms[i]}`;
    const lines = doc.splitTextToSize(bullet, CW - 10);
    doc.text(lines, M + 4, y);
    y += lines.length * 10 + 3;
  }

  // ─────────────────────────────────────────────────────────────────
  // FOOTER
  // ─────────────────────────────────────────────────────────────────
  const footerY = 768;
  hRule(doc, footerY - 6, M, W - M, 0.3);

  font(doc, "normal", 6.5);
  txt(doc, C.light);

  if (t.footerNote) {
    doc.text(t.footerNote, M, footerY + 4);
  } else {
    doc.text(
      `Generated on ${formatDateTime(new Date())}`,
      M, footerY + 4,
    );
  }
  doc.text("Powered by Bungee Connect", W - M, footerY + 4, { align: "right" });

  // ─────────────────────────────────────────────────────────────────
  // SAVE
  // ─────────────────────────────────────────────────────────────────
  const safeRef = referenceNumber ? `-${referenceNumber.replace(/[^a-zA-Z0-9-]/g, "")}` : "";
  doc.save(`Quote-${quote.quoteNumber}${safeRef}.pdf`);
}
