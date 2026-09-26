#!/usr/bin/env node
/**
 * QA audit for pedromorago.com. Runs in CI on every push and pull request, and
 * locally with `npm run qa`. Works over file:// with no network, so it is
 * deterministic and cannot fail for reasons outside the repository.
 *
 * It audits the repository by default. In CI it runs with SITE_ROOT=_site, the
 * folder that is actually published, so a file left out of the deploy fails.
 *
 * Pages are discovered from disk: every HTML file under the site root without
 * a noindex tag is an indexable page and gets the full browser audit.
 *
 * Before the browser opens (static):
 *  - static-files: robots.txt (points to the sitemap, doesn't block the site),
 *    sitemap.xml listing exactly the indexable pages, 404.html (noindex), and
 *    the /en/ and /work/ redirect stubs (noindex, canonical to the root, meta
 *    refresh to the right place)
 *  - pages-match-source: work/<slug>/index.html exists for exactly the slugs
 *    in src/work/*.en.json
 *  - internal-links on 404.html and the redirect stubs
 *
 * In a real browser, on every indexable page:
 *  - overflow: no horizontal scroll at 320, 390, 412, 768, 1280 and 1920 px
 *  - errors: no JavaScript errors and no console errors
 *  - no-external-requests: nothing is requested outside file:, data: or blob:
 *  - internal-links: every relative or root-absolute link, and every image,
 *    stylesheet and script, resolves to a file under the site root; fragments
 *    must match an id on the target page
 *  - unique-ids, headings (one h1, no skipped levels)
 *  - metadata: title, description length, canonical, html lang, no hreflang,
 *    exactly one valid JSON-LD block
 *  - share-preview: og:type for the kind of page, og:url, og:image file exists,
 *    is 1200x630 and shows the page's current headline (qa/og-sources.json,
 *    written by npm run og), twitter:card summary_large_image
 *  - contrast: >= 4.5:1 (WCAG AA) in light and in dark mode, for a list of
 *    text styles plus a sweep of every visible text node
 *  - tap-targets: nav links, buttons, breadcrumb links and the next-case link
 *    >= 24px tall at 320, 390 and 412 px
 *  - new-tab-links: target=_blank links have rel=noopener and screen reader
 *    text; mailto links never open a new tab
 *  - skip-link: first focusable element, lands on <main>
 *  - nav-active: home highlights the section in view; case pages mark Work
 *
 * In a real browser, on 404.html: overflow, errors, no-external-requests and
 * contrast (light and dark).
 */
const path = require("node:path");
const fs = require("node:fs");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("playwright-core"));
}

const REPO = path.join(__dirname, "..");
const ROOT = process.env.SITE_ROOT ? path.resolve(REPO, process.env.SITE_ROOT) : REPO;
const SITE_URL = "https://pedromorago.com/";
const VIEWPORTS = [320, 390, 412, 768, 1280, 1920];
const TAP_WIDTHS = [320, 390, 412];
const TAP_SELECTORS = ".nav-links a, .btn, .breadcrumb a, .case-next a";
const IGNORED_DIRS = new Set(["node_modules", ".git", ".github", "qa", "src", "_site"]);

// Redirect stubs: old or index-less addresses and where they must send people.
const STUBS = [
  { file: "en/index.html", to: "/" },
  { file: "work/index.html", to: "/#work" },
];

// Text styles whose contrast is measured. "required" selectors must exist on
// every page of that kind; "optional" ones are measured where they appear, and
// each must appear on at least one page so none is silently skipped.
const CONTRAST = {
  shared: [".nav-logo", ".nav-links a", ".footer p", ".footer a", ".btn-primary", ".btn-ghost"],
  home: {
    required: [
      ".hero-lede", ".hero-role", ".hero-tagline", ".glance h2", ".glance dt", ".glance dd",
      ".glance-email", ".copy-status", ".section h2", ".feature-kicker", ".feature h3", ".feature-text",
      ".built-label", ".built h4", ".built p", ".status", ".notes-lede", ".note h3", ".note p", ".note a",
      ".contact-text", ".contact-email", ".contact-note", ".btn-small", ".btn-small-primary",
      ".built .btn-small-primary",
    ],
    optional: [],
  },
  case: {
    required: [
      ".breadcrumb a", ".breadcrumb [aria-current]", ".case-kicker", ".case h1", ".case-lede",
      ".case-facts dt", ".case-facts dd", ".case-body h2", ".case-body p", ".case-contact h2",
      ".case-contact p", ".case-contact a:not(.btn)", ".case-next p", ".case-next a",
    ],
    optional: [
      ".case-facts a", ".case-body h3", ".case-body li", ".case-body code", ".case-tech",
      ".problem dt", ".problem dd", ".steps li", ".check-list li", ".btn-small", ".btn-small-primary",
    ],
  },
};

// The text a share image shows. npm run og records it in qa/og-sources.json
// when it takes the screenshots; a later copy change without a new image fails.
const OG_TEXT = ".hero h1, .hero-lede, .case-kicker, .case h1";
const OG_SOURCES_FILE = path.join(__dirname, "og-sources.json");
const OG_SOURCES = fs.existsSync(OG_SOURCES_FILE) ? JSON.parse(fs.readFileSync(OG_SOURCES_FILE, "utf8")) : {};

const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

const failures = [];
const fail = (check, msg) => failures.push(`[${check}] ${msg}`);
const fileUrl = (f) => "file://" + path.join(ROOT, f);
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const read = (f) => (exists(f) ? fs.readFileSync(path.join(ROOT, f), "utf8") : null);

// ---------------------------------------------------------------- discovery

function htmlFiles(dir = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) out.push(...htmlFiles(rel));
    } else if (entry.name.endsWith(".html")) out.push(rel);
  }
  return out.sort();
}

const isNoindex = (html) => /<meta name="robots" content="[^"]*noindex/.test(html);

/** The canonical URL a page file must declare, from where it sits on disk. */
function canonicalFor(file) {
  if (file === "index.html") return SITE_URL;
  if (file.endsWith("/index.html")) return SITE_URL + file.slice(0, -"index.html".length);
  return SITE_URL + file;
}

const ALL_HTML = htmlFiles();
const PAGES = ALL_HTML.filter((f) => !isNoindex(read(f))).map((file) => {
  const kind = file === "index.html" ? "home" : /^work\/[^/]+\/index\.html$/.test(file) ? "case" : "other";
  return { file, kind, canonical: canonicalFor(file), ogType: kind === "home" ? "profile" : "article" };
});

// ------------------------------------------------------------ link resolver

/** The ids declared in an HTML file on disk. */
const idCache = new Map();
function idsIn(file) {
  if (!idCache.has(file)) {
    const html = read(file) || "";
    idCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idCache.get(file);
}

/**
 * Resolves a link as a static host would: root-absolute paths against the
 * repository root, relative paths against the page's folder, query strings
 * dropped, a folder meaning its index.html. Returns an error string or null.
 * `ownIds` are the ids of the page the link is on (from the live DOM).
 */
function resolveLink(fromFile, ref, ownIds) {
  if (/^(https?:|mailto:|tel:|data:|blob:)/i.test(ref)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return `unexpected scheme in "${ref}"`;
  if (ref === "#" || ref === "") return null;
  const [beforeHash, fragment = ""] = ref.split("#");
  const pathPart = beforeHash.split("?")[0];
  let target = fromFile;
  if (pathPart) {
    const joined = pathPart.startsWith("/")
      ? path.posix.normalize(pathPart.slice(1))
      : path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), pathPart));
    if (joined.startsWith("..")) return `"${ref}" points outside the site`;
    target = joined === "." || joined === "" ? "" : joined;
    const abs = path.join(ROOT, target);
    if (pathPart.endsWith("/") || (fs.existsSync(abs) && fs.statSync(abs).isDirectory()))
      target = path.posix.join(target, "index.html");
    if (!exists(target)) return `"${ref}" points to ${target}, which does not exist`;
  }
  if (fragment) {
    const ids = target === fromFile && ownIds ? ownIds : idsIn(target);
    if (!ids.has(decodeURIComponent(fragment))) return `"${ref}": no element with id "${fragment}" in ${target}`;
  }
  return null;
}

// ------------------------------------------------------------- static checks

function checkStaticFiles() {
  const C = "static-files";
  const robots = read("robots.txt");
  if (!robots) fail(C, "robots.txt is missing");
  else {
    if (!robots.split(/\r?\n/).some((l) => l.trim() === `Sitemap: ${SITE_URL}sitemap.xml`))
      fail(C, "robots.txt does not point to the sitemap");
    const everyone = robots.split(/\r?\n\s*\r?\n/).find((g) => /^\s*User-agent:\s*\*\s*$/im.test(g));
    if (everyone && /^\s*Disallow:\s*\/\s*$/im.test(everyone)) fail(C, "robots.txt blocks the whole site for all crawlers");
  }

  // The sitemap must list exactly the indexable pages found on disk.
  const sitemap = read("sitemap.xml");
  if (!sitemap) fail(C, "sitemap.xml is missing");
  else {
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const expected = PAGES.map((p) => p.canonical);
    for (const url of expected) if (!listed.includes(url)) fail(C, `sitemap.xml does not list ${url}`);
    for (const url of listed) if (!expected.includes(url)) fail(C, `sitemap.xml lists ${url}, which is not an indexable page`);
    const dupes = listed.filter((u, i) => listed.indexOf(u) !== i);
    if (dupes.length) fail(C, `sitemap.xml lists ${dupes.join(", ")} more than once`);
  }

  const notFound = read("404.html");
  if (!notFound) fail(C, "404.html is missing");
  else if (!isNoindex(notFound)) fail(C, "404.html has no robots noindex");

  for (const stub of STUBS) {
    const html = read(stub.file);
    if (!html) {
      fail(C, `${stub.file} (redirect) is missing`);
      continue;
    }
    if (!isNoindex(html)) fail(C, `${stub.file} has no robots noindex`);
    if (!html.includes(`<link rel="canonical" href="${SITE_URL}" />`)) fail(C, `${stub.file} has no canonical to ${SITE_URL}`);
    if (!html.includes(`<meta http-equiv="refresh" content="0; url=${stub.to}" />`))
      fail(C, `${stub.file} does not refresh to ${stub.to}`);
    if (!html.includes(`href="${stub.to}"`)) fail(C, `${stub.file} has no visible link to ${stub.to}`);
  }

  for (const p of PAGES)
    if (p.kind === "other") fail(C, `${p.file} is indexable but is neither the home page nor a case study`);
}

function checkPagesMatchSource() {
  const C = "pages-match-source";
  const slugs = fs
    .readdirSync(path.join(REPO, "src", "work"))
    .filter((f) => f.endsWith(".en.json"))
    .map((f) => f.slice(0, -".en.json".length))
    .sort();
  const onDisk = fs
    .readdirSync(path.join(ROOT, "work"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && exists(`work/${d.name}/index.html`))
    .map((d) => d.name)
    .sort();
  for (const s of slugs) if (!onDisk.includes(s)) fail(C, `src/work/${s}.en.json has no work/${s}/index.html (run node build.js)`);
  for (const s of onDisk) if (!slugs.includes(s)) fail(C, `work/${s}/index.html has no source in src/work/ (remove it)`);
}

function checkStaticLinks() {
  for (const file of ["404.html", ...STUBS.map((s) => s.file)]) {
    const html = read(file);
    if (!html) continue;
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const err = resolveLink(file, m[1]);
      if (err) fail("internal-links", `${file}: ${err}`);
    }
  }
}

// ------------------------------------------------------------ browser checks

/** Opens a page with listeners for errors and outgoing requests. */
async function open(browser, pageDef, options) {
  const tag = pageDef.file;
  const page = await browser.newPage(options);
  page.on("pageerror", (e) => fail("errors", `${tag}: JavaScript error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") fail("errors", `${tag}: console error: ${m.text()}`);
  });
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) fail("no-external-requests", `${tag}: requested ${r.url()}`);
  });
  await page.goto(fileUrl(pageDef.file), { waitUntil: "load" });
  await page.waitForTimeout(250);
  return page;
}

/** Contrast of the first element matching each selector, against its effective background. */
function measureContrast(page, selectors) {
  return page.evaluate((sels) => {
    function rgba(str) {
      const nums = (str.match(/[\d.]+/g) || []).map(Number);
      // Chromium may report colours as color(srgb r g b / a) with 0..1 channels.
      if (str.startsWith("color(")) return [nums[0] * 255, nums[1] * 255, nums[2] * 255, nums[3] ?? 1];
      return [nums[0], nums[1], nums[2], nums[3] ?? 1];
    }
    function lum([r, g, b]) {
      [r, g, b] = [r, g, b].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function bgOf(el) {
      for (let e = el; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (rgba(c)[3] === 1) return c;
      }
      return getComputedStyle(document.body).backgroundColor;
    }
    // Semi-transparent text is blended with its background first.
    function ratio(el) {
      const bg = rgba(bgOf(el));
      const fg = rgba(getComputedStyle(el).color);
      const blended = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const [a, b] = [lum(blended), lum(bg)].sort((x, y) => y - x);
      return +((a + 0.05) / (b + 0.05)).toFixed(2);
    }
    const results = sels.map((sel) => {
      const el = document.querySelector(sel);
      return el ? { sel, ratio: ratio(el) } : { sel, missing: true };
    });
    // Sweep: every visible text node, once per colour pair, so a text style
    // missing from the list above is still measured.
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!walker.currentNode.textContent.trim() || !el.getClientRects().length || el.closest(".sr-only, [hidden]")) continue;
      const key = getComputedStyle(el).color + "|" + bgOf(el);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = el.tagName.toLowerCase() + [...el.classList].map((c) => "." + c).join("");
      results.push({ sel: `${name} (text sweep)`, ratio: ratio(el), sweep: true });
    }
    return results;
  }, selectors);
}

async function auditPage(browser, pageDef, seenOptional) {
  const tag = pageDef.file;

  // Per viewport: overflow and tap targets.
  for (const width of VIEWPORTS) {
    const page = await open(browser, pageDef, { viewport: { width, height: 900 } });
    const r = await page.evaluate((tapSel) => {
      const doc = document.documentElement;
      const small = [...document.querySelectorAll(tapSel)]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({ h: el.getBoundingClientRect().height, text: el.textContent.trim().slice(0, 40) }))
        .filter((t) => t.h < 24);
      return { overflow: doc.scrollWidth > doc.clientWidth, scrollWidth: doc.scrollWidth, small };
    }, TAP_SELECTORS);
    if (r.overflow) fail("overflow", `${tag}: horizontal scroll at ${width}px (content is ${r.scrollWidth}px wide)`);
    if (TAP_WIDTHS.includes(width))
      for (const t of r.small)
        fail("tap-targets", `${tag}: "${t.text}" is ${t.h.toFixed(1)}px tall at ${width}px (minimum 24px)`);
    await page.close();
  }

  // Document checks, once, on desktop in light mode.
  const page = await open(browser, pageDef, { viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const doc = await page.evaluate((OG_TEXT) => {
    const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    const skip = document.querySelector(".skip-link");
    const skipTarget = skip ? document.getElementById((skip.getAttribute("href") || "").slice(1)) : null;
    const focusable = document.querySelector("a[href], button:not([hidden]), input, select, textarea, [tabindex]");
    return {
      lang: document.documentElement.lang,
      title: document.title,
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "",
      hreflangs: [...document.querySelectorAll("link[hreflang]")].map((l) => l.getAttribute("hreflang")),
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
      ogType: meta('meta[property="og:type"]'),
      ogUrl: meta('meta[property="og:url"]'),
      ogTitle: meta('meta[property="og:title"]'),
      ogDescription: meta('meta[property="og:description"]'),
      ogImage: meta('meta[property="og:image"]'),
      ogText: [...document.querySelectorAll(OG_TEXT)].map((e) => e.textContent.trim()).join("\n"),
      twitterCard: meta('meta[name="twitter:card"]'),
      twitterImage: meta('meta[name="twitter:image"]'),
      h1Count: hs.filter((h) => h === 1).length,
      firstHeading: hs[0],
      jumps: hs.map((h, i) => (i && h - hs[i - 1] > 1 ? `h${hs[i - 1]} to h${h}` : null)).filter(Boolean),
      ids,
      duplicateIds: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))],
      refs: [
        ...[...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
        ...[...document.querySelectorAll("img[src], script[src]")].map((e) => e.getAttribute("src")),
        ...[...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")),
      ],
      newTab: [...document.querySelectorAll('a[target="_blank"]')].map((a) => ({
        href: a.getAttribute("href"),
        noopener: (a.getAttribute("rel") || "").split(/\s+/).includes("noopener"),
        srText: [...a.querySelectorAll(".sr-only")].some((s) => s.textContent.includes("opens in a new tab")),
      })),
      mailtoNewTab: [...document.querySelectorAll('a[href^="mailto:"][target]')].map((a) => a.getAttribute("href")),
      skipIsFirst: !!skip && focusable === skip,
      skipLandsOnMain: !!skipTarget && skipTarget.tagName === "MAIN",
    };
  }, OG_TEXT);

  // unique-ids, headings
  if (doc.duplicateIds.length) fail("unique-ids", `${tag}: duplicate ids: ${doc.duplicateIds.join(", ")}`);
  if (doc.h1Count !== 1) fail("headings", `${tag}: ${doc.h1Count} h1 elements, expected 1`);
  if (doc.firstHeading !== 1) fail("headings", `${tag}: the first heading is h${doc.firstHeading}, expected h1`);
  if (doc.jumps.length) fail("headings", `${tag}: skipped heading levels: ${doc.jumps.join(", ")}`);

  // metadata
  const M = "metadata";
  if (doc.lang !== "en") fail(M, `${tag}: html lang="${doc.lang}", expected "en"`);
  if (!doc.title.trim()) fail(M, `${tag}: empty title`);
  if (doc.description.length < 50 || doc.description.length > 170)
    fail(M, `${tag}: meta description is ${doc.description.length} characters (expected 50 to 170)`);
  if (doc.canonical !== pageDef.canonical) fail(M, `${tag}: canonical "${doc.canonical}", expected "${pageDef.canonical}"`);
  if (doc.hreflangs.length) fail(M, `${tag}: unexpected hreflang on a single-language site: ${doc.hreflangs.join(", ")}`);
  if (doc.jsonLd.length !== 1) fail(M, `${tag}: ${doc.jsonLd.length} JSON-LD blocks, expected 1`);
  for (const block of doc.jsonLd) {
    try {
      JSON.parse(block);
    } catch (e) {
      fail(M, `${tag}: JSON-LD does not parse: ${e.message}`);
    }
  }

  // share-preview
  const S = "share-preview";
  if (doc.ogType !== pageDef.ogType) fail(S, `${tag}: og:type "${doc.ogType}", expected "${pageDef.ogType}"`);
  if (doc.ogUrl !== pageDef.canonical) fail(S, `${tag}: og:url "${doc.ogUrl}" does not match the canonical URL`);
  if (!doc.ogTitle || !doc.ogDescription) fail(S, `${tag}: og:title or og:description is missing`);
  if (doc.ogDescription.length > 200) fail(S, `${tag}: og:description is ${doc.ogDescription.length} characters`);
  if (doc.twitterCard !== "summary_large_image") fail(S, `${tag}: twitter:card is "${doc.twitterCard}"`);
  if (!doc.ogImage.startsWith(SITE_URL)) fail(S, `${tag}: og:image "${doc.ogImage}" is not on ${SITE_URL}`);
  else {
    const ogFile = doc.ogImage.slice(SITE_URL.length).split("?")[0];
    if (!exists(ogFile)) fail(S, `${tag}: og:image file ${ogFile} does not exist (run npm run og)`);
    else {
      // PNG header: width and height are the big-endian integers at bytes 16 and 20.
      const png = fs.readFileSync(path.join(ROOT, ogFile));
      if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) fail(S, `${tag}: ${ogFile} is not 1200x630`);
    }
    if (OG_SOURCES[ogFile] !== doc.ogText)
      fail(S, `${tag}: ${ogFile} shows different text from the page (run npm run og and commit the result)`);
  }
  if (doc.twitterImage !== doc.ogImage) fail(S, `${tag}: twitter:image differs from og:image`);

  // internal-links
  const ownIds = new Set(doc.ids);
  for (const ref of doc.refs) {
    const err = resolveLink(tag, ref, ownIds);
    if (err) fail("internal-links", `${tag}: ${err}`);
  }

  // new-tab-links
  for (const l of doc.newTab) {
    if (!l.noopener) fail("new-tab-links", `${tag}: ${l.href} opens a new tab without rel="noopener"`);
    if (!l.srText) fail("new-tab-links", `${tag}: ${l.href} opens a new tab without telling screen readers`);
  }
  for (const href of doc.mailtoNewTab) fail("new-tab-links", `${tag}: ${href} has a target attribute`);

  // skip-link
  if (!doc.skipIsFirst) fail("skip-link", `${tag}: the skip link is not the first focusable element`);
  if (!doc.skipLandsOnMain) fail("skip-link", `${tag}: the skip link does not point to <main>`);

  // contrast, light and dark (the site follows the system preference)
  const kind = CONTRAST[pageDef.kind] || { required: [], optional: [] };
  const required = [...CONTRAST.shared, ...kind.required];
  for (const scheme of ["light", "dark"]) {
    const p = scheme === "light" ? page : await open(browser, pageDef, { viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
    const results = await measureContrast(p, [...required, ...kind.optional]);
    for (const c of results) {
      if (c.missing) {
        if (required.includes(c.sel)) fail("contrast", `${tag}: selector not found: ${c.sel}`);
        continue;
      }
      if (kind.optional.includes(c.sel)) seenOptional.add(`${pageDef.kind} ${c.sel}`);
      if (c.ratio < 4.5) fail("contrast", `${tag}: ${c.ratio}:1 < 4.5:1 for ${c.sel} (${scheme} mode)`);
    }
    if (p !== page) await p.close();
  }

  // nav-active
  const N = "nav-active";
  const active = () =>
    page.evaluate(() => [...document.querySelectorAll(".nav-links a.active")].map((a) => a.getAttribute("href")));
  if (pageDef.kind === "home") {
    await page.evaluate(() => document.getElementById("how-i-test").scrollIntoView({ behavior: "instant", block: "start" }));
    await page.waitForTimeout(300);
    const mid = await active();
    if (mid.join() !== "#how-i-test") fail(N, `${tag}: with How I test in view the active nav link is [${mid}], expected #how-i-test`);
    // On a tall screen the last section never reaches the reading line, so
    // Contact must still be marked once the page is scrolled to the bottom.
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(300);
    const end = await active();
    if (end.join() !== "#contact") fail(N, `${tag}: at the bottom of the page the active nav link is [${end}], expected #contact`);
  } else if (pageDef.kind === "case") {
    const check = async (when) => {
      const a = await active();
      if (a.length !== 1 || !a[0].endsWith("#work")) fail(N, `${tag}: ${when} the active nav link is [${a}], expected Work`);
    };
    await check("after load");
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(300);
    await check("after scrolling");
  }

  await page.close();
}

/** 404.html has its own inline palette, so it gets its own browser pass. */
async function auditErrorPage(browser) {
  const def = { file: "404.html" };
  if (!exists(def.file)) return;
  for (const width of VIEWPORTS) {
    const page = await open(browser, def, { viewport: { width, height: 900 } });
    const r = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    if (r.overflow) fail("overflow", `404.html: horizontal scroll at ${width}px (content is ${r.scrollWidth}px wide)`);
    await page.close();
  }
  for (const scheme of ["light", "dark"]) {
    const page = await open(browser, def, { viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    for (const c of await measureContrast(page, ["h1", ".code", "p:not(.code)", ".btn", ".btn-ghost"])) {
      if (c.missing) fail("contrast", `404.html: selector not found: ${c.sel}`);
      else if (c.ratio < 4.5) fail("contrast", `404.html: ${c.ratio}:1 < 4.5:1 for ${c.sel} (${scheme} mode)`);
    }
    await page.close();
  }
}

(async () => {
  checkStaticFiles();
  checkPagesMatchSource();
  checkStaticLinks();

  const browser = await chromium.launch(launchOptions);
  const seenOptional = new Set();
  for (const pageDef of PAGES) {
    await auditPage(browser, pageDef, seenOptional);
    console.log(`✓ audited ${pageDef.file}`);
  }
  await auditErrorPage(browser);
  console.log("✓ audited 404.html");
  await browser.close();

  for (const kind of ["home", "case"]) {
    if (!PAGES.some((p) => p.kind === kind)) continue;
    for (const sel of CONTRAST[kind].optional)
      if (!seenOptional.has(`${kind} ${sel}`)) fail("contrast", `selector ${sel} was not found on any ${kind} page`);
  }

  console.log("");
  const problems = [...new Set(failures)];
  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s):\n`);
    problems.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  const where = ROOT === REPO ? "" : ` in ${path.relative(REPO, ROOT)}/`;
  console.log(`✓ QA audit passed${where}: ${PAGES.length} pages, ${STUBS.length} redirects and 404.html.`);
})().catch((e) => {
  console.error("The audit could not run:", e.message);
  process.exit(1);
});
