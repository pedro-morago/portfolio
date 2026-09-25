# Pedro Morago's portfolio

![QA](https://github.com/pedromorago/portfolio/actions/workflows/qa.yml/badge.svg)
![links](https://github.com/pedromorago/portfolio/actions/workflows/links.yml/badge.svg)

The personal site of Pedro Morago, Senior QA Engineer: minimal and light, with automatic dark mode. Static, with no frameworks and no requests to other servers at runtime. English only.

- `https://pedromorago.com/`: home page (hero with the *At a glance* card, Work, How I test, Contact)
- `https://pedromorago.com/work/<slug>/`: one case study per page
- `/en/` and `/work/` are `noindex` redirects to the home page (`/` and `/#work`)

Career history (experience, skills, education) lives on LinkedIn, and this site doesn't repeat it.

## Architecture

```
src/content.en.json          ← copy for the home page and shared parts (nav, contact, footer)
src/work/<slug>.en.json      ← one JSON file per case study
build.js                     ← the HTML structure, written once (no dependencies)
        │ node build.js
        ▼
index.html                   ← generated: home page
work/<slug>/index.html       ← generated: case studies
work/index.html              ← generated: redirect from /work/ to /#work
en/index.html                ← generated: redirect from the old /en/ address to /
sitemap.xml                  ← generated: the indexable pages, from the same list
styles.css, script.js        ← shared assets
404.html                     ← error page, hand-written and self-contained
og-image.png, work/<slug>/og.png ← share images (npm run og)
qa/og-sources.json           ← the text each share image shows (npm run og)
qa/audit.js                  ← QA audit (Playwright)
qa/og-image.js               ← regenerates the share images
qa/links.js                  ← checks the external links
.github/workflows/qa.yml     ← CI: build, validation, audit and deploy
.github/workflows/links.yml  ← external links (weekly, never blocks a deploy)
```

The HTML structure lives once in `build.js` and the copy lives in JSON. A copy change never touches the markup: edit the JSON, rebuild, and CI checks that what is published matches the source.

- **Case studies**: each `src/work/<slug>.en.json` generates `work/<slug>/index.html`. The content blocks are `p`, `h3`, `list`, `steps`, `problem`, `tech`, `buttons` and `checks`. The "Next case study" link is worked out automatically (slugs in alphabetical order, looping).
- **Markup in the copy**: `[text](href)` for a link and `` `code` `` for code. External link labels end in ` ↗` in the JSON; `renderLink()` opens them in a new tab with `rel="noopener"`, hides the arrow from screen readers and adds "(opens in a new tab)".
- **No silent gaps**: `assertContent` walks every JSON file and stops the build on an empty text field, naming its path (`$.work.items[2].text`). A missing field stops it too.
- **Automatic asset versions**: the `?v=` on the CSS and JS is a hash of the file's content.
- **Relative links**: case pages link with relative paths (`../../`, `../screen-recorder/`), so they work the same on GitHub Pages and locally.

## Workflow

```bash
# 1. Edit the copy in src/content.en.json or src/work/<slug>.en.json
node build.js          # 2. Regenerate the HTML and the sitemap
npm run lint:html      # 3. Validate the HTML
npm run qa             # 4. Run the QA audit locally (CI runs it too)
```

If the hero or a case study header changes, regenerate the share images as well and commit them with `qa/og-sources.json` (the audit fails if an image shows old text):

```bash
npm run og
```

Local preview: the pages link to folders (`../../`, `work/this-site/`), and over `file://` the browser shows a directory listing instead of `index.html`. Use a static server:

```bash
python3 -m http.server 8000   # or: npx serve .
# then open http://localhost:8000/
```

The audit needs `npm install` and a Chromium (`npx playwright install chromium`; if you already have one, `CHROMIUM_PATH=/path/to/chromium npm run qa`). Node 22.22 or later.

## QA in CI

Every push and pull request runs `.github/workflows/qa.yml`:

1. **Build and drift check**: regenerates the pages and the sitemap, and fails if they differ from what is committed or if the build creates files that are not committed.
2. **Validate HTML**: `html-validate` on every generated page and `404.html` (`npm run lint:html`).
3. **Collect the public files** into `_site`, the folder that gets published.
4. **QA audit** (`SITE_ROOT=_site npm run qa`), on that folder. Pages are discovered on disk: every HTML file without `noindex` is an indexable page and gets the full audit.
   - Before the browser opens: `robots.txt` points to the sitemap and doesn't block the site; `sitemap.xml` lists exactly the indexable pages; `404.html` has `noindex`; the `/en/` and `/work/` redirects have `noindex`, a canonical to the root and a refresh to the right place; there is one `work/<slug>/` for each JSON file in `src/work/`, no more and no less.
   - In the browser, on every page: no horizontal overflow at 6 widths (320 to 1920 px); no JavaScript or console errors; no requests outside `file:`/`data:`; every internal link, anchor, image, stylesheet and script resolves to a file in the published folder (and the anchor exists on the target page); unique IDs; one h1 and no skipped heading levels; title, description (50 to 170 characters), canonical, `lang`, no `hreflang` and exactly one valid JSON-LD block; the right `og:type`, and an `og:image` that exists, is 1200x630 and shows the page's current headline; WCAG AA contrast (4.5:1) in light and dark mode, for a list of text styles plus a sweep of every visible text node; 24 px tap targets on phones (nav, buttons, breadcrumb, next case); new-tab links with `rel="noopener"` and a note for screen readers; a skip link to `<main>`; nav highlighting (the section in view on the home page, Work on the case studies).
   - `404.html` is opened in the browser too: overflow, errors, requests to other servers and contrast.

The audit works over `file://` with no network, so it is deterministic and can't fail for reasons outside the repository.

## External links

`.github/workflows/links.yml` checks the external links on every page (wiki, demos, releases, LinkedIn) every Monday and whenever the copy changes. It runs separately from CI and never blocks a deploy: a bad minute at GitHub or LinkedIn shouldn't stop a copy change from going out. Links to `pedromorago.com` are covered by the audit.

Run it locally with `npm run links`.

## Deploy

On `main` only, and only when the audit has passed, the `qa` job uploads `_site` and the `deploy` job publishes it to GitHub Pages. `_site` holds only the public files (`index.html`, `404.html`, `en/`, `work/` with its `index.html` and `og.png` files, `styles.css`, `script.js`, `og-image.png`, `robots.txt`, `sitemap.xml`, `CNAME`), so `build.js`, `src/`, `qa/`, the `package*.json` files and this README are never served from the domain.
