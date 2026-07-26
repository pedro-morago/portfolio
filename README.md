# Portfolio · Pedro Morago

![QA](https://github.com/pedro-morago/portfolio/actions/workflows/qa.yml/badge.svg)
![links](https://github.com/pedro-morago/portfolio/actions/workflows/links.yml/badge.svg)

Web personal de portfolio de QA Engineer, con estética de terminal. Estática, sin frameworks y sin ninguna petición externa en runtime. Solo en inglés (público objetivo: mercado internacional).

- `https://pedromorago.com/` (la antigua `/en/` redirige a la raíz)

## Arquitectura

```
src/content.en.json   ← textos (editar aquí)
build.js              ← estructura de la página, una sola vez (sin dependencias)
        │ node build.js
        ▼
index.html            ← generado, no editar a mano
en/index.html         ← generado: redirección de la URL antigua a la raíz
styles.css, script.js ← assets compartidos
qa/audit.js           ← auditoría QA (Playwright)
qa/og-image.js        ← regenera og-image.png
.github/workflows/qa.yml    ← CI: build + auditoría + despliegue
.github/workflows/links.yml ← enlaces externos vivos (semanal, no bloquea)
```

La estructura HTML vive una única vez en `build.js` y los textos en un único JSON. El motivo es que un cambio de copy no toque nunca el marcado: se edita el JSON, se regenera y el CI comprueba que lo publicado coincide con la fuente.

Dos salvaguardas del build:

- **Sin huecos silenciosos**: `assertContent` recorre el JSON y falla si algún valor de texto está vacío, señalando la ruta exacta (`$.projects.items[2].tagline`). Un campo olvidado rompe el build en vez de publicar un hueco.
- **Versionado automático de assets**: el `?v=` de CSS y JS es un hash del contenido del archivo, así que el cache-busting ocurre solo, sin bumps manuales.

## Flujo de trabajo

```bash
# 1. Editar contenido en src/content.en.json
node build.js          # 2. Regenerar los HTML
npm run qa             # 3. Auditoría QA en local (opcional, el CI también la pasa)
git add -A && git commit && git push
```

Si cambia el hero, regenerar también la imagen para redes sociales:

```bash
npm run og
```

Requisitos para la auditoría en local: `npm install` y un Chromium disponible (Playwright lo instala con `npx playwright install chromium`; si ya tienes uno, `CHROMIUM_PATH=/ruta/a/chromium npm run qa`).

## QA en CI

Cada push ejecuta `.github/workflows/qa.yml`:

1. **Build y drift**: regenera los HTML y falla si no coinciden con lo commiteado (evita ediciones a mano de los generados o divergencia entre `src/` y la web publicada).
2. **Validación de HTML** con `html-validate` (`npm run lint:html`).
3. **Auditoría** (`qa/audit.js`):
   - Sin overflow horizontal en 6 viewports (320px a 1920px)
   - Sin errores de JavaScript ni de consola
   - Anclas válidas, IDs únicos, un solo h1, jerarquía de encabezados correcta
   - Metadatos: title, description en rango, canonical correcto y **ningún** `hreflang` (el sitio es monolingüe: un `hreflang` superviviente de la etapa bilingüe sería un error de SEO)
   - Contraste de texto WCAG AA (mínimo 4.5:1) sobre 13 selectores
   - Áreas táctiles de la navegación en móvil (>= 24px)
   - `rel="noopener"` en enlaces externos
   - Comportamiento: el efecto de tecleo del hero completa y el resaltado de sección activa en la nav funciona al hacer scroll
   - Archivos auxiliares: `robots.txt`, `sitemap.xml`, `404.html` y la redirección `/en/` coherentes con las URLs canónicas

La auditoría trabaja sobre `file://`, sin red: es determinista y no puede fallar por causas ajenas al repo.

## Enlaces externos

`.github/workflows/links.yml` comprueba semanalmente que los enlaces externos de la web siguen vivos (wiki, demos, releases, LinkedIn). Va **aparte del CI y no bloquea el despliegue** a propósito: que GitHub o LinkedIn tengan un mal minuto no puede impedir publicar un cambio de texto. Lo que sí evita es el link rot silencioso, que en un portfolio lo ve antes un reclutador que su dueño.

Ejecutable en local con `npm run links`.

## Despliegue

El despliegue a GitHub Pages lo hace el propio workflow (job `deploy`) y **solo en `main` y solo si la auditoría ha pasado**: el CI es un quality gate real, no un semáforo decorativo. Un push que rompa la auditoría no llega a publicarse.

Los HTML generados siguen commiteados en el repo: la web es reproducible en local con solo abrir `index.html`, sin build ni dependencias.

Otros archivos: `404.html` (página de error temática), `sitemap.xml` y `robots.txt`.
