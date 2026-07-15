# Portfolio · Pedro Morago

![QA](https://github.com/pedro-morago/portfolio/actions/workflows/qa.yml/badge.svg)

Web personal de portfolio de QA Engineer, con estética de terminal. Estática, sin frameworks y sin ninguna petición externa en runtime.

- Español: `https://pedro-morago.github.io/portfolio/`
- Inglés: `https://pedro-morago.github.io/portfolio/en/`

## Arquitectura

```
src/content.es.json   ← textos en español          (editar aquí)
src/content.en.json   ← textos en inglés           (editar aquí)
build.js              ← estructura de la página, una sola vez (sin dependencias)
        │ node build.js
        ▼
index.html            ← generado, no editar a mano
en/index.html         ← generado, no editar a mano
styles.css, script.js ← assets compartidos
qa/audit.js           ← auditoría QA (Playwright)
qa/og-image.js        ← regenera og-image.png
.github/workflows/qa.yml ← CI: build + auditoría en cada push
```

La estructura HTML vive una única vez en `build.js`; cada idioma es solo un archivo de datos. Así un cambio de estructura se hace en un sitio y un cambio de texto en el JSON del idioma que toque, sin riesgo de que las dos versiones diverjan.

Dos salvaguardas del build:

- **Validación de paridad**: los dos JSON deben tener las mismas claves, arrays de la misma longitud y ningún valor vacío; si no, el build falla con un error que señala la ruta exacta.
- **Versionado automático de assets**: el `?v=` de CSS y JS es un hash del contenido del archivo, así que el cache-busting ocurre solo, sin bumps manuales.

## Flujo de trabajo

```bash
# 1. Editar contenido en src/content.es.json y src/content.en.json
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
3. **Auditoría** (`qa/audit.js`) sobre ambos idiomas:
   - Sin overflow horizontal en 6 viewports (320px a 1920px)
   - Sin errores de JavaScript ni de consola
   - Anclas válidas, IDs únicos, un solo h1, jerarquía de encabezados correcta
   - Metadatos: title, description, canonical y hreflang completos
   - Contraste de texto WCAG AA (mínimo 4.5:1)
   - Áreas táctiles de la navegación en móvil
   - `rel="noopener"` en enlaces externos
   - Comportamiento: el efecto de tecleo del hero completa y el resaltado de sección activa en la nav funciona al hacer scroll
   - Archivos auxiliares: `robots.txt`, `sitemap.xml` y `404.html` coherentes con las URLs canónicas
   - Paridad ES/EN: mismas secciones, proyectos, enlaces y versiones de assets, y el selector de idioma en la misma posición exacta en ambas versiones (test de regresión de un bug real)

## Despliegue

El despliegue a GitHub Pages lo hace el propio workflow (job `deploy`) y **solo en `main` y solo si la auditoría ha pasado**: el CI es un quality gate real, no un semáforo decorativo. Un push que rompa la auditoría no llega a publicarse.

Los HTML generados siguen commiteados en el repo: la web es reproducible en local con solo abrir `index.html`, sin build ni dependencias.

Otros archivos: `404.html` (página de error temática), `sitemap.xml` y `robots.txt`.
