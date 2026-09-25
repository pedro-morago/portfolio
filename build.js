#!/usr/bin/env node
/**
 * Dependency-free static generator for pedromorago.com.
 *
 * The markup lives here once; the copy lives in src/*.json:
 *   src/content.en.json      home page plus shared parts (nav, footer, contact)
 *   src/work/<slug>.en.json  one file per case study
 *
 * `node build.js` writes:
 *   index.html                 home page
 *   work/<slug>/index.html     one page per case study
 *   work/index.html            redirect stub to /#work
 *   en/index.html              redirect stub for the old /en/ address
 *   sitemap.xml                the indexable pages, from the same list
 *
 * Generated files are committed. Do not edit them by hand: CI rebuilds them
 * and fails if they differ from what is committed.
 *
 * Text fields support two bits of inline markup: [label](href) for a link and
 * `code` for inline code. Every link goes through renderLink().
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const SITE_URL = "https://pedromorago.com/";

// Asset version derived from the file content, so browsers never keep a stale
// CSS or JS file after a change.
const hashFile = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, f))).digest("hex").slice(0, 8);
const CSS_VERSION = hashFile("styles.css");
const JS_VERSION = hashFile("script.js");

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='24' fill='%23141414'/><text x='50' y='66' text-anchor='middle' font-family='Helvetica,Arial,sans-serif' font-weight='700' font-size='46' letter-spacing='-3' fill='%23fbfbf9'>PM</text></svg>";

// A check mark, drawn in the current text colour.
const CHECK_ICON =
  '<svg class="check-icon" viewBox="0 0 100 100" width="14" height="14" aria-hidden="true" focusable="false"><path d="M18 54l20 20 44-46" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" /></svg>';

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * No empty strings anywhere in the copy: a forgotten field stops the build and
 * names its path (for example $.work.items[2].text) instead of publishing a gap.
 */
function assertContent(v, at = "$", file = "") {
  if (Array.isArray(v)) v.forEach((x, i) => assertContent(x, `${at}[${i}]`, file));
  else if (v && typeof v === "object") Object.keys(v).forEach((k) => assertContent(v[k], `${at}.${k}`, file));
  else if (typeof v === "string" && !v.trim()) throw new Error(`Empty value at ${at} in ${file}`);
}

// ---------------------------------------------------------------- helpers

// A missing field is an error too: it would otherwise print "undefined" on the page.
const esc = (s) => {
  if (s === undefined || s === null) throw new Error("A text field is missing from the JSON (the stack trace shows where it was used)");
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
};

const isExternal = (href) => /^https?:\/\//.test(href);

/**
 * The one place that decides how a link is rendered.
 * - External links open in a new tab with rel="noopener". Their label ends in
 *   " ↗" in the JSON; the arrow is hidden from screen readers, which hear
 *   "(opens in a new tab)" instead.
 * - An internal " →" is hidden from screen readers too.
 * - mailto: links never open a new tab.
 * - l.sr adds visually hidden text (to tell apart links with the same label).
 */
function renderLink(l, cls = "", root = "") {
  const external = isExternal(l.href);
  let label = l.label;
  let arrow = "";
  if (external) {
    if (!label.endsWith(" ↗")) throw new Error(`External link label must end with " ↗": ${label} (${l.href})`);
    label = label.slice(0, -2);
    arrow = ' <span aria-hidden="true">↗</span>';
  } else if (label.endsWith(" →")) {
    label = label.slice(0, -2);
    arrow = ' <span aria-hidden="true">→</span>';
  }
  const href = external || /^(mailto:|#)/.test(l.href) ? l.href : root + l.href;
  const sr = l.sr ? `<span class="sr-only">${esc(l.sr)}</span>` : "";
  const newTab = external ? '<span class="sr-only"> (opens in a new tab)</span>' : "";
  const attrs = [`href="${esc(href)}"`];
  if (cls) attrs.push(`class="${cls}"`);
  if (external) attrs.push('target="_blank" rel="noopener"');
  return `<a ${attrs.join(" ")}>${esc(label)}${sr}${arrow}${newTab}</a>`;
}

/** Escapes a text field and renders its inline markup. */
function inline(text, root = "") {
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    out += m[3] !== undefined ? `<code>${esc(m[3])}</code>` : renderLink({ label: m[1], href: m[2] }, "", root);
    last = re.lastIndex;
  }
  return out + esc(text.slice(last));
}

const BUTTON_CLASSES = {
  primary: "btn btn-primary",
  ghost: "btn btn-ghost",
  "small-primary": "btn btn-small btn-small-primary",
  small: "btn btn-small",
};

/** A row of buttons: the first uses `first`, the rest use `rest`, unless a link sets its own style. */
const renderButtons = (links, first, rest, root, indent) =>
  links
    .map((l, i) => `${indent}${renderLink(l, BUTTON_CLASSES[l.style || (i === 0 ? first : rest)], root)}`)
    .join("\n");

// ------------------------------------------------------------------ pages

const content = readJson(path.join(ROOT, "src", "content.en.json"));
assertContent(content, "$", "src/content.en.json");

const caseFiles = fs
  .readdirSync(path.join(ROOT, "src", "work"))
  .filter((f) => f.endsWith(".en.json"))
  .sort();
const cases = caseFiles.map((f) => {
  const c = readJson(path.join(ROOT, "src", "work", f));
  assertContent(c, "$", `src/work/${f}`);
  for (const k of ["slug", "meta", "crumb", "kicker", "title", "lede", "facts", "sections", "contactTopic"])
    if (c[k] === undefined) throw new Error(`src/work/${f}: missing "${k}"`);
  if (`${c.slug}.en.json` !== f) throw new Error(`src/work/${f}: slug "${c.slug}" does not match the file name`);
  return c;
});

/** Every indexable page. The sitemap, canonical URLs and share images all come from here. */
const PAGES = [
  {
    kind: "home",
    out: "index.html",
    root: "",
    url: SITE_URL,
    ogType: "profile",
    ogImage: "og-image.png",
    ogImageAlt: `${content.hero.name}. ${content.hero.role} ${content.hero.lede}`,
    title: content.meta.title,
    description: content.meta.description,
    ogDescription: content.meta.ogDescription,
    twitterDescription: content.meta.twitterDescription,
  },
  ...cases.map((c) => ({
    kind: "case",
    data: c,
    out: `work/${c.slug}/index.html`,
    root: "../../",
    url: `${SITE_URL}work/${c.slug}/`,
    ogType: "article",
    ogImage: `work/${c.slug}/og.png`,
    ogImageAlt: `${c.kicker}. ${c.title}. ${content.hero.name}, ${content.person.jobTitle}.`,
    title: c.meta.title,
    description: c.meta.description,
    ogDescription: c.meta.shareDescription,
    twitterDescription: c.meta.shareDescription,
  })),
];

// ------------------------------------------------------------------- head

function personNode() {
  const p = content.person;
  return {
    "@type": "Person",
    "@id": `${SITE_URL}#person`,
    name: p.name,
    alternateName: p.alternateName,
    jobTitle: p.jobTitle,
    description: p.description,
    url: SITE_URL,
    email: `mailto:${content.contact.email}`,
    address: { "@type": "PostalAddress", addressLocality: p.addressLocality, addressCountry: p.addressCountry },
    worksFor: { "@type": "Organization", name: p.worksFor },
    alumniOf: { "@type": "CollegeOrUniversity", name: p.alumniOf },
    knowsLanguage: p.knowsLanguage,
    hasCredential: {
      "@type": "EducationalOccupationalCredential",
      name: p.credential,
      credentialCategory: "certification",
    },
    knowsAbout: p.knowsAbout,
    // Derived from the visible contact links, so markup and page cannot disagree.
    sameAs: content.contact.links.map((l) => l.href),
  };
}

function jsonLd(page) {
  const website = {
    "@type": "WebSite",
    "@id": `${SITE_URL}#website`,
    url: SITE_URL,
    name: "Pedro Morago",
  };
  let graph;
  if (page.kind === "home") {
    graph = [
      {
        ...website,
        alternateName: [content.person.name, "pedromorago.com"],
        inLanguage: content.htmlLang,
        publisher: { "@id": `${SITE_URL}#person` },
      },
      {
        "@type": "ProfilePage",
        "@id": `${page.url}#profilepage`,
        url: page.url,
        name: page.title,
        isPartOf: { "@id": `${SITE_URL}#website` },
        mainEntity: personNode(),
      },
    ];
  } else {
    const c = page.data;
    // Minimal WebSite and Person nodes with the home page's @ids, so each page
    // validates on its own.
    graph = [
      website,
      { "@type": "Person", "@id": `${SITE_URL}#person`, name: content.person.name, url: SITE_URL },
      {
        "@type": "TechArticle",
        "@id": `${page.url}#article`,
        headline: c.title,
        description: page.description,
        url: page.url,
        mainEntityOfPage: page.url,
        image: SITE_URL + page.ogImage,
        inLanguage: content.htmlLang,
        author: { "@id": `${SITE_URL}#person` },
        publisher: { "@id": `${SITE_URL}#person` },
        isPartOf: { "@id": `${SITE_URL}#website` },
        about: c.meta.about.map((name) => ({ "@type": "Thing", name })),
      },
      {
        // The visible "Work" crumb is left out: /#work is the same URL as the
        // root for search engines.
        "@type": "BreadcrumbList",
        "@id": `${page.url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Pedro Morago", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: c.title, item: page.url },
        ],
      },
    ];
  }
  // "<" is escaped so the JSON can never close the script element.
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

function renderHead(page) {
  const img = SITE_URL + page.ogImage;
  return `<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#fbfbf9" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0e0f10" media="(prefers-color-scheme: dark)" />
  <link rel="canonical" href="${page.url}" />
  <meta name="author" content="Pedro Morago" />
  <meta property="og:type" content="${page.ogType}" />
  <meta property="og:site_name" content="Pedro Morago" />
  <meta property="og:url" content="${page.url}" />
  <meta property="og:title" content="${esc(page.title)}" />
  <meta property="og:description" content="${esc(page.ogDescription)}" />
  <meta property="og:image" content="${img}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(page.ogImageAlt)}" />
  <meta property="og:locale" content="${content.ogLocale}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(page.title)}" />
  <meta name="twitter:description" content="${esc(page.twitterDescription)}" />
  <meta name="twitter:image" content="${img}" />
  <meta name="twitter:image:alt" content="${esc(page.ogImageAlt)}" />
  <link rel="stylesheet" href="${page.root}styles.css?v=${CSS_VERSION}" />
  <link rel="icon" href="${FAVICON}" />
  <script type="application/ld+json">${jsonLd(page)}</script>
</head>`;
}

// ------------------------------------------------------- shared components

/**
 * On the home page every item links to its section. On a case page, "home"
 * items link back to the home page section and "page" items (Contact) to the
 * case page's own section. Work is marked active (and aria-current) on case pages.
 */
function renderNav(page) {
  const links = content.nav
    .map((item) => {
      const href = page.kind === "home" || item.scope === "page" ? `#${item.id}` : `${page.root}#${item.id}`;
      const active = page.kind === "case" && item.id === "work" ? ' class="active" aria-current="true"' : "";
      return `        <a href="${href}"${active}>${esc(item.label)}</a>`;
    })
    .join("\n");
  return `  <nav class="nav" aria-label="Main">
    <div class="nav-inner">
      <a href="${page.kind === "home" ? "#" : page.root}" class="nav-logo">${esc(content.hero.name)}</a>
      <div class="nav-links">
${links}
      </div>
    </div>
  </nav>`;
}

function renderFooter(page) {
  const f = content.footer;
  let link = renderLink(f.link, "", page.root);
  // On the page the link points to, say so to assistive tech.
  if (page.url === SITE_URL + f.link.href) link = link.replace("<a ", '<a aria-current="page" ');
  return `  <footer class="footer">
    <div class="container">
      <p>© <span id="year">${f.year}</span> ${esc(f.name)}. ${esc(f.text)} ${link}</p>
    </div>
  </footer>`;
}

function renderPage(page, body) {
  const source = page.kind === "home" ? "src/content.en.json" : `src/work/${page.data.slug}.en.json`;
  return `<!DOCTYPE html>
<!-- Generated by build.js. Do not edit by hand: edit ${source} and run 'node build.js'. -->
<html lang="${content.htmlLang}">
${renderHead(page)}
<body>

  <a class="skip-link" href="#${content.skipLink.target}">${esc(content.skipLink.label)}</a>

${renderNav(page)}

${body}

${renderFooter(page)}

  <script src="${page.root}script.js?v=${JS_VERSION}"></script>
</body>
</html>
`;
}

// -------------------------------------------------------------- home page

/** Two-column section: sticky heading on the left, body on the right; one column on small screens. */
function renderSection(s, body, extraClass = "") {
  return `    <section id="${s.id}" class="section${extraClass ? " " + extraClass : ""}">
      <div class="container section-grid">
        <h2>${esc(s.title)}</h2>
        <div class="section-body">
${body}
        </div>
      </div>
    </section>`;
}

function renderHero() {
  const h = content.hero;
  const g = content.glance;
  const email = content.contact.email;
  const rows = g.rows
    .map(
      (r) => `            <div class="glance-row">
              <dt>${esc(r.label)}</dt>
              <dd>${inline(r.text)}</dd>
            </div>`
    )
    .join("\n");
  // The Copy button stays hidden without JavaScript; script.js shows it.
  return `    <div class="hero">
      <div class="container hero-grid">
        <div class="hero-main">
          <h1>${esc(h.name)}</h1>
          <p class="hero-lede"><span class="hero-role">${esc(h.role)}</span> ${esc(h.lede)}</p>
          <p class="hero-tagline">${inline(h.text)}</p>
          <div class="hero-actions">
${renderButtons(h.actions, "primary", "ghost", "", "            ")}
          </div>
        </div>
        <div class="glance" id="${g.id}">
          <h2 id="glance-title">${esc(g.title)}</h2>
          <dl>
${rows}
            <div class="glance-row">
              <dt>${esc(g.emailLabel)}</dt>
              <dd class="glance-contact">
                <a class="glance-email" href="mailto:${email}"><span class="glance-address">${esc(email)}</span></a>
                <button type="button" class="btn btn-small copy-btn" data-copy="${email}" data-done="${esc(g.copy.done)}" data-fallback="${esc(g.copy.fallback)}" aria-label="${esc(g.copy.ariaLabel)}" hidden>${esc(g.copy.label)}</button>
                <span class="copy-status" role="status" aria-live="polite"></span>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>`;
}

function renderWork() {
  const w = content.work;
  const f = w.feature;
  const items = w.items
    .map((item) => {
      const status = item.status
        ? `\n                <span class="status"><span class="status-dot" aria-hidden="true"></span>${esc(item.status)}</span>`
        : "";
      return `            <li>
              <div class="built-head">
                <h4>${esc(item.title)}</h4>${status}
              </div>
              <p>${inline(item.text)}</p>
              <div class="built-links">
${renderButtons(item.links, "small-primary", "small", "", "                ")}
              </div>
            </li>`;
    })
    .join("\n");
  return renderSection(
    w,
    `          <article class="feature">
            <p class="feature-kicker">${esc(f.kicker)}</p>
            <h3>${esc(f.title)}</h3>
            <p class="feature-text">${inline(f.text)}</p>
            ${renderLink(f.link, BUTTON_CLASSES["small-primary"])}
          </article>
          <h3 class="built-label">${esc(w.builtLabel)}</h3>
          <ul class="built">
${items}
          </ul>`
  );
}

function renderHowITest() {
  const h = content.howITest;
  const notes = h.items
    .map((n) => {
      const link = n.link ? `\n              ${renderLink(n.link)}` : "";
      return `            <div class="note">
              <h3>${esc(n.title)}</h3>
              <p>${inline(n.text)}</p>${link}
            </div>`;
    })
    .join("\n");
  return renderSection(
    h,
    `          <p class="notes-lede">${inline(h.lede)}</p>
          <div class="notes">
${notes}
          </div>`
  );
}

function renderContact() {
  const c = content.contact;
  return renderSection(
    c,
    `          <p class="contact-text">${esc(c.text)}</p>
          <p class="contact-email-line"><a class="contact-email" href="mailto:${c.email}">${esc(c.email)}</a></p>
          <p class="contact-note">${inline(c.note)}</p>
          <div class="contact-actions">
${renderButtons(c.links, "ghost", "ghost", "", "            ")}
          </div>`,
    "section-contact"
  );
}

function renderHome(page) {
  return renderPage(
    page,
    `  <main id="${content.skipLink.target}">
${renderHero()}

${renderWork()}

${renderHowITest()}

${renderContact()}
  </main>`
  );
}

// -------------------------------------------------------------- case pages

function renderBlock(b, root) {
  const ind = "          ";
  switch (b.type) {
    case "p":
      return `${ind}<p>${inline(b.text, root)}</p>`;
    case "h3":
      return `${ind}<h3>${esc(b.text)}</h3>`;
    case "tech":
      return `${ind}<p class="case-tech">${inline(b.text, root)}</p>`;
    case "list":
    case "steps":
    case "checks": {
      const tag = b.type === "steps" ? "ol" : "ul";
      const cls = { list: "list", steps: "steps", checks: "check-list" }[b.type];
      const items = b.items.map((t) => `${ind}  <li>${inline(t, root)}</li>`).join("\n");
      return `${ind}<${tag} class="${cls}">\n${items}\n${ind}</${tag}>`;
    }
    case "problem": {
      const rows = b.rows
        .map((r) => `${ind}  <div class="problem-row">\n${ind}    <dt>${esc(r.label)}</dt>\n${ind}    <dd>${inline(r.text, root)}</dd>\n${ind}  </div>`)
        .join("\n");
      return `${ind}<dl class="problem">\n${rows}\n${ind}</dl>`;
    }
    case "buttons":
      return `${ind}<div class="case-actions">\n${renderButtons(b.links, "small-primary", "small", root, ind + "  ")}\n${ind}</div>`;
    default:
      throw new Error(`Unknown block type "${b.type}"`);
  }
}

function renderCaseContact(c, root) {
  const cc = content.caseContact;
  const email = content.contact.email;
  const text = `${esc(cc.before)} ${esc(c.contactTopic)}, ${esc(cc.after)} ${renderLink({ href: `mailto:${email}`, label: email })}.`;
  return `        <section id="contact" class="case-contact">
          <h2>${esc(cc.title)}</h2>
          <p>${esc(cc.intro)} ${text}</p>
          <div class="contact-actions">
${renderButtons(cc.actions, "primary", "ghost", root, "            ")}
          </div>
        </section>`;
}

function renderCase(page, next) {
  const c = page.data;
  const root = page.root;
  const facts = c.facts
    .map(
      (f) => `          <div class="fact-row">
            <dt>${esc(f.label)}</dt>
            <dd${f.check ? ' class="has-check"' : ""}>${f.check ? CHECK_ICON : ""}${inline(f.text, root)}</dd>
          </div>`
    )
    .join("\n");
  const actions = c.actions
    ? `\n        <div class="case-actions case-actions-top">\n${renderButtons(c.actions, "primary", "ghost", root, "          ")}\n        </div>`
    : "";
  const sections = c.sections
    .map(
      (s) => `        <section id="${s.id}">
          <h2>${esc(s.title)}</h2>
${s.blocks.map((b) => renderBlock(b, root)).join("\n")}
        </section>`
    )
    .join("\n\n");
  const nextHref = `../${next.data.slug}/`;
  return renderPage(
    page,
    `  <main id="${content.skipLink.target}">
    <div class="container">
      <article class="case">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li><a href="${root}">${esc(content.hero.name)}</a></li>
            <li><a href="${root}#work">${esc(content.breadcrumb.work)}</a></li>
            <li><span aria-current="page">${esc(c.crumb)}</span></li>
          </ol>
        </nav>
        <header class="case-header">
          <p class="case-kicker">${esc(c.kicker)}</p>
          <h1>${esc(c.title)}</h1>
          <p class="case-lede">${inline(c.lede, root)}</p>
        </header>
        <dl class="case-facts">
${facts}
        </dl>${actions}

        <div class="case-body">
${sections}
        </div>

${renderCaseContact(c, root)}
      </article>
    </div>

    <nav class="case-next" aria-label="Next case study">
      <div class="container">
        <p>${esc(content.caseNext.label)}</p>
        ${renderLink({ href: nextHref, label: `${next.data.title} →` })}
      </div>
    </nav>
  </main>`
  );
}

// ------------------------------------------------------------ redirects

/**
 * A noindex stub that sends an old or index-less address to the right place.
 * The script keeps the #fragment (the meta refresh drops it), so old links
 * such as /en/#projects still reach the section script.js maps them to.
 */
function renderRedirect(r, comment) {
  const keepHash = r.to.includes("#") ? "" : " + location.hash";
  return `<!DOCTYPE html>
<!-- Generated by build.js: ${comment} -->
<html lang="${content.htmlLang}">
<head>
  <meta charset="UTF-8" />
  <title>${esc(r.title)}</title>
  <meta name="robots" content="noindex" />
  <link rel="canonical" href="${SITE_URL}" />
  <script>location.replace(${JSON.stringify(r.to)}${keepHash});</script>
  <meta http-equiv="refresh" content="0; url=${r.to}" />
</head>
<body>
  <p><a href="${r.to}">${esc(r.text)}</a></p>
</body>
</html>
`;
}

function renderSitemap() {
  const urls = PAGES.map((p) => `  <url>\n    <loc>${p.url}</loc>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

// ------------------------------------------------------------------ write

function write(file, html) {
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), html);
  console.log(`✓ ${file}`);
}

const casePages = PAGES.filter((p) => p.kind === "case");
for (const page of PAGES) {
  if (page.kind === "home") write(page.out, renderHome(page));
  else write(page.out, renderCase(page, casePages[(casePages.indexOf(page) + 1) % casePages.length]));
}
write("work/index.html", renderRedirect(content.redirects.work, "/work/ redirects to the Work section of the home page."));
write("en/index.html", renderRedirect(content.redirects.en, "the old /en/ address redirects to the home page."));
write("sitemap.xml", renderSitemap());
