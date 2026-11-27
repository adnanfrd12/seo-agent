"use server";

import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { aiErrorMessage } from "@/lib/ai/claude";
import { explainIssue, storedIssueFix, type IssueFix } from "@/lib/ai/issue-explain";
import { budgetMessage, claudeBudget } from "@/lib/ai/usage";
import { createAdminClient } from "@/lib/supabase/admin";

const input = z.object({
  path: z.string().regex(/^\/[A-Za-z0-9_\-/]{0,150}$/),
  title: z.string().trim().min(1).max(500),
  detail: z.string().max(3000).default(""),
});

/**
 * The explanation and fix for one error or warning shown on a dashboard page. Anyone on the client reads a stored
 * one; owners and admins have a new one written (counts toward the monthly Claude budget).
 */
export async function explainIssueAction(raw: z.input<typeof input>, regenerate = false): Promise<{ ok: true; fix: IssueFix } | { ok: false; error: string }> {
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, error: "This item can't be explained." };
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  try {
    const db = createAdminClient();
    if (!regenerate) {
      const stored = await storedIssueFix(db, client.id, p.data);
      if (stored) return { ok: true, fix: stored };
    }
    if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "No AI explanation yet: an owner or admin opens this item to create one." };
    const b = await claudeBudget(db, client.id);
    if (b.left <= 0) return { ok: false, error: budgetMessage(b.budget) };
    return { ok: true, fix: await explainIssue(db, client, p.data) };
  } catch (e) {
    return { ok: false, error: aiErrorMessage(e) };
  }
}
