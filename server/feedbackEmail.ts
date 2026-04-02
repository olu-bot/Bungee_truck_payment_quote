import nodemailer from "nodemailer";

export type FeedbackPayload = {
  name: string;
  email: string;
  company: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  area: string;
};

function formatText(p: FeedbackPayload): string {
  const lines = [
    `Category: ${p.category}`,
    `Priority: ${p.priority}`,
    `Area: ${p.area || "N/A"}`,
    "",
    `From: ${p.name || "Anonymous"}${p.email ? ` <${p.email}>` : ""}`,
    `Company: ${p.company || "N/A"}`,
    "",
    `Subject: ${p.subject}`,
    "",
    "Description:",
    p.description,
  ];
  return lines.join("\n");
}

/**
 * Sends feedback to the support inbox. Requires SMTP env vars (see .env.example).
 * Returns an error message string if sending is skipped or fails.
 */
export async function sendFeedbackEmail(payload: FeedbackPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = process.env.FEEDBACK_SMTP_HOST?.trim();
  if (!host) {
    return {
      ok: false,
      error:
        "Email is not configured (set FEEDBACK_SMTP_HOST and related vars on the server).",
    };
  }

  const port = parseInt(process.env.FEEDBACK_SMTP_PORT || "587", 10);
  const secure = process.env.FEEDBACK_SMTP_SECURE === "true";
  const user = process.env.FEEDBACK_SMTP_USER?.trim() ?? "";
  const pass = process.env.FEEDBACK_SMTP_PASS ?? "";
  const to = (process.env.FEEDBACK_TO_EMAIL || "adam@shipbungee.com").trim();
  /** Must be a domain-verified / allowed sender for your SMTP provider */
  const fromAddress = (process.env.FEEDBACK_FROM_EMAIL || user).trim();
  if (!fromAddress) {
    return {
      ok: false,
      error: "Set FEEDBACK_FROM_EMAIL (or FEEDBACK_SMTP_USER) to a verified sender address.",
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  const text = formatText(payload);
  const replyTo = payload.email.trim() || undefined;

  try {
    await transporter.sendMail({
      from: { name: "Bungee Connect", address: fromAddress },
      to,
      replyTo,
      subject: `[Bungee Feedback] ${payload.subject}`,
      text,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[feedback email]", msg);
    return { ok: false, error: `Failed to send email: ${msg}` };
  }
}

/** Email the end user when an admin replies (uses same SMTP as inbound feedback). */
export async function sendReplyToUserEmail(args: {
  to: string;
  feedbackSubject: string;
  replyText: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = process.env.FEEDBACK_SMTP_HOST?.trim();
  if (!host) {
    return { ok: false, error: "Email is not configured (set FEEDBACK_SMTP_HOST)." };
  }

  const port = parseInt(process.env.FEEDBACK_SMTP_PORT || "587", 10);
  const secure = process.env.FEEDBACK_SMTP_SECURE === "true";
  const user = process.env.FEEDBACK_SMTP_USER?.trim() ?? "";
  const pass = process.env.FEEDBACK_SMTP_PASS ?? "";
  const fromAddress = (process.env.FEEDBACK_FROM_EMAIL || user).trim();
  if (!fromAddress) {
    return { ok: false, error: "Set FEEDBACK_FROM_EMAIL (or FEEDBACK_SMTP_USER) to a verified sender address." };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  const text = [
    `Reply regarding your feedback: "${args.feedbackSubject}"`,
    "",
    args.replyText.trim(),
    "",
    "---",
    "Bungee Connect",
  ].join("\n");

  try {
    await transporter.sendMail({
      from: { name: "Bungee Connect", address: fromAddress },
      to: args.to.trim(),
      subject: `Re: ${args.feedbackSubject}`,
      text,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[feedback reply email]", msg);
    return { ok: false, error: `Failed to send email: ${msg}` };
  }
}
