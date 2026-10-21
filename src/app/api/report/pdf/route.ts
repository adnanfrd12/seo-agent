import { existsSync } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/analytics/client-context";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;

const LOCAL_CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
];

/** Vercel/Lambda: the bundled @sparticuz/chromium. Locally: CHROME_EXECUTABLE_PATH or an installed Chrome. */
async function launch() {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  const path = serverEnv().CHROME_EXECUTABLE_PATH ?? LOCAL_CHROME.find((p) => existsSync(p));
  if (!path) throw new Error("No Chrome found for PDF rendering. Set CHROME_EXECUTABLE_PATH.");
  return puppeteer.launch({ executablePath: path, headless: true, args: ["--no-sandbox"] });
}

/**
 * Server-side PDF of the sidebar-free /report page. Renders as the signed-in user (their session
 * cookies are forwarded), so RLS and membership checks apply exactly as in the browser.
 * Query: same as /report (?month= or ?start=&end=, ?type=full|executive, ?property=, ?site=).
 */
export async function GET(request: NextRequest) {
  const { client } = await getSession(); // redirects to /login when signed out
  if (!client) return NextResponse.json({ error: "No client" }, { status: 400 });

  const params = new URLSearchParams();
  for (const k of ["month", "start", "end", "type", "property", "site", "range"]) {
    const v = request.nextUrl.searchParams.get(k);
    if (v && /^[\w:-]{1,40}$/.test(v)) params.set(k, v);
  }
  const target = new URL(`/report?${params.toString()}`, request.nextUrl.origin);

  let browser: Awaited<ReturnType<typeof launch>> | null = null;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.setCookie(...request.cookies.getAll().map((c) => ({
      name: c.name, value: c.value, domain: target.hostname, path: "/", httpOnly: true, secure: target.protocol === "https:",
    })));
    await page.setViewport({ width: 1240, height: 1754 });
    await page.emulateMediaType("print");
    const res = await page.goto(target.toString(), { waitUntil: "networkidle0", timeout: 60_000 });
    if (!res || !res.ok()) throw new Error(`Report page returned ${res?.status() ?? "no response"}`);
    if (new URL(page.url()).pathname !== "/report") throw new Error("Session could not be forwarded to the renderer.");
    await new Promise((r) => setTimeout(r, 800)); // let charts finish layout
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    const kind = params.get("type") === "executive" ? "executive-summary" : "full-report";
    const period = params.get("month") ?? `${params.get("start") ?? ""}_${params.get("end") ?? ""}`;
    const safeName = client.name.replace(/[^\w-]+/g, "-").slice(0, 40) || "client";
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${safeName}-${kind}-${period}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("pdf render failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not generate the PDF. Use Print view → Save as PDF instead." }, { status: 500 });
  } finally {
    await browser?.close().catch(() => {});
  }
}
