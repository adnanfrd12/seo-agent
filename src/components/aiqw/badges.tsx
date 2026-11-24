import { SOURCE_SHORT, type Source } from "@/lib/aiqw/types";
import { cn } from "@/lib/utils";

const SRC_TONE: Record<string, string> = {
  gsc: "bg-[#e8f0fe] text-[#1a56c4] dark:bg-[#1a2b4d] dark:text-[#9fc0ff]",
  ga4: "bg-[#fff4e0] text-[#a35b00] dark:bg-[#3d2c10] dark:text-[#ffc97a]",
  dataforseo: "bg-[#efe7ff] text-[#5b34c7] dark:bg-[#2c2347] dark:text-[#c3adff]",
  crawl: "bg-surface-muted text-secondary",
  claude: "bg-[#fbe9e3] text-[#b0482a] dark:bg-[#3d2219] dark:text-[#ffb39a]",
};

/** Which data source a quick win's evidence came from (Search Console, GA4, Business Profile, Bing, Clarity, social, DataForSEO, crawl, SEOSignalX, Claude). */
export function SourceBadge({ s }: { s: Source | "claude" }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium", SRC_TONE[s] ?? "bg-series-soft text-series")}>{SOURCE_SHORT[s] ?? s}</span>;
}
