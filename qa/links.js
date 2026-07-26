#!/usr/bin/env node
/**
 * Comprueba que los enlaces externos de la web siguen vivos.
 *
 * Va aparte de qa/audit.js y del gate de despliegue a propósito: la auditoría
 * es determinista y offline, mientras que esto depende de servicios de
 * terceros. Un 503 pasajero de GitHub no puede impedir publicar un cambio de
 * texto, pero el link rot en un portfolio tampoco puede descubrirlo antes un
 * reclutador que su dueño. De ahí: semanal, y sin bloquear el deploy.
 *
 * Uso: `npm run links`
 */
const fs = require("node:fs");
const path = require("node:path");

const HTML_FILES = ["index.html", "404.html"];
const TIMEOUT_MS = 15000;

// LinkedIn responde 999 a cualquier cliente que no sea un navegador: es su
// anti-scraping, no un enlace roto. Se comprueba que resuelve, no el código.
const TOLERATED = { "www.linkedin.com": [999, 403] };

const urls = new Set();
for (const file of HTML_FILES) {
  const html = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/content="(https?:\/\/[^"]+)"/g)) urls.add(m[1]);
}

async function check(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Algunos servidores rechazan HEAD; si pasa, se reintenta con GET.
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (res.status === 405 || res.status === 501)
      res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });

    const host = new URL(url).host;
    let ok = res.ok || (TOLERATED[host] || []).includes(res.status);
    let note = "";

    // GitHub responde 200 a /releases/latest aunque el repo no tenga NINGUNA
    // release: redirige a la lista vacía. Un 200 aquí no basta, porque la web
    // promete una descarga: se exige que haya aterrizado en una release real.
    if (ok && url.endsWith("/releases/latest") && !/\/releases\/tag\//.test(res.url)) {
      ok = false;
      note = "responde 200 pero el repo no tiene ninguna release publicada";
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
    // Una redirección a otro dominio suele significar que la URL canónica
    // cambió y el HTML se quedó con la vieja: merece avisarse aunque responda.
    const moved =
      r.ok && r.finalUrl && new URL(r.finalUrl).host !== new URL(r.url).host
        ? `  → redirige a ${r.finalUrl}`
        : "";
    console.log(`${r.ok ? "✓" : "✗"} ${r.status}  ${r.url}${r.note ? `  — ${r.note}` : moved}`);
  }

  console.log("");
  if (broken.length) {
    console.error(`✗ ${broken.length} de ${results.length} enlaces rotos.`);
    process.exit(1);
  }
  console.log(`✓ ${results.length} enlaces externos vivos.`);
})();
