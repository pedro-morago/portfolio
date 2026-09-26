#!/usr/bin/env node
/**
 * Regenerates the share images (1200x630, dark mode) from the pages themselves, so a
 * share card can never drift from the site:
 *   og-image.png             home page hero (name, role and the one idea)
 *   work/<slug>/og.png       header of each case study (kicker and headline)
 *
 * Run `npm run og` after changing the hero or a case-study header, and commit
 * the PNG files and qa/og-sources.json. That file records the text each image
 * shows; the audit compares it with the live pages, so a headline changed
 * without new images fails CI. Share-only styles hide the nav, buttons and
 * other details.
 */
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("playwright-core"));
}

const ROOT = path.join(__dirname, "..");
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const SIZE = { width: 1200, height: 630 };
// Must match OG_TEXT in qa/audit.js.
const OG_TEXT = ".hero h1, .hero-lede, .case-kicker, .case h1";
const sources = {};

const COMMON = `
  .nav, .skip-link, .footer, .copy-btn { display: none !important; }
  html { scroll-behavior: auto; }
  body { min-height: 630px; }
`;

const HOME = `${COMMON}
  .glance, .hero-tagline, .hero-actions, main > section { display: none !important; }
  .hero { padding: 0 !important; height: 630px; display: flex; align-items: center; }
  .hero-grid { display: block !important; width: 100%; }
  .hero-main { padding: 0 20px; }
  .hero h1 { font-size: 6.4rem; }
  .hero-lede { font-size: 3.1rem; max-width: 20ch; margin-top: 22px; }
  .hero-main::after {
    content: "pedromorago.com"; display: block; margin-top: 48px;
    font-size: 1.5rem; font-weight: 600; color: var(--accent);
  }
`;

const CASE = `${COMMON}
  .breadcrumb, .case-facts, .case-actions, .case-body, .case-contact, .case-next { display: none !important; }
  .case { max-width: none; height: 630px; padding: 0 20px !important; display: flex; flex-direction: column; justify-content: center; }
  .case-kicker { font-size: 1.75rem; margin-top: 0; }
  .case h1 { font-size: 5.2rem; max-width: 15ch; margin-top: 14px; }
  .case-lede { display: none; }
  .case-header::after {
    content: "Pedro Morago, Senior QA Engineer"; display: block; margin-top: 40px;
    font-size: 1.5rem; font-weight: 600; color: var(--accent);
  }
`;

async function shoot(browser, file, css, out) {
  const page = await browser.newPage({ viewport: SIZE, colorScheme: "dark" });
  await page.goto("file://" + path.join(ROOT, file));
  sources[out] = await page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()).join("\n"),
    OG_TEXT
  );
  await page.addStyleTag({ content: css });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ROOT, out), clip: { x: 0, y: 0, ...SIZE } });
  await page.close();
  console.log(`✓ ${out}`);
}

(async () => {
  const browser = await chromium.launch(launchOptions);
  await shoot(browser, "index.html", HOME, "og-image.png");
  const slugs = fs
    .readdirSync(path.join(ROOT, "work"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, "work", d.name, "index.html")))
    .map((d) => d.name)
    .sort();
  for (const slug of slugs) await shoot(browser, `work/${slug}/index.html`, CASE, `work/${slug}/og.png`);
  await browser.close();
  fs.writeFileSync(path.join(__dirname, "og-sources.json"), JSON.stringify(sources, null, 2) + "\n");
  console.log("✓ qa/og-sources.json");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
