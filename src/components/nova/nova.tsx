"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUp, CalendarPlus, Check, ChevronDown, ChevronLeft, CircleAlert, FileSearch, History, ListPlus, Loader2, Maximize2, MessageSquarePlus, Minimize2,
  PenLine, Square, Store, Trash2, TrendingDown, X,
} from "lucide-react";
import { AnswerTime, StepProgress, WorkingIndicator } from "@/components/nova/answer-progress";
import { Markdown } from "@/components/nova/markdown";
import { NAV } from "@/lib/analytics/nav";
import { ROADMAP_CHANGED } from "@/lib/roadmap/types";
import { cn } from "@/lib/utils";

type Action = { tool: string; ok: boolean; summary: string };
type Activity = { id: string; name: string; status: "running" | "done" | "failed"; summary?: string; startedAt?: number };
type Confirm = { id: string; title: string; detail: string; state: "pending" | "busy" | "done" | "cancelled" | "failed"; result?: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; actions?: Action[]; activity?: Activity[]; confirms?: Confirm[]; streaming?: boolean; error?: string; startedAt?: number; finishedAt?: number; stopped?: boolean };
type Conv = { id: string; title: string; updated_at: string };

const TOOL_LABEL: Record<string, string> = {
  get_client_data_sources: "Checking connected data", get_client_analytics: "Reading analytics", get_competitor_analysis: "Reading competitor data",
  get_historical_performance: "Reading history", get_roadmap: "Reading the roadmap", get_roadmap_tasks: "Reading tasks", get_roadmap_progress: "Checking progress",
  generate_monthly_strategy: "Writing the monthly strategy", add_roadmap_task: "Adding a task", update_roadmap_task: "Updating a task",
  mark_task_completed: "Updating a task", delete_roadmap_task: "Preparing a deletion", update_monthly_strategy: "Updating the strategy",
};
const SUGGESTIONS = [
  { icon: CalendarPlus, text: "Create next month's SEO strategy" },
  { icon: ListPlus, text: "Add the most important tasks to this month's roadmap" },
  { icon: TrendingDown, text: "Analyze my recent traffic changes and what's behind them" },
  { icon: Store, text: "Give me Google Business Profile ideas for this month" },
  { icon: PenLine, text: "Suggest 5 blog topics for this month from my search data" },
];

const PAGE_PROMPT = "What does this page show for my site right now, and what should I do about it?";
const ABOUT_PAGE = /\b(this|the|current) (page|screen|tab|view)\b|\bhere\b|\bwhat (i|we) (see|am seeing|are seeing)\b/i;
/** The text visible in the page's main area (not Nova), for questions about the page. */
function visiblePageText(): string | undefined {
  const main = document.querySelector("main");
  const t = main?.innerText.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  return t ? t.slice(0, 6000) : undefined;
}

/** The open dashboard page, named like the sidebar ("Google Search Console: Pages"). */
function pageFor(path: string): { path: string; label: string } {
  let best: { href: string; label: string } | null = null;
  for (const g of NAV) for (const it of g.items) {
    const options = [{ href: it.href, label: it.label }, ...(it.children ?? []).map((c) => ({ href: c.href, label: c.href === it.href ? it.label : `${it.label}: ${c.label}` }))];
    for (const o of options) if ((path === o.href || path.startsWith(`${o.href}/`)) && (!best || o.href.length > best.href.length)) best = o;
  }
  return { path, label: best?.label ?? "This page" };
}

/** Nova's mark: a large four-point sparkle with a small one, drawn as SVG so it stays sharp at any size. */
export function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M10 3.5c.45 3.6 2.9 6.05 6.5 6.5-3.6.45-6.05 2.9-6.5 6.5-.45-3.6-2.9-6.05-6.5-6.5 3.6-.45 6.05-2.9 6.5-6.5Z" />
      <path d="M17.6 13.2c.22 1.75 1.43 2.96 3.2 3.2-1.77.24-2.98 1.45-3.2 3.2-.24-1.75-1.45-2.96-3.2-3.2 1.75-.24 2.96-1.45 3.2-3.2Z" opacity=".9" />
    </svg>
  );
}

function Orb({ size = 40 }: { size?: number }) {
  return (
    <span className="nova-orb relative grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size }}>
      <Sparkle className="relative z-10 text-white" />
    </span>
  );
}

let seq = 0;
const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

export function Nova({ firstName, clientName, canEdit }: { firstName: string | null; clientName: string; canEdit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const page = useMemo(() => pageFor(pathname ?? "/"), [pathname]);
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopReady, setStopReady] = useState(false);
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<(text: string) => void>(() => {});

  const changed = useCallback(() => { window.dispatchEvent(new Event(ROADMAP_CHANGED)); router.refresh(); }, [router]);
  const patchLast = (fn: (m: Msg) => Msg) => setMessages((ms) => { const i = ms.length - 1; if (i < 0 || ms[i].role !== "assistant") return ms; const next = [...ms]; next[i] = fn(ms[i]); return next; });

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput(""); setView("chat"); setBusy(true); setStopReady(false);
    setTimeout(() => setStopReady(true), 1200);
    setMessages((ms) => [...ms, { id: uid(), role: "user", content: text }, { id: uid(), role: "assistant", content: "", activity: [], confirms: [], streaming: true, startedAt: Date.now() }]);
    const ac = new AbortController(); abort.current = ac;
    try {
      const res = await fetch("/api/nova/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId, message: text, page: { ...page, text: text === PAGE_PROMPT || ABOUT_PAGE.test(text) ? visiblePageText() : undefined } }), signal: ac.signal });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: "Nova couldn't answer. Try again." }));
        patchLast((m) => ({ ...m, streaming: false, error: j.error ?? "Nova couldn't answer. Try again." }));
        return;
      }
      if (!(res.headers.get("content-type") ?? "").includes("ndjson")) {
        patchLast((m) => ({ ...m, error: "Nova couldn't answer: your session may have expired. Reload the page and try again." }));
        return;
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "", didChange = false, finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let e: Record<string, unknown>;
          try { e = JSON.parse(line); } catch { continue; }
          if (e.t === "start" || e.t === "done") { if (e.conversationId) setConversationId(String(e.conversationId)); }
          if (e.t === "done") finished = true;
          if (e.t === "text") patchLast((m) => ({ ...m, content: m.content + String(e.v) }));
          if (e.t === "tool") patchLast((m) => {
            const act = m.activity ?? [];
            const i = act.findIndex((a) => a.id === e.id);
            const item: Activity = { id: String(e.id), name: String(e.name), status: e.status as Activity["status"], summary: e.summary as string | undefined };
            return { ...m, activity: i >= 0 ? act.map((a, j) => (j === i ? { ...a, ...item } : a)) : [...act, { ...item, startedAt: Date.now() }] };
          });
          if (e.t === "confirm") patchLast((m) => ({ ...m, confirms: [...(m.confirms ?? []), { id: String(e.id), title: String(e.title), detail: String(e.detail ?? ""), state: "pending" }] }));
          if (e.t === "changed") { didChange = true; window.dispatchEvent(new Event(ROADMAP_CHANGED)); }
          if (e.t === "error") patchLast((m) => ({ ...m, error: String(e.message) }));
        }
      }
      if (didChange) router.refresh();
      if (!finished) patchLast((m) => ({ ...m, error: "The connection dropped before Nova finished. Open the conversation from history or try again." }));
    } catch (err) {
      if ((err as Error).name === "AbortError") patchLast((m) => ({ ...m, stopped: true }));
      else patchLast((m) => ({ ...m, error: "The connection was interrupted. Try again." }));
    } finally {
      patchLast((m) => ({ ...m, streaming: false, finishedAt: Date.now() }));
      setBusy(false); abort.current = null; setConvs(null);
    }
  }, [busy, conversationId, router, page]);
  useEffect(() => { sendRef.current = (t) => { void send(t); }; }, [send]);

  // "Ask Nova" buttons elsewhere in the dashboard open the panel with a prompt
  useEffect(() => {
    const on = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      setOpen(true);
      if (prompt) setTimeout(() => sendRef.current(prompt), 50);
    };
    window.addEventListener("nova:open", on);
    return () => window.removeEventListener("nova:open", on);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60); }, [open]);
  const shown = useRef(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !messages.length) { shown.current = messages.length; return; }
    const grew = messages.length !== shown.current;
    shown.current = messages.length;
    if (grew || el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (!open || view !== "history" || convs) return;
    let live = true;
    fetch("/api/nova/conversations").then((r) => r.json()).then((j) => { if (live) setConvs(j.conversations ?? []); }).catch(() => { if (live) setConvs([]); });
    return () => { live = false; };
  }, [open, view, convs]);

  const close = () => { setOpen(false); setTimeout(() => launcher.current?.focus(), 0); };
  const newChat = () => { abort.current?.abort(); setConversationId(null); setMessages([]); setView("chat"); setTimeout(() => inputRef.current?.focus(), 30); };
  const openConv = async (id: string) => {
    setView("chat"); setConversationId(id); setMessages([]);
    const j = await fetch(`/api/nova/conversations?id=${id}`).then((r) => r.json()).catch(() => null);
    if (!j?.messages) return;
    const ms: Msg[] = (j.messages as { id: string; role: "user" | "assistant"; content: string; actions: Action[] }[]).map((m) => ({ id: m.id, role: m.role, content: m.content, actions: m.actions }));
    const pend = (j.pending as { id: string; summary: string }[] | undefined) ?? [];
    if (pend.length && ms.length) ms[ms.length - 1] = { ...ms[ms.length - 1], confirms: pend.map((p) => ({ id: p.id, title: p.summary, detail: "", state: "pending" })) };
    setMessages(ms);
  };
  const removeConv = async (id: string) => {
    await fetch(`/api/nova/conversations?id=${id}`, { method: "DELETE" }).catch(() => null);
    setConvs((c) => (c ?? []).filter((x) => x.id !== id));
    if (id === conversationId) newChat();
  };
  const decide = async (msgId: string, c: Confirm, decision: "confirm" | "cancel") => {
    const set = (patch: Partial<Confirm>) => setMessages((ms) => ms.map((m) => (m.id === msgId ? { ...m, confirms: (m.confirms ?? []).map((x) => (x.id === c.id ? { ...x, ...patch } : x)) } : m)));
    set({ state: "busy" });
    const j = await fetch("/api/nova/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, decision }) }).then((r) => r.json()).catch(() => ({ ok: false, message: "The request failed. Try again." }));
    set({ state: decision === "cancel" ? "cancelled" : j.ok ? "done" : "failed", result: j.message ?? j.error });
    if (j.changed) changed();
  };

  return (
    <>
      {/* launcher */}
      <div className={cn("fixed bottom-5 right-5 z-40 print:hidden", open && "pointer-events-none opacity-0 max-sm:hidden")}>
        <button ref={launcher} type="button" onClick={() => setOpen(true)} aria-label="Ask Nova, your AI SEO strategist" aria-expanded={open}
          className="nova-launcher group relative grid size-[58px] place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-accent/40">
          <span className="nova-orb absolute inset-0 rounded-full" aria-hidden />
          <Sparkle className="relative z-10 size-7 text-white transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
          <span role="tooltip" className="pointer-events-none absolute right-[calc(100%+12px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-surface opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Ask Nova</span>
        </button>
      </div>

      {/* panel */}
      <aside aria-label="Nova, AI SEO strategist" aria-hidden={!open} inert={!open}
        onKeyDown={(e) => { if (e.key === "Escape") close(); }}
        className={cn("nova-panel fixed inset-0 z-50 flex flex-col overflow-hidden bg-surface transition-[transform,width] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] print:hidden",
          "sm:inset-y-3 sm:left-auto sm:right-3 sm:rounded-2xl sm:border sm:border-border sm:shadow-[0_24px_64px_-20px_rgb(0_0_0/0.4)]",
          wide ? "sm:w-[min(760px,calc(100vw-1.5rem))]" : "sm:w-[440px]", open ? "translate-x-0" : "translate-x-[calc(100%+2rem)]")}>
        <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          {view === "history"
            ? <button type="button" onClick={() => setView("chat")} aria-label="Back to the conversation" className="grid size-9 place-items-center rounded-lg text-secondary hover:bg-surface-muted hover:text-foreground"><ChevronLeft className="size-5" /></button>
            : <Orb size={38} />}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[16px] font-semibold leading-tight">{view === "history" ? "Conversations" : "Nova"}{view === "chat" && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">AI</span>}</p>
            <p className="truncate text-xs text-muted">{view === "history" ? clientName : "Your AI SEO Strategist"}</p>
          </div>
          <div className="flex items-center gap-0.5">
            <IconBtn label="New conversation" onClick={newChat}><MessageSquarePlus className="size-[18px]" /></IconBtn>
            <IconBtn label="Conversation history" onClick={() => setView(view === "history" ? "chat" : "history")} active={view === "history"}><History className="size-[18px]" /></IconBtn>
            <IconBtn label={wide ? "Narrow panel" : "Wide panel"} onClick={() => setWide((w) => !w)} className="max-sm:hidden">{wide ? <Minimize2 className="size-[18px]" /> : <Maximize2 className="size-[18px]" />}</IconBtn>
            <IconBtn label="Close Nova" onClick={close}><X className="size-[18px]" /></IconBtn>
          </div>
        </header>

        {view === "history" ? (
          <div className="flex-1 overflow-y-auto p-3">
            {convs === null ? <p className="flex items-center gap-2 p-3 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Loading…</p>
              : convs.length === 0 ? <p className="p-6 text-center text-sm text-muted">No conversations yet.</p>
              : <ul className="space-y-1">{convs.map((c) => (
                <li key={c.id} className="group flex items-center gap-1 rounded-lg hover:bg-surface-muted">
                  <button type="button" onClick={() => openConv(c.id)} className={cn("min-w-0 flex-1 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg", c.id === conversationId && "font-medium")}>
                    <span className="block truncate text-sm">{c.title}</span>
                    <span className="block text-[11px] text-muted">{new Date(c.updated_at).toLocaleString()}</span>
                  </button>
                  <button type="button" onClick={() => removeConv(c.id)} aria-label={`Delete "${c.title}"`} className="mr-1 grid size-8 place-items-center rounded-md text-muted opacity-0 hover:text-negative group-hover:opacity-100 focus-visible:opacity-100"><Trash2 className="size-4" /></button>
                </li>))}</ul>}
          </div>
        ) : (
          <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <div className="space-y-5">
                <div className="nova-hero relative overflow-hidden rounded-2xl border border-border p-4">
                  <div className="flex gap-3.5">
                    <Orb size={46} />
                    <div className="min-w-0">
                      <p className="text-[18px] font-semibold leading-tight">Hi{firstName ? ` ${firstName}` : ""}! 👋</p>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">I&apos;m Nova, your AI SEO strategist for {clientName}. I read your connected data to analyse performance, plan strategies, and {canEdit ? "manage your roadmap and tasks for you" : "explain your roadmap and tasks"}.</p>
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => send(PAGE_PROMPT)} className="group flex w-full items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft/60 px-3.5 py-3 text-left outline-none transition hover:border-accent/50 hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-accent">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-accent shadow-[0_1px_2px_rgb(0_0_0/0.06)]"><FileSearch className="size-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold">Ask about this page</span>
                    <span className="block truncate text-xs text-secondary">{page.label}: what it shows and what to do</span>
                  </span>
                  <ChevronDown className="size-4 -rotate-90 text-accent transition group-hover:translate-x-0.5" aria-hidden />
                </button>
                <div>
                  <p className="mb-2 text-sm font-semibold">Try asking me</p>
                  <ul className="space-y-2">
                    {SUGGESTIONS.filter((s) => canEdit || !/Create|Add/.test(s.text)).map((s) => (
                      <li key={s.text}>
                        <button type="button" onClick={() => send(s.text)} className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left text-[13.5px] outline-none transition hover:border-border-strong hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-accent">
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><s.icon className="size-4" aria-hidden /></span>
                          <span className="min-w-0 flex-1">{s.text}</span>
                          <ChevronDown className="size-4 -rotate-90 text-faint transition group-hover:translate-x-0.5 group-hover:text-secondary" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <ul className="space-y-5">
                {messages.map((m) => (
                  <li key={m.id} className={cn(m.role === "user" && "flex justify-end")}>
                    {m.role === "user" ? (
                      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-foreground px-3.5 py-2.5 text-[14px] leading-relaxed text-surface">{m.content}</p>
                    ) : (
                      <div className="flex gap-2.5">
                        <Orb size={28} />
                        <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
                          <ActivityList activity={m.activity} actions={m.actions} live={Boolean(m.streaming)} />
                          {m.content && <Markdown text={m.content} />}
                          {m.streaming && m.startedAt && (
                            <WorkingIndicator startedAt={m.startedAt}
                              label={(() => { const run = m.activity?.find((a) => a.status === "running"); return run ? `${TOOL_LABEL[run.name] ?? "Working"}…` : m.content ? "Writing…" : "Thinking…"; })()} />
                          )}
                          {m.stopped && !m.content && <p className="text-[13px] text-muted">Stopped before Nova answered. If it finished in the background, the answer is in the conversation history.</p>}
                          {!m.streaming && m.startedAt && m.finishedAt && !m.error && <AnswerTime ms={m.finishedAt - m.startedAt} stopped={m.stopped} />}
                          {(m.confirms ?? []).map((c) => <ConfirmCard key={c.id} c={c} canAct={canEdit} onDecide={(d) => decide(m.id, c, d)} />)}
                          {m.error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-negative-soft px-3 py-2 text-[13px] text-negative"><CircleAlert className="mt-0.5 size-4 shrink-0" />{m.error}</p>}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {view === "chat" && (
          <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="border-t border-hairline p-3">
            {messages.length > 0 && (
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-[11.5px] text-secondary" title="Nova knows which page you have open">
                  <FileSearch className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{page.label}</span>
                </span>
                <button type="button" onClick={() => send(PAGE_PROMPT)} disabled={busy} className="shrink-0 rounded text-[12px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">Ask about this page</button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-1.5 pl-3.5 transition focus-within:border-border-strong focus-within:ring-4 focus-within:ring-accent/10">
              <label htmlFor="nova-input" className="sr-only">Message Nova</label>
              <textarea id="nova-input" ref={inputRef} rows={1} value={input} maxLength={4000} placeholder="Message Nova…" disabled={busy}
                onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
                className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] leading-snug outline-none placeholder:text-faint disabled:opacity-60" />
              {busy
                ? <button type="button" onClick={() => abort.current?.abort()} disabled={!stopReady} aria-label="Stop answering" title="Stop answering" className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground text-surface transition hover:opacity-90 disabled:opacity-40"><Square className="size-3.5 fill-current" /></button>
                : <button type="submit" disabled={!input.trim()} aria-label="Send" className="nova-send grid size-9 shrink-0 place-items-center rounded-xl text-white transition disabled:opacity-40"><ArrowUp className="size-[18px]" strokeWidth={2.5} /></button>}
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-faint">Nova uses this client&apos;s connected data and can make mistakes. Deleting tasks or replacing a strategy always asks you first.</p>
          </form>
        )}
      </aside>
    </>
  );
}

function IconBtn({ label, onClick, children, active, className }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; className?: string }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className={cn("grid size-9 place-items-center rounded-lg text-secondary outline-none transition hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent", active && "bg-surface-muted text-foreground", className)}>{children}</button>;
}

/** What Nova did: a live list while it works, then a collapsible summary. */
function ActivityList({ activity, actions, live }: { activity?: Activity[]; actions?: Action[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const items = activity?.length ? activity.map((a) => ({ key: a.id, status: a.status, startedAt: a.startedAt, long: a.name === "generate_monthly_strategy", text: a.summary ?? `${TOOL_LABEL[a.name] ?? a.name}${a.status === "failed" ? " (didn't work)" : ""}` }))
    : (actions ?? []).map((a, i) => ({ key: String(i), status: a.ok ? "done" as const : "failed" as const, startedAt: undefined as number | undefined, long: false, text: a.summary }));
  if (!items.length) return null;
  const running = items.some((i) => i.status === "running");
  const expanded = open || running || Boolean(live);
  const writes = items.filter((i) => /^(Added|Updated|Completed|Reopened|Generated|Deleted|Waiting)/.test(i.text) && i.status === "done").length;
  return (
    <div className="rounded-xl border border-hairline bg-surface-sunken text-[12.5px]">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={Boolean(live)} aria-expanded={expanded} className="flex w-full items-center gap-2 px-3 py-2 text-left text-secondary hover:text-foreground disabled:cursor-default">
        {live ? <Loader2 className="size-3.5 animate-spin text-accent" /> : <Check className="size-3.5 text-positive" />}
        <span className="min-w-0 flex-1 truncate">{live ? "What Nova is doing" : `${items.length} step${items.length > 1 ? "s" : ""}${writes ? ` · ${writes} roadmap change${writes > 1 ? "s" : ""}` : ""}`}</span>
        {!live && <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />}
      </button>
      {expanded && (
        <ul className="space-y-1 border-t border-hairline px-3 py-2">
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-2">
              {i.status === "running" ? <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-muted" /> : i.status === "failed" ? <X className="mt-0.5 size-3 shrink-0 text-negative" /> : <Check className="mt-0.5 size-3 shrink-0 text-positive" />}
              <span className="min-w-0 flex-1">
                <span className={cn("leading-snug", i.status === "failed" ? "text-negative" : "text-secondary")}>{i.text}{i.status === "running" ? "…" : ""}</span>
                {i.status === "running" && i.long && i.startedAt && <span className="mt-1.5 block"><StepProgress startedAt={i.startedAt} expectedS={150} label="Usually about 2 minutes" /></span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfirmCard({ c, canAct, onDecide }: { c: Confirm; canAct: boolean; onDecide: (d: "confirm" | "cancel") => void }) {
  const settled = c.state === "done" || c.state === "cancelled" || c.state === "failed";
  return (
    <div className={cn("rounded-xl border p-3.5", settled ? "border-hairline bg-surface-sunken" : "border-warn/40 bg-warn-soft")}>
      <p className="text-[13px] font-semibold">{c.title}</p>
      {c.detail && <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-secondary">{c.detail}</p>}
      {settled ? (
        <p className={cn("mt-2 flex items-start gap-1.5 text-[12.5px] font-medium", c.state === "done" ? "text-positive" : c.state === "failed" ? "text-negative" : "text-muted")}>
          {c.state === "done" ? <Check className="mt-0.5 size-3.5 shrink-0" /> : <X className="mt-0.5 size-3.5 shrink-0" />}{c.result ?? (c.state === "cancelled" ? "Cancelled." : "")}
        </p>
      ) : canAct ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => onDecide("confirm")} disabled={c.state === "busy"} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[13px] font-medium text-surface hover:opacity-90 disabled:opacity-60">
            {c.state === "busy" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Confirm
          </button>
          <button type="button" onClick={() => onDecide("cancel")} disabled={c.state === "busy"} className="h-8 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-muted disabled:opacity-60">Cancel</button>
        </div>
      ) : <p className="mt-2 text-[12px] text-muted">Only owners and admins can confirm this.</p>}
    </div>
  );
}
