# Portfolio de Pedro Morago

![QA](https://github.com/pedromorago/portfolio/actions/workflows/qa.yml/badge.svg)
![links](https://github.com/pedromorago/portfolio/actions/workflows/links.yml/badge.svg)

Web personal de Pedro Morago, Senior QA Engineer: diseño minimalista y claro, con modo oscuro automático. Estática, sin frameworks y sin ninguna petición externa en runtime. Solo en inglés.

- `https://pedromorago.com/`: portada (hero con la tarjeta *At a glance*, Work, How I test, Contact)
- `https://pedromorago.com/work/<slug>/`: un caso de estudio por página
- `/en/` y `/work/` son redirecciones `noindex` a la portada (`/` y `/#work`)

La trayectoria completa (experiencia, skills, formación) vive en LinkedIn; la web no la duplica.

## Arquitectura

```
src/content.en.json          ← textos de la portada y partes comunes (nav, contacto, footer)
src/work/<slug>.en.json      ← un JSON por caso de estudio
build.js                     ← estructura HTML, una sola vez (sin dependencias)
        │ node build.js
        ▼
index.html                   ← generado: portada
work/<slug>/index.html       ← generado: casos de estudio
work/index.html              ← generado: redirección de /work/ a /#work
en/index.html                ← generado: redirección de la URL antigua /en/ a /
sitemap.xml                  ← generado: las páginas indexables, desde la misma lista
styles.css, script.js        ← assets compartidos
404.html                     ← página de error, escrita a mano y autocontenida
og-image.png, work/<slug>/og.png ← imágenes para redes (npm run og)
qa/audit.js                  ← auditoría QA (Playwright)
qa/og-image.js               ← regenera las imágenes para redes
qa/links.js                  ← comprueba los enlaces externos
.github/workflows/qa.yml     ← CI: build + validación + auditoría + despliegue
.github/workflows/links.yml  ← enlaces externos (semanal, no bloquea)
```

La estructura HTML vive una única vez en `build.js` y los textos en JSON. Un cambio de copy no toca el marcado: se edita el JSON, se regenera y el CI comprueba que lo publicado coincide con la fuente.

- **Casos de estudio**: cada `src/work/<slug>.en.json` genera `work/<slug>/index.html`. Los bloques de contenido son `p`, `h3`, `list`, `steps`, `problem`, `tech`, `buttons` y `checks`. El enlace "Next case study" se calcula solo (orden alfabético de los slugs, en bucle).
- **Marcado en los textos**: `[texto](href)` para un enlace y `` `código` `` para código. Los enlaces externos llevan ` ↗` al final de la etiqueta en el JSON; `renderLink()` abre pestaña nueva con `rel="noopener"`, oculta la flecha a los lectores de pantalla y añade "(opens in a new tab)".
- **Sin huecos silenciosos**: `assertContent` recorre cada JSON y falla si algún texto está vacío, indicando la ruta exacta (`$.work.items[2].text`).
- **Versionado automático de assets**: el `?v=` de CSS y JS es un hash del contenido del archivo.
- **Enlaces relativos**: las páginas de caso enlazan con rutas relativas (`../../`, `../screen-recorder/`), así que funcionan igual en GitHub Pages y en local.

## Flujo de trabajo

```bash
# 1. Editar textos en src/content.en.json o src/work/<slug>.en.json
node build.js          # 2. Regenerar los HTML y el sitemap
npm run lint:html      # 3. Validar el HTML
npm run qa             # 4. Auditoría QA en local (el CI también la pasa)
```

Si cambia el hero o la cabecera de un caso, regenerar también las imágenes para redes:

```bash
npm run og
```

Vista previa en local: las páginas enlazan a carpetas (`../../`, `work/this-site/`), y abiertas con `file://` el navegador muestra un listado de directorio en vez de `index.html`. Hace falta un servidor estático:

```bash
python3 -m http.server 8000   # o: npx serve .
# y abrir http://localhost:8000/
```

Requisitos para la auditoría: `npm install` y un Chromium (`npx playwright install chromium`; si ya tienes uno, `CHROMIUM_PATH=/ruta/a/chromium npm run qa`).

## QA en CI

Cada push y pull request ejecuta `.github/workflows/qa.yml`:

1. **Build and drift check**: regenera las páginas y el sitemap y falla si no coinciden con lo commiteado, o si el build crea archivos sin commitear.
2. **Validate HTML**: `html-validate` sobre todas las páginas generadas y `404.html` (`npm run lint:html`).
3. **QA audit** (`qa/audit.js`). Las páginas se descubren en disco: todo HTML sin `noindex` es una página indexable y pasa la auditoría completa.
   - Antes de abrir el navegador: `robots.txt`, `sitemap.xml` con exactamente las páginas indexables, `404.html` con `noindex`, las redirecciones `/en/` y `/work/` (`noindex`, canonical a la raíz, `refresh` al destino correcto), y un `work/<slug>/` por cada JSON de `src/work/` (ni más ni menos).
   - En el navegador, en cada página: sin overflow horizontal en 6 anchos (320 a 1920 px); sin errores de JavaScript ni de consola; ninguna petición fuera de `file:`/`data:`; todos los enlaces internos, anclas, imágenes, CSS y JS resuelven a un archivo del repo (y el ancla existe en la página destino); IDs únicos; un solo h1 y sin saltos de encabezado; title, description (50 a 170), canonical, `lang`, ningún `hreflang` y un único JSON-LD válido; `og:type` correcto y `og:image` existente; contraste WCAG AA (4.5:1) en modo claro y oscuro; áreas táctiles de 24 px en móvil (nav, botones, migas, siguiente caso); enlaces en pestaña nueva con `rel="noopener"` y aviso para lectores de pantalla; skip link a `<main>`; resaltado de la nav (sección visible en la portada, Work en los casos).

La auditoría trabaja sobre `file://`, sin red: es determinista y no puede fallar por causas ajenas al repo.

## Enlaces externos

`.github/workflows/links.yml` comprueba los enlaces externos de todas las páginas (wiki, demos, releases, LinkedIn) cada lunes y cuando cambian los textos. Va aparte del CI y no bloquea el despliegue: que GitHub o LinkedIn tengan un mal minuto no debe impedir publicar un cambio de texto. Los enlaces a `pedromorago.com` los cubre la auditoría contra el repo.

Ejecutable en local con `npm run links`.

## Despliegue

El job `deploy` del mismo workflow publica en GitHub Pages solo en `main` y solo si la auditoría ha pasado. Copia a `_site` únicamente los archivos públicos (`index.html`, `404.html`, `en/`, `work/` con sus `index.html` y `og.png`, `styles.css`, `script.js`, `og-image.png`, `robots.txt`, `sitemap.xml`, `CNAME`), así que `build.js`, `src/`, `qa/`, los `package*.json` y este README no se sirven desde el dominio.
