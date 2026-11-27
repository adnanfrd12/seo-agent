// Run: npm test. Casino / adult / pharma hack detection of the security audit (src/lib/technical/security-scan.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

const { spamScan, spamTerms, spamUrls } = await import("@/lib/technical/security-scan");
const page = "https://example.com/blog/post/";

test("a clean business page has no spam signs (no false positives on ordinary words)", () => {
  const html = `<html lang="en"><body><h1>Custom signs in Essex and Middlesex</h1><p>Book a time slot for adult education classes.
    We build casino-style marquee signs and poker-night banners.</p><a href="https://partner.org/about">Our partner</a>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}</script></body></html>`;
  const s = spamScan(html, page);
  assert.deepEqual(s.terms, []);
  assert.deepEqual(s.spamLinks, []);
  assert.deepEqual(s.hiddenLinks, []);
  assert.deepEqual(s.scripts, []);
  assert.equal(s.cjk, false);
});

test("injected casino / pharma links, hidden blocks and spam words are found", () => {
  const html = `<html lang="en"><body><p>Welcome</p>
    <div style="position:absolute;left:-9999px"><a href="https://bad-casino.example/slots">online casino</a> <a href="https://pills.example/">cheap pills</a></div>
    <a href="https://shop.example/buy-viagra-online">Buy now</a>
    <p>Best slot gacor and online casino bonus today</p></body></html>`;
  const s = spamScan(html, page);
  assert.ok(s.terms.some((t) => t.term === "online casino"), "spam words in the visible text");
  assert.ok(s.terms.some((t) => t.term === "slot gacor"));
  assert.ok(s.spamLinks.some((l) => l.href.includes("buy-viagra-online")), "a link whose address is spam");
  assert.ok(s.spamLinks.some((l) => l.href.includes("bad-casino")), "a link whose text is spam");
  assert.equal(s.hiddenLinks.length, 2, "both links inside the hidden block");
});

test("links to the site itself are never counted as spam links", () => {
  const html = `<a href="/casino-signs/">online casino signs</a><a href="https://www.example.com/x">x</a>`;
  assert.deepEqual(spamScan(html, page).spamLinks, []);
});

test("obfuscated and redirecting scripts are flagged, analytics isn't", () => {
  assert.equal(spamScan(`<script>eval(atob("ZG9jdW1lbnQud3JpdGU="))</script>`, page).scripts.length, 1);
  assert.equal(spamScan(`<script>eval(function(p,a,c,k,e,d){return p})</script>`, page).scripts.length, 1);
  assert.equal(spamScan(`<script>if(document.referrer.indexOf("google")>-1){window.location="https://x.example/online-casino"}</script>`, page).scripts.length, 1);
  assert.equal(spamScan(`<script src="https://cdn.example/app.js"></script><script>console.log(1)</script>`, page).scripts.length, 0);
});

test("Japanese keyword hack text on an English site is found, but not on a Japanese site", () => {
  assert.equal(spamScan(`<html lang="en"><p>激安 ブランド コピー 通販</p></html>`, page).cjk, true);
  assert.equal(spamScan(`<html lang="ja"><p>ブランド</p></html>`, page).cjk, false);
});

test("spam pages in a sitemap", () => {
  const urls = ["https://example.com/houston-signs/", "https://example.com/online-casino-bonus-2026/", "https://example.com/buy-cialis-cheap/", "https://example.com/%E6%BF%80%E5%AE%89/"];
  assert.deepEqual(spamUrls(urls), urls.slice(1));
  assert.deepEqual(spamUrls(urls.slice(3), true), [], "CJK addresses are fine on a CJK site");
  assert.equal(spamTerms("Time slot booking").length, 0);
});
