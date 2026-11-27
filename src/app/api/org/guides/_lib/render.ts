import "server-only";
import { existsSync } from "node:fs";
import { guideDocumentHtml, measuredBlocks, type GuideDocInput } from "@/components/org/guides/pdf-document";

/**
 * Prints the setup guides to PDF with the same headless Chromium pipeline as the report export
 * (src/app/api/report/pdf): @sparticuz/chromium on Vercel, CHROME_EXECUTABLE_PATH or an installed Chrome locally.
 * The HTML is built in memory and set on a blank page, so no session or network access is involved.
 *
 * The complete guide is printed in two passes: each block (contents, every section) alone first, to count its
 * pages, then the whole document with those page numbers in the contents. If counting fails, the contents simply
 * show no page numbers (the links still work).
 */
const LOCAL_CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
];

async function launch() {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  const path = process.env.CHROME_EXECUTABLE_PATH?.trim() || LOCAL_CHROME.find((p) => existsSync(p));
  if (!path) throw new Error("No Chrome found for PDF rendering. Set CHROME_EXECUTABLE_PATH.");
  return puppeteer.launch({ executablePath: path, headless: true, args: ["--no-sandbox"] });
}

/** Number of pages in a PDF printed by Chromium (each page is a "/Type /Page" object). */
export function countPdfPages(pdf: Uint8Array): number {
  return Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength).toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
}

type Browser = Awaited<ReturnType<typeof launch>>;

async function printer(browser: Browser) {
  const page = await browser.newPage();
  // nothing in the guide loads from the network (the logo is a data: URI)
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("data:") || r.url() === "about:blank" ? r.continue() : r.abort()));
  return async (html: string, outline = false): Promise<Uint8Array> => {
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    const opts = { printBackground: true, preferCSSPageSize: true, timeout: 60_000 } as const;
    if (!outline) return page.pdf(opts);
    // bookmarks for the PDF viewer's sidebar; older Chromium builds may not support them
    return page.pdf({ ...opts, tagged: true, outline: true }).catch(() => page.pdf(opts));
  };
}

/** Which page each block starts on in the complete guide (cover = page 1), or undefined when counting failed. */
async function pageMap(print: (html: string) => Promise<Uint8Array>, input: GuideDocInput): Promise<Record<string, number> | undefined> {
  const counts: Record<string, number> = {};
  for (const id of measuredBlocks(input)) {
    const n = countPdfPages(await print(guideDocumentHtml(input, id))) - 1; // minus the blank first page
    if (n < 1) return undefined;
    counts[id] = n;
  }
  const pages: Record<string, number> = {};
  let next = 1 + 1 + counts.contents; // the cover, then the contents
  for (const id of measuredBlocks(input).slice(1)) { pages[id] = next; next += counts[id]; }
  return pages;
}

export interface RenderedPdf { pdf: Buffer; pages: number; html: string }

/** Renders a guide document to PDF. The returned HTML is what was printed (for tests). */
export async function renderGuidePdf(input: GuideDocInput): Promise<RenderedPdf> {
  const browser = await launch();
  try {
    const print = await printer(browser);
    const pages = input.mode === "all" ? await pageMap(print, input).catch(() => undefined) : undefined;
    const html = guideDocumentHtml({ ...input, pages });
    const pdf = Buffer.from(await print(html, input.mode === "all"));
    return { pdf, pages: countPdfPages(pdf), html };
  } finally {
    await browser.close().catch(() => {});
  }
}
