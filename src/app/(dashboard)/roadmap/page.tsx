import { TabHeader } from "@/components/dashboard/tab-header";
import { Unavailable } from "@/components/report/report-ui";
import { RoadmapView } from "@/components/roadmap/roadmap-view";
import { getSession } from "@/lib/analytics/client-context";
import { todayIn } from "@/lib/analytics/range";
import { aiUnavailable } from "@/lib/ai/claude";
import { first, type SearchParams } from "@/lib/analytics/url";
import { getMonth, getTasks, listMonths } from "@/lib/roadmap/store";
import { monthOf, type RoadmapTask } from "@/lib/roadmap/types";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300; // generating a month runs in this request

export default async function RoadmapPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const today = todayIn(client.timezone);
  const current = monthOf(today);
  const wanted = first(sp.m);
  const month = wanted && /^\d{4}-\d{2}$/.test(wanted) ? `${wanted}-01` : current;
  const supabase = await createClient();

  let months: { id: string; month: string; generated_at: string | null }[] = [], row = null, tasks: RoadmapTask[] = [], setupNeeded = false;
  try {
    [months, row] = await Promise.all([listMonths(supabase, client.id), getMonth(supabase, client.id, month)]);
    tasks = row ? await getTasks(supabase, client.id, row.id) : [];
  } catch { setupNeeded = true; }

  const header = (
    <TabHeader source={null} eyebrow="AI intelligence" title="SEO Roadmap" description="A monthly SEO plan built from this client's data."
      guide={[
        { term: "How it's built", text: "Claude reads every connected source (Search Console, GA4, Business Profile, Bing, Clarity, DataForSEO, competitors, rank tracking, site audit, AI visibility, social) and writes tasks that cite the numbers behind them. Tasks without supporting data are dropped." },
        { term: "Refreshing", text: "A new strategy keeps completed, started, manually added and Nova tasks; only open AI tasks nobody started are replaced. Nothing is added twice." },
        { term: "Monthly", text: "Each month's strategy is prepared automatically early in the month from the latest synced data, and can be generated or refreshed by hand at any time." },
        { term: "Nova", text: "Ask Nova (bottom right) to explain, add, update, move or delete tasks and months. Nova asks for your confirmation before every change." },
      ]} />
  );
  if (setupNeeded) return (<>{header}<Unavailable title="Database update needed" body="Apply migration 20261125000025_roadmap_nova.sql in Supabase to enable the roadmap and Nova." /></>);
  const aiConfigured = !(await aiUnavailable(client.id));

  return (
    <>
      {header}
      <RoadmapView
        month={month} current={current} today={today} months={months.map((m) => m.month)} row={row} tasks={tasks}
        canEdit={["owner", "admin"].includes(client.role)} aiConfigured={aiConfigured}
      />
    </>
  );
}
