/**
 * Transactional email through Sendly.
 *
 * When SENDLY_API_KEY is missing, messages are printed to the server log and
 * the call still succeeds, so sign-up and billing never fail because email is
 * not switched on yet.
 */

const SENDLY_API = "https://api.sendlyai.com/v1/messages";
const EMAIL_TIMEOUT_MS = 10_000;
const DEFAULT_FROM = "JotBox <hello@jotbox.online>";

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
<html><body style="margin:0;padding:0;background:#f3efe4;font-family:Georgia,'Times New Roman',serif;color:#1d2a24;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#12362c;border-radius:16px 16px 0 0;padding:22px 28px;">
      <span style="font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;color:#f5f1e4;letter-spacing:-0.02em;">JotBox</span>
    </div>
    <div style="background:#fffdf7;border:1px solid #e3dccb;border-top:0;border-radius:0 0 16px 16px;padding:28px;">
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#12362c;">${escapeHtml(heading)}</h1>
      ${body}
      ${
        action && actionUrl
          ? `<p style="margin:24px 0 8px;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#1f5748;color:#f5f1e4;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">${escapeHtml(action)}</a></p>
      <p style="margin:8px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6d7a71;word-break:break-all;">${escapeHtml(actionUrl)}</p>`
          : ""
      }
      ${footnote ? `<p style="margin:22px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6d7a71;">${footnote}</p>` : ""}
    </div>
    <p style="margin:16px 0 0;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#8a958c;">
      JotBox. The notes are written while you listen.
    </p>
  </div>
</body></html>`;
}

function paragraph(text) {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#33423a;">${escapeHtml(text)}</p>`;
}

function linkBlock(label, url) {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#33423a;">${escapeHtml(label)}<br><a href="${escapeHtml(url)}" style="color:#1f5748;word-break:break-all;">${escapeHtml(url)}</a></p>`;
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
        from: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM,
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

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "there";
}

function publicAppUrl() {
  return (process.env.JOTBOX_PUBLIC_URL?.trim() || "https://jotbox.online").replace(/\/+$/, "");
}

export async function sendWelcomeEmail(user) {
  const name = firstName(user.name);
  const url = `${publicAppUrl()}/app`;
  return sendEmail({
    to: user.email,
    subject: "Your JotBox account is ready",
    text: `Hi ${name},\n\nYour JotBox account is ready. Sign in and your notes will follow you across devices.\n\n${url}\n\nStart with a lecture, a meeting, or any room where the words matter. You get 60 minutes of listening each month for free.\n\nJotBox`,
    html: layout({
      heading: `Welcome, ${name}.`,
      body:
        paragraph("Your JotBox account is ready. Sign in and your notes will follow you across devices.") +
        paragraph("Start with a lecture, a meeting, or any room where the words matter. You get 60 minutes of listening each month for free."),
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
    text: `Hi ${firstName(user.name)},\n\nSomeone asked to reset the password for this JotBox account. Use the link below to choose a new one. It expires in ${minutes} minutes.\n\n${link}\n\nIf this was not you, you can ignore this email. Your password will not change.\n\nJotBox`,
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
    text: `Hi ${firstName(user.name)},\n\nThe password for your JotBox account was just changed, and every other device was signed out.\n\nIf you made this change, nothing else is needed. If you did not, reset your password again right away and reply to this email.\n\nJotBox`,
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
  return sendEmail({
    to: user.email,
    subject: `Your JotBox Pro receipt: ${paid}`,
    text: `Hi ${firstName(user.name)},\n\nThank you. We received ${paid} for JotBox Pro (${interval}).\n\nReference: ${reference}\n\nYour Pro features are switched on now: unlimited listening, branded PDF export, longer share links, AI follow-up drafts, and the Pre-Meeting Brief.\n\nManage your plan: ${publicAppUrl()}/account\n\nJotBox`,
    html: layout({
      heading: `Payment received: ${paid}`,
      body:
        paragraph(`Thank you. We received ${paid} for JotBox Pro (${interval}).`) +
        paragraph(`Reference: ${reference}`) +
        paragraph("Your Pro features are switched on now: unlimited listening, branded PDF export, longer share links, AI follow-up drafts, and the Pre-Meeting Brief."),
      action: "Manage your plan",
      actionUrl: `${publicAppUrl()}/account`,
      footnote: "This receipt is for your records. Billing questions? Reply to this email.",
    }),
  });
}

export async function sendRenewalReminderEmail(user, { amount, currency, nextPaymentAt }) {
  const paid = money(amount, currency);
  const when = longDate(nextPaymentAt) || "soon";
  const cycle = new Date(nextPaymentAt).getTime();
  const keyUser = String(user.id || user.email || "").replace(/[^A-Za-z0-9_-]+/g, "_");
  return sendEmail({
    to: user.email,
    subject: `JotBox Pro renews on ${when}`,
    text: `Hi ${firstName(user.name)},\n\nYour JotBox Pro plan renews on ${when}. We will charge ${paid} then.\n\nNothing to do if you want to keep Pro: unlimited listening and every Pro feature stay on.\n\nIf you would rather stop, cancel before ${when}. Pro stays on until the end of the period you already paid for, and the free plan keeps 60 minutes of listening each month.\n\nManage your plan: ${publicAppUrl()}/account\n\nJotBox`,
    html: layout({
      heading: `Pro renews on ${when}`,
      body:
        paragraph(`Your JotBox Pro plan renews on ${when}. We will charge ${paid} then.`) +
        paragraph("Nothing to do if you want to keep Pro: unlimited listening and every Pro feature stay on.") +
        paragraph(`If you would rather stop, cancel before ${when}. Pro stays on until the end of the period you already paid for, and the free plan keeps 60 minutes of listening each month.`),
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
  const person = firstName(name);
  return sendEmail({
    to,
    subject: "Your JotBox partner dashboard",
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
  const person = firstName(name);
  const count = Number(sessions) || 0;
  const signature = founderName ? `${founderName}\nFounder, JotBox` : "Founder, JotBox";
  const useLine =
    count > 0
      ? `I saw that you have used JotBox for ${count} session${count === 1 ? "" : "s"}, and I wanted to say thank you personally.`
      : "I saw that you signed up for JotBox, and I wanted to say thank you personally.";
  const callLine = callUrl
    ? `If it is easier to talk, pick a time here: ${callUrl}`
    : "If a call is easier, just reply and we will find a time.";
  return sendEmail({
    to,
    subject: "A quick note from the JotBox founder",
    text: `Hi ${person},\n\n${useLine}\n\nI am trying to make JotBox better for the people who actually use it. What is working, what is not, and what would make it a habit for you?\n\n${callLine}\n\nEither way, just reply to this email. I read every one.\n\n${signature}`,
    html: layout({
      heading: "A quick note from the founder",
      body:
        paragraph(useLine) +
        paragraph("I am trying to make JotBox better for the people who actually use it. What is working, what is not, and what would make it a habit for you?") +
        paragraph(callLine) +
        paragraph("Either way, just reply to this email. I read every one."),
      footnote: founderName ? `${escapeHtml(founderName)}, founder of JotBox.` : "From the founder of JotBox.",
    }),
    replyTo: replyTo || undefined,
    idempotencyKey: `founder-${String(to).replace(/[^A-Za-z0-9_-]+/g, "_")}`,
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
    text: `Hi ${firstName(user.name)},\n\nYour JotBox Pro subscription is cancelled and will not renew. ${endText}\n\nYour notes are still yours, and the free plan keeps 60 minutes of listening each month. You can come back any time.\n\nJotBox`,
    html: layout({
      heading: "Your Pro plan will not renew",
      body:
        paragraph(`Your JotBox Pro subscription is cancelled and will not renew. ${endText}`) +
        paragraph("Your notes are still yours, and the free plan keeps 60 minutes of listening each month. You can come back any time."),
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
  const name = firstName(contactName);
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
