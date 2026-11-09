import Link from "next/link";
import { keywordHref } from "@/lib/keyword-href";

/** A search keyword that opens the keyword detail page; plain "—" when empty. */
export function KeywordLink({ q, className }: { q: unknown; className?: string }) {
  const text = q == null ? "" : String(q).trim();
  if (!text) return <>—</>;
  return (
    <Link href={keywordHref(text)} className={className ?? "break-words underline decoration-border-strong underline-offset-2 hover:decoration-foreground"}>
      {text}
    </Link>
  );
}
