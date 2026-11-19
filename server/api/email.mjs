/**
 * Transactional email through Sendly.
 *
 * When SENDLY_API_KEY is missing, messages are printed to the server log and
 * the call still succeeds, so sign-up and billing never fail because email is
 * not switched on yet.
 */

import crypto from "node:crypto";

const SENDLY_API = "https://api.sendlyai.com/v1/messages";
const EMAIL_TIMEOUT_MS = 10_000;
const DEFAULT_FROM = "JotBox <hello@jotbox.online>";
const BRAND_LOGO = "https://www.jotbox.online/apple-touch-icon.png";
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI',Helvetica,Arial,sans-serif";

export function emailConfigured(env = process.env) {
  return Boolean(env.SENDLY_API_KEY?.trim());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout({ heading, body, action, actionUrl, footnote }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0b0d0c;font-family:${FONT_STACK};color:#f2f1ea;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(heading)}</div>
  <div style="max-width:600px;margin:0 auto;padding:36px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="background:#181b18;border:1px solid #2a2f2a;border-bottom:0;border-radius:18px 18px 0 0;padding:24px 28px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="padding:0 12px 0 0;vertical-align:middle;">
                <img src="${BRAND_LOGO}" width="40" height="40" alt="JotBox" style="display:block;width:40px;height:40px;border-radius:11px;border:0;outline:none;text-decoration:none;" />
              </td>
              <td style="font-family:${FONT_STACK};font-size:19px;font-weight:700;color:#f2f1ea;letter-spacing:-0.02em;vertical-align:middle;">JotBox</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#181b18;border:1px solid #2a2f2a;border-top:0;border-radius:0 0 18px 18px;padding:30px 28px 28px;">
          <h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:#f2f1ea;">${escapeHtml(heading)}</h1>
          ${body}
          ${
            action && actionUrl
              ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:24px 0 10px;"><tr><td style="border-radius:12px;background:#dcead9;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 22px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:#0e1a13;text-decoration:none;border-radius:12px;">${escapeHtml(action)}</a></td></tr></table>
          <p style="margin:8px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:#a0a69d;word-break:break-all;">${escapeHtml(actionUrl)}</p>`
              : ""
          }
          ${footnote ? `<p style="margin:24px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:#a0a69d;">${footnote}</p>` : ""}
        </td>
      </tr>
    </table>
    <p style="margin:18px 0 0;text-align:center;font-family:${FONT_STACK};font-size:11px;line-height:1.6;color:#787f75;">
      JotBox. The notes are written while you listen.
    </p>
  </div>
</body></html>`;
}

function paragraph(text) {
  return `<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:15px;line-height:1.7;color:#d6d8d0;">${escapeHtml(text)}</p>`;
}

function linkBlock(label, url) {
  return `<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:15px;line-height:1.7;color:#d6d8d0;">${escapeHtml(label)}<br><a href="${escapeHtml(url)}" style="color:#dcead9;word-break:break-all;">${escapeHtml(url)}</a></p>`;
}

function longDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Sendly validates replyTo as a bare address and rejects a display name, so
 * strip "Name <addr>" down before it reaches the API.
 */
function replyAddress(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  return match ? match[1] : raw;
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
  replyTo,
  headers,
  idempotencyKey,
  from,
  unsubscribe = false,
}) {
  const recipient = String(to || "").trim().toLowerCase();
  if (!recipient) return { delivered: false, reason: "no_recipient" };

  if (!emailConfigured()) {
    console.log(`[jotbox-email] preview to=${recipient} subject=${subject}\n${text}`);
    return { delivered: false, reason: "not_configured", preview: true };
  }

  let response;
  try {
    response = await fetch(SENDLY_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDLY_API_KEY.trim()}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: from || process.env.EMAIL_FROM?.trim() || DEFAULT_FROM,
        to: [recipient],
        subject,
        text,
        html: html || layout({ heading: subject, body: paragraph(text) }),
        ...(replyTo ? { replyTo: replyAddress(replyTo) } : {}),
        ...(headers && typeof headers === "object" ? { headers } : {}),
        ...(unsubscribe ? { unsubscribe: true } : {}),
      }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[jotbox-email] send failed", subject, error);
    return { delivered: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("[jotbox-email] Sendly refused", response.status, body?.message || body?.error);
    return { delivered: false, reason: "provider", status: response.status };
  }

  const accepted = Number(body?.accepted ?? 1);
  if (!Number.isFinite(accepted) || accepted < 1) {
    console.warn("[jotbox-email] Sendly skipped", recipient, body?.skipped ?? "unknown");
    return { delivered: false, reason: "suppressed", id: body?.id ?? null };
  }
  return { delivered: true, id: body?.id ?? null };
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function nameFromEmail(email) {
  const local = String(email || "").split("@")[0].replace(/[._+-]+/g, " ").trim();
  if (!local) return "";
  return local.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function personName(name, email) {
  return cleanName(name) || nameFromEmail(email) || "there";
}

function fromAddress(value = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM) {
  const match = String(value).match(/<([^<>\s]+@[^<>\s]+)>/);
  return match ? match[1] : String(value).trim();
}

function founderFrom(founderName) {
  const name = cleanName(founderName).replace(/[<>"]/g, "");
  if (!name) return undefined;
  return `${name} from JotBox <${fromAddress()}>`;
}

function contentKey(...parts) {
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

function publicAppUrl() {
  return (process.env.JOTBOX_PUBLIC_URL?.trim() || "https://jotbox.online").replace(/\/+$/, "");
}

export async function sendWelcomeEmail(user) {
  const name = personName(user.name, user.email);
  const url = `${publicAppUrl()}/app`;
  return sendEmail({
    to: user.email,
    subject: `${name}, your JotBox account is ready`,
    text: `Hi ${name},\n\nYour JotBox account is ready. Sign in and your notes will follow you across devices.\n\n${url}\n\nStart with a lecture, a meeting, or any room where the words matter. You get 100 minutes of listening each month for free.\n\nJotBox`,
    html: layout({
      heading: `Welcome, ${name}.`,
      body:
        paragraph("Your JotBox account is ready. Sign in and your notes will follow you across devices.") +
        paragraph("Start with a lecture, a meeting, or any room where the words matter. You get 100 minutes of listening each month for free."),
      action: "Open JotBox",
      actionUrl: url,
      footnote: "Recordings stay on your device. Notes follow you only when you sign in.",
    }),
  });
}

export async function sendPasswordResetEmail(user, link, minutes = 60) {
  return sendEmail({
    to: user.email,
    subject: "Reset your JotBox password",
    text: `Hi ${personName(user.name, user.email)},\n\nSomeone asked to reset the password for this JotBox account. Use the link below to choose a new one. It expires in ${minutes} minutes.\n\n${link}\n\nIf this was not you, you can ignore this email. Your password will not change.\n\nJotBox`,
    html: layout({
      heading: "Choose a new password",
      body:
        paragraph("Someone asked to reset the password for this JotBox account. Use the button below to choose a new one.") +
        paragraph(`The link expires in ${minutes} minutes.`),
      action: "Choose a new password",
      actionUrl: link,
      footnote: "If this was not you, ignore this email. Your password will not change.",
    }),
  });
}

export async function sendPasswordChangedEmail(user) {
  return sendEmail({
    to: user.email,
    subject: "Your JotBox password was changed",
    text: `Hi ${personName(user.name, user.email)},\n\nThe password for your JotBox account was just changed, and every other device was signed out.\n\nIf you made this change, nothing else is needed. If you did not, reset your password again right away and reply to this email.\n\nJotBox`,
    html: layout({
      heading: "Your password was changed",
      body:
        paragraph("The password for your JotBox account was just changed, and every other device was signed out.") +
        paragraph("If you made this change, nothing else is needed. If you did not, reset your password again right away and reply to this email."),
      action: "Sign in",
      actionUrl: `${publicAppUrl()}/auth`,
    }),
  });
}

function money(amountMinor, currency) {
  const amount = Number(amountMinor) / 100;
  const code = String(currency || "NGN").toUpperCase();
  try {
    return new Intl.NumberFormat(code === "NGN" ? "en-NG" : "en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export async function sendReceiptEmail(user, { amount, currency, reference, interval = "monthly" }) {
  const paid = money(amount, currency);
  const name = personName(user.name, user.email);
  return sendEmail({
    to: user.email,
    subject: `Your JotBox Pro receipt: ${paid}`,
    text: `Hi ${name},\n\nThank you. We received ${paid} for JotBox Pro (${interval}).\n\nReference: ${reference}\n\nYour Pro features are switched on now: 30 hours of listening each month, branded PDF export, longer share links, AI follow-up drafts, and the Pre-Meeting Brief.\n\nManage your plan: ${publicAppUrl()}/account\n\nJotBox`,
    html: layout({
      heading: `Payment received: ${paid}`,
      body:
        paragraph(`Thank you. We received ${paid} for JotBox Pro (${interval}).`) +
        paragraph(`Reference: ${reference}`) +
        paragraph("Your Pro features are switched on now: 30 hours of listening each month, branded PDF export, longer share links, AI follow-up drafts, and the Pre-Meeting Brief."),
      action: "Manage your plan",
      actionUrl: `${publicAppUrl()}/account`,
      footnote: "This receipt is for your records. Billing questions? Reply to this email.",
    }),
  });
}

export async function sendRenewalReminderEmail(user, { amount, currency, nextPaymentAt }) {
  const paid = money(amount, currency);
  const when = longDate(nextPaymentAt) || "soon";
  const name = personName(user.name, user.email);
  const cycle = new Date(nextPaymentAt).getTime();
  const keyUser = String(user.id || user.email || "").replace(/[^A-Za-z0-9_-]+/g, "_");
  return sendEmail({
    to: user.email,
    subject: `${name}, JotBox Pro renews on ${when}`,
    text: `Hi ${name},\n\nYour JotBox Pro plan renews on ${when}. We will charge ${paid} then.\n\nNothing to do if you want to keep Pro: your 30 hours of listening and every Pro feature stay on.\n\nIf you would rather stop, cancel before ${when}. Pro stays on until the end of the period you already paid for, and the free plan keeps 100 minutes of listening each month.\n\nManage your plan: ${publicAppUrl()}/account\n\nJotBox`,
    html: layout({
      heading: `Pro renews on ${when}`,
      body:
        paragraph(`Your JotBox Pro plan renews on ${when}. We will charge ${paid} then.`) +
        paragraph("Nothing to do if you want to keep Pro: your 30 hours of listening and every Pro feature stay on.") +
        paragraph(`If you would rather stop, cancel before ${when}. Pro stays on until the end of the period you already paid for, and the free plan keeps 100 minutes of listening each month.`),
      action: "Manage your plan",
      actionUrl: `${publicAppUrl()}/account`,
      footnote: "You are receiving this because Pro is active on your account.",
    }),
    idempotencyKey: Number.isFinite(cycle) ? `renewal-${keyUser}-${cycle}` : undefined,
  });
}

export async function sendReferralPartnerEmail({
  to,
  name,
  referralUrl,
  dashboardUrl,
  commissionPercent = 20,
}) {
  const share = Number.isFinite(Number(commissionPercent)) ? Number(commissionPercent) : 20;
  const person = personName(name, to);
  return sendEmail({
    to,
    subject: `${person}, your JotBox partner dashboard`,
    text: `Hi ${person},\n\nThank you for working with JotBox. This is your personal referral link:\n\n${referralUrl}\n\nAnyone who signs up through it is counted to you, and you earn ${share}% of every Pro payment they make. Your dashboard shows who joined, who paid, and what is owed to you:\n\n${dashboardUrl}\n\nThe dashboard link is private, so please keep it to yourself. Payouts are handled by hand, so there is nothing for you to set up on Paystack.\n\nIf you want a different link name or have any questions, just reply to this email.\n\nJotBox`,
    html: layout({
      heading: "Your JotBox partner dashboard",
      body:
        paragraph(`Thank you for working with JotBox. This is your personal referral link.`) +
        linkBlock("Referral link", referralUrl) +
        paragraph(`Anyone who signs up through it is counted to you, and you earn ${share}% of every Pro payment they make.`) +
        paragraph("Your dashboard shows who joined, who paid, and what is owed to you. The link is private, so please keep it to yourself.") +
        paragraph("Payouts are handled by hand, so there is nothing for you to set up on Paystack."),
      action: "Open your dashboard",
      actionUrl: dashboardUrl,
      footnote: "If you want a different link name or have any questions, just reply to this email.",
    }),
  });
}

export async function sendFounderNoteEmail({
  to,
  name,
  sessions,
  callUrl,
  replyTo,
  founderName = "",
}) {
  const person = personName(name, to);
  const sender = cleanName(founderName);
  const count = Number(sessions) || 0;
  const signature = sender ? `${sender}\nFounder, JotBox` : "Founder, JotBox";
  const useLine =
    count > 0
      ? `I saw that you have used JotBox for ${count} session${count === 1 ? "" : "s"}, and I wanted to say thank you personally.`
      : "I saw that you signed up for JotBox, and I wanted to say thank you personally.";
  const callLine = callUrl
    ? `If it is easier to talk, pick a time here: ${callUrl}`
    : "If a call is easier, just reply and we will find a time.";
  const ask = sender
    ? `I am ${sender}, the founder of JotBox, and I am trying to make it better for the people who actually use it. What is working, what is not, and what would make it a habit for you?`
    : "I am trying to make JotBox better for the people who actually use it. What is working, what is not, and what would make it a habit for you?";
  const subject = sender ? `A quick note from ${sender}` : "A quick note from the JotBox founder";
  const text = `Hi ${person},\n\n${useLine}\n\n${ask}\n\n${callLine}\n\nEither way, just reply to this email. I read every one.\n\n${signature}`;
  return sendEmail({
    to,
    subject,
    text,
    html: layout({
      heading: sender ? `A note from ${sender}` : "A quick note from the founder",
      body:
        paragraph(useLine) +
        paragraph(ask) +
        paragraph(callLine) +
        paragraph("Either way, just reply to this email. I read every one."),
      footnote: sender ? `${escapeHtml(sender)}, founder of JotBox.` : "From the founder of JotBox.",
    }),
    from: founderFrom(sender),
    replyTo: replyTo || undefined,
    idempotencyKey: `founder-${String(to).replace(/[^A-Za-z0-9_-]+/g, "_")}-${contentKey(subject, text)}`,
  });
}

export async function sendCancellationEmail(user, { periodEnd } = {}) {
  const until = periodEnd ? new Date(periodEnd) : null;
  const endText =
    until && !Number.isNaN(until.getTime())
      ? `Pro stays on until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, the end of the period you already paid for.`
      : "Pro stays on until the end of the period you already paid for.";
  return sendEmail({
    to: user.email,
    subject: "JotBox Pro will not renew",
    text: `Hi ${personName(user.name, user.email)},\n\nYour JotBox Pro subscription is cancelled and will not renew. ${endText}\n\nYour notes are still yours, and the free plan keeps 100 minutes of listening each month. You can come back any time.\n\nJotBox`,
    html: layout({
      heading: "Your Pro plan will not renew",
      body:
        paragraph(`Your JotBox Pro subscription is cancelled and will not renew. ${endText}`) +
        paragraph("Your notes are still yours, and the free plan keeps 100 minutes of listening each month. You can come back any time."),
      action: "Manage your plan",
      actionUrl: `${publicAppUrl()}/account`,
    }),
  });
}

export async function sendEnterpriseInviteEmail({
  to,
  company,
  contactName,
  link,
  seats,
  priceUsd = 25,
  expiresAt,
}) {
  const name = personName(contactName, to);
  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "";
  return sendEmail({
    to,
    subject: `${company} is ready to set up JotBox`,
    text: `Hi ${name},\n\nThank you for choosing JotBox for ${company}. Your private onboarding link is below.\n\n${link}\n\nIt covers ${seats} seat${seats === 1 ? "" : "s"} at $${priceUsd} per seat each month${expiry ? `, and it stays open until ${expiry}` : ""}. Keep it between your team and your JotBox host: anyone with the link can open the onboarding page.\n\nWe will walk through it with you, then you sign in and the workspace is yours.\n\nJotBox`,
    html: layout({
      heading: `${company} is ready for JotBox`,
      body:
        paragraph(`Thank you for choosing JotBox for ${company}. Your private onboarding link is below.`) +
        paragraph(`It covers ${seats} seat${seats === 1 ? "" : "s"} at $${priceUsd} per seat each month${expiry ? `, and it stays open until ${expiry}` : ""}. Keep it between your team and your JotBox host: anyone with the link can open the onboarding page.`) +
        paragraph("We will walk through it with you, then you sign in and the workspace is yours."),
      action: "Open your onboarding",
      actionUrl: link,
      footnote: "This link is private. If you were not expecting it, reply to this email and we will revoke it.",
    }),
  });
}

export function appUrlFor(pathname) {
  return `${publicAppUrl()}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
