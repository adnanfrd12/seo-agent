import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Optional outbound notifications. Both are OFF until configured, and neither can ever break a job:
 *  - ALERT_WEBHOOK_URL (Slack / Teams / Discord-compatible incoming webhook): operations messages,
 *    e.g. "scheduled job failed". Contains no client data beyond the job name and an error message.
 *  - RESEND_API_KEY + ALERT_EMAIL_FROM: an email to a client's owners and admins when a critical or
 *    warning alert is raised for that client (one email per client per daily run).
 */
export async function notifyOps(title: string, detail?: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ text: `*${title}*${detail ? `\n${detail.slice(0, 400)}` : ""}` }),
    });
  } catch { /* a failing webhook must never fail the job */ }
}

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim() && process.env.ALERT_EMAIL_FROM?.trim());

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export async function emailClientAlerts(
  admin: SupabaseClient, clientId: string, clientName: string, alerts: { severity: string; title: string; body: string }[],
): Promise<void> {
  if (!emailConfigured() || alerts.length === 0) return;
  try {
    const { data: members } = await admin.from("client_members").select("user_id").eq("client_id", clientId).in("role", ["owner", "admin"]).limit(10);
    const emails: string[] = [];
    for (const m of members ?? []) {
      const { data } = await admin.auth.admin.getUserById(m.user_id as string);
      if (data?.user?.email) emails.push(data.user.email);
    }
    if (emails.length === 0) return;
    const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
    const rows = alerts.slice(0, 6).map((a) => `<li style="margin-bottom:10px"><strong>${esc(a.title)}</strong><br><span style="color:#555">${esc(a.body.slice(0, 300))}</span></li>`).join("");
    await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.ALERT_EMAIL_FROM!.trim(), to: emails,
        subject: `${clientName}: ${alerts.length} SEO alert${alerts.length > 1 ? "s" : ""} need attention`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px"><h2 style="margin:0 0 12px">${esc(clientName)}</h2><ul style="padding-left:18px">${rows}</ul>${app ? `<p><a href="${app}/overview#alerts">Open the dashboard</a></p>` : ""}</div>`,
      }),
    });
  } catch { /* email is best-effort */ }
}
