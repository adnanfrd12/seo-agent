import { AtSign, Blocks, Braces, Database, KeyRound, Radar, Sparkles, Store, Users, type LucideIcon } from "lucide-react";
import { SocialLogo } from "@/components/brand/social-logos";
import { AnalyticsIcon, GoogleG } from "@/components/brand/google-icons";
import { BingIcon, ClarityIcon, SearchConsoleIcon } from "@/components/login/login-icons";
import { cn } from "@/lib/utils";

/** Neutral symbols for services without a brand mark in the app; brand marks where the app already has them. */
const ICONS: Record<string, LucideIcon> = {
  anthropic: Sparkles, dataforseo: Database, google_api: KeyRound, composio: Blocks, lbm: Store, seosignalx: Radar,
  treg: Users, social_tokens: AtSign, custom: Braces,
};

function Mark({ id }: { id: string }) {
  switch (id) {
    case "google_oauth": return <GoogleG className="size-5" />;
    case "ga4": return <AnalyticsIcon className="size-5" />;
    case "gsc": return <SearchConsoleIcon className="size-5" />;
    case "bing": return <BingIcon className="size-5" />;
    case "clarity": return <ClarityIcon className="size-5" />;
    case "meta": return <SocialLogo platform="facebook" className="size-5" />;
    case "threads": return <SocialLogo platform="threads" className="size-5" />;
    case "tiktok": return <SocialLogo platform="tiktok" className="size-5" />;
  }
  const Icon = ICONS[id] ?? KeyRound;
  return <Icon className="size-[18px] text-secondary" aria-hidden />;
}

export function IntegrationLogo({ id, className }: { id: string; className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg border border-hairline bg-surface-sunken", className)} aria-hidden>
      <Mark id={id} />
    </span>
  );
}
