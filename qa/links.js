#!/usr/bin/env node
/**
 * Checks that the site's external links still work.
 *
 * Kept apart from qa/audit.js and the deploy gate on purpose: the audit is
 * deterministic and offline, while this depends on third-party services. A
 * passing 503 at GitHub must not block a copy change from going out, but a
 * broken link should still be found early. Hence: weekly, on copy changes,
 * and never blocking a deploy.
 *
 * Links to pedromorago.com itself are skipped: the audit resolves them
 * against the repository, and new pages only exist online after a deploy.
 *
 * Usage: `npm run links`
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OWN_ORIGIN = "https://pedromorago.com";
const TIMEOUT_MS = 15000;

// Every page a visitor can reach: home, case studies and the 404 page.
const workPages = fs
  .readdirSync(path.join(ROOT, "work"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, "work", d.name, "index.html")))
  .map((d) => `work/${d.name}/index.html`);
const HTML_FILES = ["index.html", "404.html", ...workPages];

// LinkedIn answers 999 to any client that is not a browser. That is its
// anti-scraping response, not a broken link, so only resolution is checked.
const TOLERATED = { "www.linkedin.com": [999, 403] };

const urls = new Set();
for (const file of HTML_FILES) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const m of html.matchAll(/(?:href|content)="(https?:\/\/[^"]+)"/g))
    if (!m[1].startsWith(OWN_ORIGIN)) urls.add(m[1].replace(/&amp;/g, "&"));
}

async function check(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Some servers reject HEAD; retry those with GET.
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (res.status === 405 || res.status === 501)
      res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });

    const host = new URL(url).host;
    let ok = res.ok || (TOLERATED[host] || []).includes(res.status);
    let note = "";

    // GitHub answers 200 for /releases/latest even when a repository has no
    // release at all: it redirects to the empty list. The site promises a
    // download, so the request must land on a real release.
    if (ok && url.endsWith("/releases/latest") && !/\/releases\/tag\//.test(res.url)) {
      ok = false;
      note = "answers 200 but the repository has no published release";
    }

    return { url, status: res.status, ok, finalUrl: res.url, note };
  } catch (e) {
    return { url, status: e.name === "AbortError" ? "timeout" : e.message, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const results = await Promise.all([...urls].sort().map(check));
  const broken = results.filter((r) => !r.ok);

  for (const r of results) {
    // A redirect to another host usually means the canonical URL changed and
    // the HTML still has the old one: worth a warning even when it answers.
    const moved =
      r.ok && r.finalUrl && new URL(r.finalUrl).host !== new URL(r.url).host
        ? `  (redirects to ${r.finalUrl})`
        : "";
    console.log(`${r.ok ? "✓" : "✗"} ${r.status}  ${r.url}${r.note ? `  (${r.note})` : moved}`);
  }

  console.log("");
  if (broken.length) {
    console.error(`✗ ${broken.length} of ${results.length} links are broken.`);
    process.exit(1);
  }
  console.log(`✓ ${results.length} external links work.`);
})();
