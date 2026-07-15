#!/usr/bin/env node
/**
 * Regenera og-image.png (1200x630) a partir del hero de la página en español.
 * Ejecutar con `npm run og` tras cambiar el hero, y commitear el PNG.
 */
const path = require("node:path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("playwright-core"));
}

const ROOT = path.join(__dirname, "..");
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

(async () => {
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto("file://" + path.join(ROOT, "index.html"));
  await page.waitForTimeout(2500);
  await page.addStyleTag({
    content:
      ".nav, .skip-link { display: none !important; } .hero { padding: 90px 0 !important; min-height: 630px; border: none !important; }",
  });
  await page.screenshot({
    path: path.join(ROOT, "og-image.png"),
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  await browser.close();
  console.log("✓ og-image.png regenerada");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
