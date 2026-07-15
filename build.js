#!/usr/bin/env node
/**
 * Generador estático del portfolio, sin dependencias.
 *
 * La estructura de la página vive aquí una sola vez; los textos de cada
 * idioma viven en src/content.<lang>.json. Ejecutar `node build.js`
 * regenera index.html y en/index.html. No editar esos HTML a mano.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SITE_URL = "https://pedro-morago.github.io/portfolio/";
const LANGS = ["es", "en"];

// Versión de assets derivada del contenido: cambia sola cuando cambia el
// archivo, así los navegadores nunca sirven CSS/JS cacheados obsoletos.
const hashFile = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, f))).digest("hex").slice(0, 8);
const CSS_VERSION = hashFile("styles.css");
const JS_VERSION = hashFile("script.js");

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23060907'/><text x='14' y='70' font-family='monospace' font-size='46' font-weight='bold' fill='%233dff77'>&gt;_</text></svg>";

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "src", f), "utf8"));

/**
 * Los dos JSON de contenido son traducciones paralelas: deben tener las
 * mismas claves, arrays de la misma longitud y ningún valor vacío. Si no,
 * el build falla aquí en vez de generar HTML con 'undefined' silenciosos.
 */
function assertParity(a, b, at = "$") {
  const type = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
  if (type(a) !== type(b))
    throw new Error(`Paridad es/en rota en ${at}: tipos ${type(a)} vs ${type(b)}`);
  if (type(a) === "array") {
    if (a.length !== b.length)
      throw new Error(`Paridad es/en rota en ${at}: arrays de longitud ${a.length} vs ${b.length}`);
    a.forEach((v, i) => assertParity(v, b[i], `${at}[${i}]`));
  } else if (type(a) === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join(",") !== kb.join(","))
      throw new Error(`Paridad es/en rota en ${at}: claves [${ka}] vs [${kb}]`);
    ka.forEach((k) => assertParity(a[k], b[k], `${at}.${k}`));
  } else if (type(a) === "string") {
    if (!a.trim() && at !== "$.path" && at !== "$.root")
      throw new Error(`Valor vacío en ${at} (es)`);
    if (!b.trim() && at !== "$.path" && at !== "$.root")
      throw new Error(`Valor vacío en ${at} (en)`);
  }
}

function renderHead(c) {
  const url = SITE_URL + c.path;
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Pedro Morago López-Vázquez",
    alternateName: "Pedro Morago",
    jobTitle: "QA Engineer",
    url: SITE_URL,
    address: { "@type": "PostalAddress", addressLocality: "Santander", addressCountry: "ES" },
    alumniOf: "Universidad de Cantabria",
    sameAs: [
      "https://github.com/pedro-morago",
      "https://www.linkedin.com/in/pedro-morago-l%C3%B3pez-vazquez",
    ],
  });
  return `<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${c.meta.title}</title>
  <meta name="description" content="${c.meta.description}" />
  <meta name="theme-color" content="#060907" />
  <link rel="canonical" href="${url}" />
  <link rel="alternate" hreflang="es" href="${SITE_URL}" />
  <link rel="alternate" hreflang="en" href="${SITE_URL}en/" />
  <link rel="alternate" hreflang="x-default" href="${SITE_URL}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${c.meta.title}" />
  <meta property="og:description" content="${c.meta.ogDescription}" />
  <meta property="og:image" content="${SITE_URL}og-image.png" />
  <meta property="og:locale" content="${c.ogLocale}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${c.meta.title}" />
  <meta name="twitter:description" content="${c.meta.twitterDescription}" />
  <meta name="twitter:image" content="${SITE_URL}og-image.png" />
  <link rel="stylesheet" href="${c.root}styles.css?v=${CSS_VERSION}" />
  <link rel="icon" href="${FAVICON}" />
  <script type="application/ld+json">${jsonLd}</script>
</head>`;
}

function renderNav(c) {
  const links = c.nav
    .map((l) => `        <a href="${l.href}">${l.label}</a>`)
    .join("\n");
  return `  <nav class="nav">
    <div class="nav-inner">
      <a href="#" class="nav-logo"><span class="accent">&gt;_</span> pedro.morago</a>
      <div class="nav-links">
${links}
      </div>
      <a href="${c.langSwitch.href}" class="lang-switch" lang="${c.langSwitch.lang}" hreflang="${c.langSwitch.hreflang}" aria-label="${c.langSwitch.aria}">${c.langSwitch.label}</a>
    </div>
  </nav>`;
}

function renderHero(c) {
  return `  <header class="hero">
    <div class="container">
      <p class="ps1"><span class="user">pedro@morago</span>:~$ <span class="cmd" id="typed">${c.hero.typed}</span></p>
      <h1>${c.hero.name}</h1>
      <p class="hero-role">${c.hero.role}</p>
      <p class="hero-tagline">
        ${c.hero.tagline}
      </p>
      <p class="ps1" aria-hidden="true"><span class="user">pedro@morago</span>:~$ <span class="cursor"></span></p>
      <div class="hero-actions">
        <a href="#${c.projects.id}" class="btn btn-primary">${c.hero.ctaProjects}</a>
        <a href="https://github.com/pedro-morago" target="_blank" rel="noopener" class="btn btn-ghost">${c.hero.ctaGithub}</a>
      </div>
    </div>
  </header>`;
}

function renderSectionHeading(s) {
  // El nombre real de la sección va oculto visualmente para lectores de
  // pantalla; el comando de terminal es presentación y se marca aria-hidden.
  return `        <h2><span class="sr-only">${s.aria}</span><span aria-hidden="true"><span class="accent">$</span> ${s.cmd}</span></h2>`;
}

function renderAbout(c) {
  const paragraphs = c.about.paragraphs
    .map((p) => `          <p>\n            ${p}\n          </p>`)
    .join("\n");
  return `    <section id="${c.about.id}" class="section">
      <div class="container">
${renderSectionHeading(c.about)}
        <div class="about-grid">
          <blockquote class="quote">
            <p>
              ${c.about.quote}
            </p>
          </blockquote>
${paragraphs}
        </div>
      </div>
    </section>`;
}

function renderExperience(c) {
  const jobs = c.experience.jobs
    .map((j) => {
      const bullets = j.bullets.map((b) => `            <li>${b}</li>`).join("\n");
      return `        <article class="job">
          <div class="job-header">
            <h3>${j.title}</h3>
            <span class="job-dates">${j.dates}</span>
          </div>
          <p class="job-meta">${j.meta}</p>
          <ul class="project-features">
${bullets}
          </ul>
        </article>`;
    })
    .join("\n\n");
  return `    <section id="${c.experience.id}" class="section">
      <div class="container">
${renderSectionHeading(c.experience)}

${jobs}
      </div>
    </section>`;
}

function renderProjects(c) {
  const items = c.projects.items
    .map((p) => {
      const badgeClass = p.wip ? "badge-wip" : "badge-live";
      const features = p.features.length
        ? `          <ul class="project-features">\n${p.features
            .map((f) => `            <li>${f}</li>`)
            .join("\n")}\n          </ul>\n`
        : "";
      const tech = p.tech.length
        ? `          <div class="project-tech">\n            ${p.tech
            .map((t) => `<span>${t}</span>`)
            .join("")}\n          </div>\n`
        : "";
      const links = p.links
        .map(
          (l) =>
            `            <a href="${l.href}" target="_blank" rel="noopener" class="btn btn-small">${l.label}</a>`
        )
        .join("\n");
      return `        <article class="project${p.wip ? " project-wip" : ""}">
          <div class="project-header">
            <h3>${p.name}</h3>
            <span class="badge ${badgeClass}">${p.badge}</span>
          </div>
          <p class="project-tagline">${p.tagline}</p>
          <p>
            ${p.description}
          </p>
${features}${tech}          <div class="project-links">
${links}
          </div>
        </article>`;
    })
    .join("\n\n");
  return `    <section id="${c.projects.id}" class="section">
      <div class="container">
${renderSectionHeading(c.projects)}

${items}

      </div>
    </section>`;
}

function renderSkills(c) {
  const groups = c.skills.groups
    .map((g) => {
      const items = g.items.map((i) => `              <li>${i}</li>`).join("\n");
      return `          <div class="skill-group">
            <h3>${g.title}</h3>
            <ul>
${items}
            </ul>
          </div>`;
    })
    .join("\n");
  const credentials = c.skills.credentials
    .map((box) => {
      const blocks = box.blocks
        .map((b, i) => `            <h3${i > 0 ? ' class="credential-langs"' : ""}>${b.title}</h3>\n            ${b.html}`)
        .join("\n");
      return `          <div class="credential">\n${blocks}\n          </div>`;
    })
    .join("\n");
  return `    <section id="${c.skills.id}" class="section">
      <div class="container">
${renderSectionHeading(c.skills)}
        <div class="skills-grid">
${groups}
        </div>

        <div class="credentials">
${credentials}
        </div>
      </div>
    </section>`;
}

function renderContact(c) {
  const links = c.contact.links
    .map(
      (l) =>
        `          <a href="${l.href}" target="_blank" rel="noopener" class="btn btn-ghost">${l.label}</a>`
    )
    .join("\n");
  return `    <section id="${c.contact.id}" class="section section-contact">
      <div class="container">
${renderSectionHeading(c.contact)}
        <p class="contact-text">
          ${c.contact.text}
          <span class="contact-location">${c.contact.location}</span>
        </p>
        <div class="contact-actions">
          <a href="mailto:${c.contact.email}" class="btn btn-primary">${c.contact.email}</a>
${links}
        </div>
      </div>
    </section>`;
}

function renderPage(c) {
  return `<!DOCTYPE html>
<!-- Generado por build.js. No editar a mano: edita src/content.${c.htmlLang}.json y ejecuta 'node build.js'. -->
<html lang="${c.htmlLang}">
${renderHead(c)}
<body>

  <a class="skip-link" href="#${c.skipLink.target}">${c.skipLink.label}</a>

${renderNav(c)}

${renderHero(c)}

  <main id="${c.skipLink.target}">
${renderAbout(c)}

${renderExperience(c)}

${renderProjects(c)}

${renderSkills(c)}

${renderContact(c)}
  </main>

  <footer class="footer">
    <div class="container">
      <p><span class="accent">$</span> ${c.footer}</p>
    </div>
  </footer>

  <script src="${c.root}script.js?v=${JS_VERSION}"></script>
</body>
</html>
`;
}

const contents = LANGS.map((lang) => read(`content.${lang}.json`));
assertParity(contents[0], contents[1]);

for (const content of contents) {
  const outFile = path.join(__dirname, content.path, "index.html");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, renderPage(content));
  console.log(`✓ ${path.relative(__dirname, outFile)} (${content.htmlLang})`);
}
