import nodemailer from "nodemailer";

const ROLE_LABELS: Record<string, string> = {
  member:  "Member",
  manager: "Manager",
  admin:   "Admin",
  owner:   "Owner",
};

function buildHtml(args: {
  to: string;
  inviterName: string;
  companyName: string;
  role: string;
}): string {
  const roleLabel = ROLE_LABELS[args.role] ?? args.role;
  const signUpUrl = "https://shipbungee.com/connect/#/signup";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#f97316;padding:32px 40px;text-align:center;">
            <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;font-weight:600;">
              Bungee Connect
            </p>
            <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;">
              You've been invited to join a team 🎉
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 20px;font-size:15px;color:#111827;line-height:1.6;">
              <strong>${args.inviterName}</strong> has invited you to join
              <strong>${args.companyName}</strong> on Bungee Connect as a
              <strong>${roleLabel}</strong>.
            </p>

            <!-- What is Bungee Connect -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#f3f4f6;border-radius:8px;padding:16px 20px;margin-bottom:28px;">
              <tr><td>
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#6b7280;">
                  What is Bungee Connect?
                </p>
                <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">
                  Bungee Connect is a freight quote calculator that incorporates your
                  actual truck costs — payments, insurance, maintenance, fuel, driver pay
                  — to give you a real break-even number in seconds.
                </p>
              </td></tr>
            </table>

            <!-- Steps -->
            <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#111827;">
              How to accept your invitation:
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#374151;vertical-align:top;">
                  <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#f97316;color:#fff;font-size:11px;font-weight:700;margin-right:10px;vertical-align:middle;">1</span>
                  Click the button below to open Bungee Connect.
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#374151;vertical-align:top;">
                  <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#f97316;color:#fff;font-size:11px;font-weight:700;margin-right:10px;vertical-align:middle;">2</span>
                  Sign up (or log in) using <strong>${args.to}</strong>.
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#374151;vertical-align:top;">
                  <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#f97316;color:#fff;font-size:11px;font-weight:700;margin-right:10px;vertical-align:middle;">3</span>
                  You'll automatically appear in <strong>${args.companyName}</strong>'s team.
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
              <tr>
                <td align="center" style="border-radius:8px;background:#f97316;">
                  <a href="${signUpUrl}"
                    style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                    Accept Invitation →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:28px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;text-align:center;">
              Make sure to sign up with <strong style="color:#6b7280;">${args.to}</strong>
              so you are automatically matched to the invite.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              © Bungee Supply Chain Ltd ·
              <a href="https://shipbungee.com/connect/" style="color:#9ca3af;">shipbungee.com/connect</a>
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:#d1d5db;">
              If you didn't expect this email, you can safely ignore it.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText(args: {
  to: string;
  inviterName: string;
  companyName: string;
  role: string;
}): string {
  const roleLabel = ROLE_LABELS[args.role] ?? args.role;
  return [
    `${args.inviterName} has invited you to join ${args.companyName} on Bungee Connect as a ${roleLabel}.`,
    "",
    "How to accept:",
    "1. Go to https://shipbungee.com/connect/#/signup",
    `2. Sign up (or log in) using ${args.to}`,
    `3. You'll automatically appear in ${args.companyName}'s team.`,
    "",
    "Bungee Connect is a freight quote calculator that gives carriers a real break-even number — not a guess.",
    "",
    "—",
    "Bungee Supply Chain Ltd",
    "https://shipbungee.com/connect/",
    "",
    "If you didn't expect this email, you can safely ignore it.",
  ].join("\n");
}

function createTransporter() {
  const host = process.env.FEEDBACK_SMTP_HOST?.trim();
  if (!host) return null;
  const port = parseInt(process.env.FEEDBACK_SMTP_PORT || "587", 10);
  const secure = process.env.FEEDBACK_SMTP_SECURE === "true";
  const user = process.env.FEEDBACK_SMTP_USER?.trim() ?? "";
  const pass = process.env.FEEDBACK_SMTP_PASS ?? "";
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

/**
 * Send a team invitation email to the invitee.
 * Uses the same FEEDBACK_SMTP_* env vars as all other transactional emails.
 * Silently skips (with a console warning) if SMTP is not configured.
 */
export async function sendTeamInviteEmail(args: {
  to: string;
  inviterName: string;
  companyName: string;
  role: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const transporter = createTransporter();
  if (!transporter) {
    const msg = "SMTP not configured — set FEEDBACK_SMTP_HOST to enable invite emails.";
    console.warn("[invite email]", msg);
    return { ok: false, error: msg };
  }

  const fromAddress = (
    process.env.FEEDBACK_FROM_EMAIL || process.env.FEEDBACK_SMTP_USER || ""
  ).trim();
  if (!fromAddress) {
    const msg = "FEEDBACK_FROM_EMAIL not set — skipping invite email.";
    console.warn("[invite email]", msg);
    return { ok: false, error: msg };
  }

  try {
    await transporter.sendMail({
      from: { name: "Bungee Connect", address: fromAddress },
      to: args.to.trim(),
      subject: `${args.inviterName} invited you to join ${args.companyName} on Bungee Connect`,
      text: buildText(args),
      html: buildHtml(args),
    });
    console.log(`[invite email] sent to ${args.to} for company ${args.companyName}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[invite email] failed:", msg);
    return { ok: false, error: msg };
  }
}
