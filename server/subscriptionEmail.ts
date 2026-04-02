import nodemailer from "nodemailer";

export type UpgradeTier = "pro" | "fleet";

const TIER_DISPLAY: Record<UpgradeTier, { name: string; tagline: string; color: string }> = {
  pro: {
    name: "Pro",
    tagline: "You now have access to all professional tools.",
    color: "#2563eb",
  },
  fleet: {
    name: "Premium",
    tagline: "You now have access to every feature — unlimited, no restrictions.",
    color: "#d97706",
  },
};

const FEATURE_LIST: Record<UpgradeTier, string[]> = {
  pro: [
    "Unlimited route quotes",
    "Unlimited cost profiles & yards",
    "Up to 5 team members",
    "Up to 20 favourite lanes",
    "Branded PDF export",
    "CSV export",
    "IFTA fuel tax breakdown",
    "Analytics dashboard",
    "Lane intelligence hints",
    "AI-powered pricing suggestions",
  ],
  fleet: [
    "Everything in Pro",
    "Unlimited team members",
    "Unlimited favourite lanes",
    "Full priority support",
  ],
};

function buildHtml(name: string, tier: UpgradeTier): string {
  const cfg = TIER_DISPLAY[tier];
  const features = FEATURE_LIST[tier];
  const firstName = name?.split(" ")[0] || "there";
  const featureRows = features
    .map(
      (f) =>
        `<tr><td style="padding:4px 0;font-size:14px;color:#374151;">
           <span style="color:${cfg.color};margin-right:8px;">✓</span>${f}
         </td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:${cfg.color};padding:32px 40px;text-align:center;">
            <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.8);letter-spacing:1px;text-transform:uppercase;font-weight:600;">
              Bungee Connect
            </p>
            <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;">
              You're now on ${cfg.name}! 🎉
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">
              Hi ${firstName},
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
              Your <strong>Bungee Connect ${cfg.name}</strong> plan is now active.
              ${cfg.tagline}
            </p>

            <!-- Features -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#f3f4f6;border-radius:8px;padding:16px 20px;margin-bottom:28px;">
              <tr><td>
                <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#6b7280;">
                  What's included
                </p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  ${featureRows}
                </table>
              </td></tr>
            </table>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
              <tr>
                <td align="center" style="border-radius:8px;background:${cfg.color};">
                  <a href="https://shipbungee.com/connect/"
                    style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                    Open Bungee Connect →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:28px 0 0;font-size:14px;color:#6b7280;line-height:1.6;">
              If you have any questions, just reply to this email or visit
              <a href="https://shipbungee.com/connect/" style="color:${cfg.color};">shipbungee.com/connect</a>.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              © Bungee Supply Chain Ltd · <a href="https://shipbungee.com/connect/" style="color:#9ca3af;">shipbungee.com/connect</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText(name: string, tier: UpgradeTier): string {
  const cfg = TIER_DISPLAY[tier];
  const firstName = name?.split(" ")[0] || "there";
  const features = FEATURE_LIST[tier].map((f) => `  • ${f}`).join("\n");
  return [
    `Hi ${firstName},`,
    "",
    `Your Bungee Connect ${cfg.name} plan is now active. ${cfg.tagline}`,
    "",
    "What's included:",
    features,
    "",
    "Open the app: https://shipbungee.com/connect/",
    "",
    "—",
    "Bungee Supply Chain Ltd",
    "https://shipbungee.com/connect/",
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
 * Send a "Welcome to Pro/Premium" email to the user.
 * Uses the same FEEDBACK_SMTP_* env vars as the feedback mailer.
 * Silently skips if SMTP is not configured — never throws.
 */
export async function sendSubscriptionUpgradeEmail(args: {
  to: string;
  name: string;
  tier: UpgradeTier;
}): Promise<void> {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("[subscription email] SMTP not configured — skipping upgrade email to", args.to);
    return;
  }

  const fromAddress = (
    process.env.FEEDBACK_FROM_EMAIL || process.env.FEEDBACK_SMTP_USER || ""
  ).trim();
  if (!fromAddress) {
    console.warn("[subscription email] FEEDBACK_FROM_EMAIL not set — skipping upgrade email");
    return;
  }

  const cfg = TIER_DISPLAY[args.tier];
  try {
    await transporter.sendMail({
      from: { name: "Bungee Connect", address: fromAddress },
      to: args.to.trim(),
      subject: `You're now on Bungee Connect ${cfg.name}! 🎉`,
      text: buildText(args.name, args.tier),
      html: buildHtml(args.name, args.tier),
    });
    console.log(`[subscription email] sent ${args.tier} upgrade email to ${args.to}`);
  } catch (e) {
    // Non-fatal — log and continue
    console.error("[subscription email] failed to send upgrade email:", e);
  }
}
