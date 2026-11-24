import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LoginPage from "./login/page";

export const metadata: Metadata = {
  title: "SEO, analytics and social media reporting · SEO Insights",
  description: "SEO Insights is an invite-only SEO, analytics and social media reporting platform operated by Waheed Zen LLC (Kalispell, Montana) for its client businesses. Read-only connections; sign in to view your reports.",
  alternates: { canonical: "/" },
};

/**
 * Public homepage (platform reviews require one on the app's domain): what SEO Insights is, who operates it, links to
 * the legal pages, and the sign-in box. Signed-in users go straight to their dashboard.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/overview");
  return <LoginPage searchParams={searchParams} />;
}
