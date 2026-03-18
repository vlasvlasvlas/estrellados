# estrellados

estrellados es una web app de cielo sonoro situado: toma el cielo visible en tiempo real y lo convierte en una partitura performativa con arpegios, drones y selección manual de estrellas sobre el mapa.

## Qué incluye hoy

- visor astronómico basado en VirtualSky
- overlay interactivo sobre el cielo
- arpegiador, drones y mezcla de sonido
- selección de estrellas desde el mapa y desde la tira inferior
- soporte para geolocalización en navegador
- despliegue estático compatible con GitHub Pages

## Estructura

- `index.html`: entrada principal
- `src/app.js`: UI, interacción, render del overlay y control general
- `src/astro.js`: cálculo astronómico y perfiles
- `src/sound-engine.js`: motor de audio Web Audio
- `src/stars-catalog.js`: catálogo brillante base
- `src/styles.css`: interfaz y layout
- `docs/`: documentos curatoriales y técnicos del proyecto

## Correr local

Desde la raíz del proyecto:

```bash
python3 -m http.server 8080
```

Después abrir:

```text
http://localhost:8080
```

Si `8080` está ocupado, usar otro puerto:

```bash
python3 -m http.server 8090
```

## Deploy en GitHub Pages

El repo ya queda preparado para publicar con GitHub Actions usando el workflow:

`/.github/workflows/pages.yml`

### Qué hace ese workflow

1. Hace checkout del repositorio.
2. Configura GitHub Pages.
3. Copia a `dist/` solo los archivos necesarios para la app estática:
   - `index.html`
   - `src/`
4. Sube ese artefacto.
5. Lo publica en GitHub Pages.

### Cómo activarlo

1. Subí este repo a GitHub.
2. Confirmá que la rama principal sea `main` o `master`.
3. En GitHub, abrí `Settings > Pages`.
4. En `Source`, elegí `GitHub Actions`.
5. Hacé push a la rama principal.
6. GitHub va a ejecutar el workflow y publicar el sitio.

### URL esperada

- Si es un repositorio de proyecto:
  `https://TU-USUARIO.github.io/estrellados/`
- Si es un repositorio de usuario/organización:
  `https://TU-USUARIO.github.io/`

La app usa rutas relativas (`./src/...`), así que funciona correctamente bajo GitHub Pages sin reescribir imports para subcarpetas.

## Notas de compatibilidad

- requiere un navegador con soporte de Web Audio
- para audio, el usuario tiene que interactuar con la página al menos una vez
- GPS depende de permisos del navegador
- VirtualSky se carga desde CDN externa

## Documentos

- `docs/README.md`
- `docs/00-one-pager-curatorial.md`
- `docs/01-fases-de-trabajo.md`
- `docs/02-matriz-curatorial-tecnica.md`
- `docs/03-dossier-residencia.md`
- `docs/04-rider-tecnico-base.md`
- `docs/05-arquitectura-tecnica-v0.md`
