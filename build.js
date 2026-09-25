#!/usr/bin/env node
/**
 * Generador estático del portfolio, sin dependencias.
 *
 * Sitio solo en inglés (público objetivo: mercado internacional). La
 * estructura vive aquí una sola vez; los textos en src/content.en.json.
 * Ejecutar `node build.js` regenera index.html (y en/index.html, que es
 * una redirección a la raíz para los enlaces antiguos). No editar a mano.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SITE_URL = "https://pedromorago.com/";

// Versión de assets derivada del contenido: cambia sola cuando cambia el
// archivo, así los navegadores nunca sirven CSS/JS cacheados obsoletos.
const hashFile = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, f))).digest("hex").slice(0, 8);
const CSS_VERSION = hashFile("styles.css");
const JS_VERSION = hashFile("script.js");

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='24' fill='%231a7f4b'/><path d='M29 52l14 14 29-31' fill='none' stroke='white' stroke-width='10' stroke-linecap='round' stroke-linejoin='round'/></svg>";

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "src", f), "utf8"));

/**
 * El JSON de contenido no puede tener valores vacíos: si los hubiera, el
 * build fallaría aquí en vez de generar HTML con huecos silenciosos.
 */
function assertContent(v, at = "$") {
  if (Array.isArray(v)) v.forEach((x, i) => assertContent(x, `${at}[${i}]`));
  else if (v && typeof v === "object")
    Object.keys(v).forEach((k) => assertContent(v[k], `${at}.${k}`));
  else if (typeof v === "string" && !v.trim() && at !== "$.path" && at !== "$.root")
    throw new Error(`Valor vacío en ${at}`);
}

function renderHead(c) {
  const url = SITE_URL + c.path;
  // ProfilePage + Person es el marcado que Google recomienda para webs
  // personales; WebSite fija "Pedro Morago" como nombre del sitio en los
  // resultados. sameAs sale de los enlaces de contacto para que el marcado
  // y los perfiles visibles no puedan divergir.
  const person = {
    "@type": "Person",
    "@id": `${SITE_URL}#person`,
    name: "Pedro Morago López-Vázquez",
    alternateName: "Pedro Morago",
    jobTitle: "Senior QA Engineer",
    description: c.meta.description,
    url: SITE_URL,
    email: `mailto:${c.contact.email}`,
    address: { "@type": "PostalAddress", addressLocality: "Santander", addressCountry: "ES" },
    worksFor: { "@type": "Organization", name: "Alvatross by SATEC" },
    alumniOf: { "@type": "CollegeOrUniversity", name: "University of Cantabria" },
    knowsAbout: ["Software Quality Assurance", "Test Automation", "Playwright", "Cypress", "API Testing", "CI/CD"],
    sameAs: c.contact.links.map((l) => l.href),
  };
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}#website`,
        url: SITE_URL,
        name: "Pedro Morago",
        alternateName: ["Pedro Morago López-Vázquez", "pedromorago.com"],
        inLanguage: c.htmlLang,
        publisher: { "@id": person["@id"] },
      },
      {
        "@type": "ProfilePage",
        "@id": `${url}#profilepage`,
        url,
        name: c.meta.title,
        isPartOf: { "@id": `${SITE_URL}#website` },
        mainEntity: person,
      },
    ],
  });
  return `<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${c.meta.title}</title>
  <meta name="description" content="${c.meta.description}" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#fbfbf9" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0e0f10" media="(prefers-color-scheme: dark)" />
  <link rel="canonical" href="${url}" />
  <meta name="author" content="Pedro Morago" />
  <meta property="og:type" content="profile" />
  <meta property="og:site_name" content="Pedro Morago" />
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
      <a href="#" class="nav-logo">${c.hero.name}</a>
      <div class="nav-links">
${links}
      </div>
    </div>
  </nav>`;
}

function renderHero(c) {
  const ctas = c.hero.ctas
    .map((l, i) => {
      const ext = l.href.startsWith("http") ? ' target="_blank" rel="noopener"' : "";
      return `        <a href="${l.href}"${ext} class="btn ${i === 0 ? "btn-primary" : "btn-ghost"}">${l.label}</a>`;
    })
    .join("\n");
  return `  <header class="hero">
    <div class="container">
      <h1>${c.hero.name}</h1>
      <p class="hero-lede">${c.hero.role}</p>
      <p class="hero-tagline">
        ${c.hero.tagline}
      </p>
      <div class="hero-actions">
${ctas}
      </div>
    </div>
  </header>`;
}

/**
 * Cada sección es una rejilla de dos columnas en escritorio: el título a la
 * izquierda (fijo al hacer scroll) y el contenido a la derecha. En móvil se
 * apila.
 */
function renderSection(s, body, extraClass = "") {
  return `    <section id="${s.id}" class="section${extraClass ? " " + extraClass : ""}">
      <div class="container section-grid">
        <h2>${s.title}</h2>
        <div class="section-body">
${body}
        </div>
      </div>
    </section>`;
}

const list = (items, indent) =>
  `${indent}<ul class="list">\n${items.map((i) => `${indent}  <li>${i}</li>`).join("\n")}\n${indent}</ul>`;

function renderAbout(c) {
  const paragraphs = c.about.paragraphs.map((t) => `          <p>${t}</p>`).join("\n");
  return renderSection(c.about, `          <div class="about-grid">\n${paragraphs}\n          </div>`);
}

function renderExperience(c) {
  const jobs = c.experience.jobs
    .map(
      (j) => `          <article class="job">
            <div class="job-header">
              <h3>${j.title}</h3>
              <span class="job-dates">${j.dates}</span>
            </div>
            <p class="job-meta">${j.meta}</p>
${list(j.bullets, "            ")}
          </article>`
    )
    .join("\n");
  return renderSection(c.experience, jobs);
}

function renderProjects(c) {
  const items = c.projects.items
    .map((p) => {
      const features = p.features.length ? list(p.features, "            ") + "\n" : "";
      // El primer enlace es la acción principal (abrir la demo, descargar).
      const links = p.links
        .map(
          (l, i) =>
            `              <a href="${l.href}" target="_blank" rel="noopener" class="btn btn-small${i === 0 ? " btn-small-primary" : ""}">${l.label}</a>`
        )
        .join("\n");
      return `          <article class="project">
            <div class="project-header">
              <h3>${p.name}</h3>
              <span class="status"><span class="status-dot" aria-hidden="true"></span>${p.badge}</span>
            </div>
            <p class="project-tagline">${p.tagline}</p>
            <p>${p.description}</p>
${features}            <div class="project-links">
${links}
            </div>
          </article>`;
    })
    .join("\n");
  return renderSection(c.projects, items);
}

function renderSkills(c) {
  const row = (title, html) => `            <div class="skill-row">
              <dt>${title}</dt>
              <dd>${html}</dd>
            </div>`;
  const groups = c.skills.groups.map((g) => row(g.title, g.items.join(", "))).join("\n");
  const credentials = c.skills.credentials
    .flatMap((box) => box.blocks)
    .map((b) => row(b.title, b.html))
    .join("\n");
  return renderSection(
    c.skills,
    `          <dl class="skill-table">
${groups}
          </dl>
          <dl class="skill-table skill-table-credentials">
${credentials}
          </dl>`
  );
}

function renderContact(c) {
  const links = c.contact.links
    .map((l) => `            <a href="${l.href}" target="_blank" rel="noopener" class="btn btn-ghost">${l.label}</a>`)
    .join("\n");
  return renderSection(
    c.contact,
    `          <p class="contact-text">${c.contact.text}</p>
          <p class="contact-location">${c.contact.location}</p>
          <div class="contact-actions">
            <a href="mailto:${c.contact.email}" class="btn btn-primary">${c.contact.email}</a>
${links}
          </div>`,
    "section-contact"
  );
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
      <p>${c.footer}</p>
    </div>
  </footer>

  <script src="${c.root}script.js?v=${JS_VERSION}"></script>
</body>
</html>
`;
}

const content = read("content.en.json");
assertContent(content);

fs.writeFileSync(path.join(__dirname, "index.html"), renderPage(content));
console.log("✓ index.html (en)");

// La antigua URL /en/ sigue viva como redirección a la raíz: los enlaces ya
// compartidos no se rompen y el canonical evita contenido duplicado en SEO.
const redirect = `<!DOCTYPE html>
<!-- Generado por build.js: redirección de la antigua URL /en/ a la raíz. -->
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${content.meta.title}</title>
  <meta name="robots" content="noindex" />
  <link rel="canonical" href="${SITE_URL}" />
  <meta http-equiv="refresh" content="0; url=/" />
</head>
<body>
  <p><a href="/">pedromorago.com</a></p>
</body>
</html>
`;
fs.mkdirSync(path.join(__dirname, "en"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "en", "index.html"), redirect);
console.log("✓ en/index.html (redirección a /)");
