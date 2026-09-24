#!/usr/bin/env node
/**
 * Genera brand/linkedin-banner.png (1584x396, el tamaño que recomienda
 * LinkedIn) y brand/linkedin-banner@2x.png a partir de
 * brand/linkedin-banner.html. Ejecutar con `npm run banner` y commitear los PNG.
 */
const path = require("node:path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("playwright-core"));
}

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "brand", "linkedin-banner.html");
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

(async () => {
  const browser = await chromium.launch(launchOptions);
  for (const [scale, suffix] of [
    [1, ""],
    [2, "@2x"],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1584, height: 396 },
      deviceScaleFactor: scale,
    });
    await page.goto("file://" + SRC);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(ROOT, "brand", `linkedin-banner${suffix}.png`),
      clip: { x: 0, y: 0, width: 1584, height: 396 },
    });
    await page.close();
    console.log(`✓ brand/linkedin-banner${suffix}.png`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
