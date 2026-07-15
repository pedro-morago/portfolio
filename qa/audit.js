#!/usr/bin/env node
/**
 * Auditoría QA del portfolio. Se ejecuta en CI en cada push y también
 * en local con `npm run qa`.
 *
 * Comprueba, en ambos idiomas:
 *  - Sin overflow horizontal en 6 viewports (320px a 1920px)
 *  - Sin errores de JavaScript ni de consola
 *  - Anclas internas válidas y sin IDs duplicados
 *  - Un único h1 y jerarquía de encabezados sin saltos
 *  - Metadatos: title, description, canonical, hreflang (es/en/x-default)
 *  - Contraste de texto >= 4.5:1 (WCAG AA)
 *  - Áreas táctiles de la navegación >= 24px en móvil
 *  - rel="noopener" en enlaces con target="_blank"
 *  - Paridad ES/EN: mismo número de secciones, proyectos y enlaces de nav,
 *    y el selector de idioma en la misma posición exacta (test de regresión)
 */
const path = require("node:path");
const fs = require("node:fs");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("playwright-core"));
}

const ROOT = path.join(__dirname, "..");
const SITE_URL = "https://pedro-morago.github.io/portfolio/";
const PAGES = [
  { lang: "es", file: "index.html", canonical: SITE_URL },
  { lang: "en", file: "en/index.html", canonical: `${SITE_URL}en/` },
];
const VIEWPORTS = [320, 390, 412, 768, 1280, 1920];
const CONTRAST_SELECTORS = [
  ".hero-tagline", ".quote p", ".about-grid > p", ".project > p",
  ".badge-live", ".badge-wip", ".job-dates", ".job-meta", ".footer p",
  ".btn-primary", ".project-tech span", ".skill-group li", ".nav-links a",
];

const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

const failures = [];
const fail = (msg) => failures.push(msg);
const fileUrl = (f) => "file://" + path.join(ROOT, f);

/** Archivos auxiliares: existencia y coherencia con las URLs canónicas. */
function auditStaticFiles() {
  const readIf = (f) =>
    fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), "utf8") : null;

  const robots = readIf("robots.txt");
  if (!robots) fail("[estáticos] falta robots.txt");
  else if (!robots.includes(`Sitemap: ${SITE_URL}sitemap.xml`))
    fail("[estáticos] robots.txt no apunta al sitemap");

  const sitemap = readIf("sitemap.xml");
  if (!sitemap) fail("[estáticos] falta sitemap.xml");
  else
    for (const p of PAGES)
      if (!sitemap.includes(`<loc>${p.canonical}</loc>`))
        fail(`[estáticos] sitemap.xml no incluye ${p.canonical}`);

  const notFound = readIf("404.html");
  if (!notFound) fail("[estáticos] falta 404.html");
  else if (!notFound.includes('name="robots" content="noindex"'))
    fail("[estáticos] 404.html sin meta robots noindex");

  if (!fs.existsSync(path.join(ROOT, "og-image.png"))) fail("[estáticos] falta og-image.png");
}

async function auditPage(browser, pageDef) {
  const tag = `[${pageDef.lang}]`;
  const jsErrors = [];
  const consoleErrors = [];

  // Comprobaciones por viewport
  for (const width of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => jsErrors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    await page.goto(fileUrl(pageDef.file));
    await page.waitForTimeout(400);

    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        overflowX: doc.scrollWidth > doc.clientWidth,
        navTap: Math.min(...[...document.querySelectorAll(".nav-links a, .lang-switch")]
          .map((a) => a.getBoundingClientRect().height)),
      };
    });
    if (r.overflowX) fail(`${tag} overflow horizontal a ${width}px`);
    if (width <= 412 && r.navTap < 24) fail(`${tag} área táctil de nav < 24px a ${width}px (${r.navTap}px)`);
    await page.close();
  }

  // Comprobaciones de documento (una vez, escritorio)
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(fileUrl(pageDef.file));
  await page.waitForTimeout(1500);

  const doc = await page.evaluate(() => {
    const out = {};
    out.lang = document.documentElement.lang;
    out.title = document.title;
    out.description = document.querySelector('meta[name="description"]')?.content || "";
    out.canonical = document.querySelector('link[rel="canonical"]')?.href || "";
    out.hreflangs = [...document.querySelectorAll("link[rel=alternate][hreflang]")]
      .map((l) => l.getAttribute("hreflang")).sort();
    out.ogImage = document.querySelector('meta[property="og:image"]')?.content || "";
    out.h1Count = document.querySelectorAll("h1").length;
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
    out.headingJumps = hs.filter((h, i) => i && h - hs[i - 1] > 1).length;
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    out.duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
    out.brokenAnchors = [...document.querySelectorAll('a[href^="#"]')]
      .filter((a) => a.getAttribute("href") !== "#" && !document.querySelector(a.getAttribute("href")))
      .map((a) => a.getAttribute("href"));
    out.blankNoOpener = [...document.querySelectorAll('a[target="_blank"]')]
      .filter((a) => !(a.rel || "").includes("noopener")).length;
    out.skipTargetOk = !!document.querySelector(document.querySelector(".skip-link").getAttribute("href"));
    out.sectionCount = document.querySelectorAll("section[id]").length;
    out.projectCount = document.querySelectorAll(".project").length;
    out.navCount = document.querySelectorAll(".nav-links a").length;
    out.langSwitchHref = document.querySelector(".lang-switch")?.getAttribute("href") || "";
    out.cssVersion = document.querySelector('link[rel="stylesheet"]')?.href.split("?v=")[1] || "";
    out.jsVersion = document.querySelector("script[src]")?.src.split("?v=")[1] || "";
    out.jsonLd = document.querySelectorAll('script[type="application/ld+json"]').length;
    return out;
  });

  // Contraste WCAG AA
  const contrast = await page.evaluate((selectors) => {
    function lum(c) {
      const [r, g, b] = c.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function bgOf(el) {
      let e = el;
      while (e) {
        const c = getComputedStyle(e).backgroundColor;
        const alpha = c.match(/[\d.]+/g)?.[3];
        if (c && c !== "rgba(0, 0, 0, 0)" && (alpha === undefined || +alpha === 1)) return c;
        e = e.parentElement;
      }
      return "rgb(6, 9, 7)";
    }
    return selectors.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, missing: true };
      const s = getComputedStyle(el);
      const [a, b] = [lum(s.color), lum(bgOf(el))].sort((x, y) => y - x);
      return { sel, ratio: +(((a + 0.05) / (b + 0.05)).toFixed(2)) };
    });
  }, CONTRAST_SELECTORS);

  // Comportamiento: el efecto de tecleo debe terminar escribiendo el comando
  const typedOk = await page
    .waitForFunction(() => document.getElementById("typed")?.textContent === "whoami", null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!typedOk) fail(`${tag} el efecto de tecleo no completa "whoami"`);

  // Comportamiento: al hacer scroll a una sección, su enlace de nav se activa
  const activeOk = await page.evaluate(async () => {
    const section = document.querySelectorAll("section[id]")[2];
    window.scrollTo({ top: section.offsetTop + 100, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 700));
    const active = document.querySelector(".nav-links a.active");
    return active?.getAttribute("href") === `#${section.id}`;
  });
  if (!activeOk) fail(`${tag} el resaltado de sección activa en la nav no funciona`);

  // Posición del selector de idioma (para la comprobación de paridad)
  const pillPositions = {};
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    pillPositions[width] = await page.evaluate(() => {
      const r = document.querySelector(".lang-switch").getBoundingClientRect();
      const doc = document.documentElement;
      return { top: Math.round(r.top), right: Math.round(doc.clientWidth - r.right) };
    });
  }
  await page.close();

  // Validación de resultados
  if (doc.lang !== pageDef.lang) fail(`${tag} html lang="${doc.lang}", esperado "${pageDef.lang}"`);
  if (!doc.title) fail(`${tag} title vacío`);
  if (doc.description.length < 50 || doc.description.length > 170)
    fail(`${tag} meta description fuera de rango (${doc.description.length} caracteres)`);
  if (doc.canonical !== pageDef.canonical)
    fail(`${tag} canonical "${doc.canonical}", esperado "${pageDef.canonical}"`);
  if (doc.hreflangs.join(",") !== "en,es,x-default")
    fail(`${tag} hreflang incompletos: ${doc.hreflangs.join(",")}`);
  if (doc.h1Count !== 1) fail(`${tag} ${doc.h1Count} elementos h1, esperado 1`);
  if (doc.headingJumps) fail(`${tag} ${doc.headingJumps} saltos en la jerarquía de encabezados`);
  if (doc.duplicateIds.length) fail(`${tag} IDs duplicados: ${doc.duplicateIds.join(", ")}`);
  if (doc.brokenAnchors.length) fail(`${tag} anclas rotas: ${doc.brokenAnchors.join(", ")}`);
  if (doc.blankNoOpener) fail(`${tag} ${doc.blankNoOpener} enlaces target=_blank sin rel=noopener`);
  if (!doc.skipTargetOk) fail(`${tag} el destino del enlace 'saltar al contenido' no existe`);
  const expectedSwitch = pageDef.lang === "es" ? "en/" : "../";
  if (doc.langSwitchHref !== expectedSwitch)
    fail(`${tag} selector de idioma apunta a "${doc.langSwitchHref}", esperado "${expectedSwitch}"`);
  if (doc.jsonLd !== 1) fail(`${tag} ${doc.jsonLd} bloques JSON-LD, esperado 1`);
  if (jsErrors.length) fail(`${tag} errores de JavaScript: ${jsErrors.join(" | ")}`);
  if (consoleErrors.length) fail(`${tag} errores de consola: ${consoleErrors.join(" | ")}`);
  for (const c of contrast) {
    if (c.missing) fail(`${tag} selector de contraste no encontrado: ${c.sel}`);
    else if (c.ratio < 4.5) fail(`${tag} contraste ${c.ratio}:1 < 4.5:1 en ${c.sel}`);
  }

  return { doc, pillPositions };
}

(async () => {
  auditStaticFiles();
  const browser = await chromium.launch(launchOptions);
  const results = {};
  for (const pageDef of PAGES) {
    results[pageDef.lang] = await auditPage(browser, pageDef);
    console.log(`✓ auditada ${pageDef.file}`);
  }
  await browser.close();

  // Paridad entre idiomas
  const es = results.es, en = results.en;
  if (es.doc.sectionCount !== en.doc.sectionCount)
    fail(`[paridad] secciones: es=${es.doc.sectionCount}, en=${en.doc.sectionCount}`);
  if (es.doc.projectCount !== en.doc.projectCount)
    fail(`[paridad] proyectos: es=${es.doc.projectCount}, en=${en.doc.projectCount}`);
  if (es.doc.navCount !== en.doc.navCount)
    fail(`[paridad] enlaces de nav: es=${es.doc.navCount}, en=${en.doc.navCount}`);
  if (es.doc.cssVersion !== en.doc.cssVersion || es.doc.jsVersion !== en.doc.jsVersion)
    fail(`[paridad] versiones de assets distintas entre idiomas (css: ${es.doc.cssVersion}/${en.doc.cssVersion}, js: ${es.doc.jsVersion}/${en.doc.jsVersion})`);
  for (const width of [390, 1280]) {
    const a = es.pillPositions[width], b = en.pillPositions[width];
    if (Math.abs(a.top - b.top) > 1 || Math.abs(a.right - b.right) > 1)
      fail(`[paridad] selector de idioma en distinta posición a ${width}px: es=${JSON.stringify(a)}, en=${JSON.stringify(b)}`);
  }

  console.log("");
  if (failures.length) {
    console.error(`✗ ${failures.length} problema(s):\n`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log("✓ Auditoría QA superada sin problemas.");
})().catch((e) => {
  console.error("Error ejecutando la auditoría:", e.message);
  process.exit(1);
});
