import { z } from "zod";
import { anthropic, aiErrorMessage } from "@/lib/ai/claude";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { ASK_SYSTEM, screenData } from "@/lib/aiqw/ask";
import { clientSettings } from "@/lib/aiqw/run";
import { SCREENS } from "@/lib/aiqw/screens";
import { callCost } from "@/lib/aiqw/settings";
import { claudeMonthSpend, recordAskCost } from "@/lib/aiqw/store";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const body = z.object({ screen: z.string().refine((s) => SCREENS.some((x) => x.key === s), "unknown screen"), question: z.string().trim().min(3).max(1000) });

/**
 * "💬 Ask Claude": the question plus the screen's own data (built here on the server), answered only from that data
 * and streamed back as plain text. The data blocks used are listed in the x-data-used header.
 */
export async function POST(req: Request) {
  const { client } = await getSession();
  if (!client) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Ask a question (3 to 1,000 characters)." }, { status: 400 });
  const admin = createAdminClient();
  const [{ settings }, spent] = await Promise.all([clientSettings(admin, client.id), claudeMonthSpend(admin, client.id)]);
  if (spent >= settings.monthlyBudget) return Response.json({ error: `The monthly Claude budget ($${settings.monthlyBudget}) is used up. Raise it in AI quick wins → Settings.` }, { status: 402 });
  const blocks = await screenData(admin, client.id, p.data.screen);
  if (!blocks.length) return Response.json({ error: "This screen has no data to answer from yet." }, { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const s = anthropic().messages.stream({
          model: settings.model, max_tokens: 4000, output_config: { effort: "low" },
          system: [{ type: "text", text: ASK_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: `DATA (JSON blocks from the ${p.data.screen} screen):\n${JSON.stringify(blocks)}\n\nQUESTION: ${p.data.question}` }],
        });
        s.on("text", (t) => controller.enqueue(encoder.encode(t)));
        const final = await s.finalMessage();
        await recordAskCost(admin, client.id, callCost(settings.model, final.usage)).catch(() => undefined);
        if (final.stop_reason === "refusal") controller.enqueue(encoder.encode("\n\n(Claude declined to answer this question.)"));
        if (final.stop_reason === "max_tokens") controller.enqueue(encoder.encode("\n\n(The answer was cut off.)"));
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n[${aiErrorMessage(e)}]`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-data-used": encodeURIComponent(JSON.stringify(blocks.map((b) => `${b.source}: ${b.name}`))) } });
}
