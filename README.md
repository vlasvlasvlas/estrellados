# estrellados

estrellados es una web app de cielo sonoro situado. Toma el cielo visible en tiempo real, lo proyecta en pantalla y lo convierte en una partitura performativa con arpegios, drones, selección manual y lectura sonora del campo astronómico.

Repositorio:

- GitHub: `https://github.com/vlasvlasvlas/estrellados`

## Estado actual

Hoy el proyecto ya corre como prototipo web estático, sin build step, con:

- visor astronómico basado en VirtualSky
- cielo interactivo a pantalla completa en ancho
- overlay propio en canvas para picking y dibujo del arpegiador
- arranque muteado por default
- mezcla de sonido desde menú compacto
- popup de datos de estrella abierto solo al clickear una estrella
- enlace externo desde cada estrella a SIMBAD
- etiquetas de estrellas y planetas visibles por default
- deploy preparado para GitHub Pages con GitHub Actions

## Interacción actual

- click en una estrella del mapa: abre el popup con sus datos
- click en una estrella de la tira inferior: abre ese mismo popup
- `shift + click` en una estrella: alterna drone
- botón de volumen: activa o silencia el campo sonoro
- botón de nota musical: abre mezcla de `notas`, `drones`, `delay` y `reverb`
- botón de GPS: actualiza la ubicación del cielo
- botón de recentrar: vuelve al encuadre base
- botón de fullscreen: expande solo el visor

## Lógica visual y sonora

El overlay no dibuja todas las estrellas iguales.

- el color visible de cada estrella sigue temperatura estelar, tipo espectral e índice `B-V`
- el núcleo sigue el brillo aparente de la estrella en el cielo
- el halo mezcla brillo aparente con una estimación de luminosidad intrínseca basada en magnitud y distancia
- cuando hay datos confiables del catálogo brillante se usan esos valores
- en el campo amplio de VirtualSky, algunos datos como distancia, espectro y `B-V` pueden estimarse para mantener continuidad visual y sonora

En el popup de cada estrella se muestran:

- altitud
- azimut
- magnitud
- tipo espectral
- distancia
- descripción sonora derivada
- link externo a SIMBAD

## Estructura

- `index.html`: entrada principal
- `src/app.js`: UI, interacción, render del overlay, popup y control general
- `src/astro.js`: cálculo astronómico y perfiles de estrellas
- `src/sound-engine.js`: motor Web Audio
- `src/stars-catalog.js`: catálogo brillante base
- `src/styles.css`: layout e interfaz
- `.github/workflows/pages.yml`: deploy automático a GitHub Pages
- `docs/`: documentos curatoriales y técnicos

## Correr local

Desde la raíz del proyecto:

```bash
python3 -m http.server 8080
```

Después abrir:

```text
http://localhost:8080
```

Si `8080` está ocupado:

```bash
python3 -m http.server 8090
```

## Deploy en GitHub Pages

El repositorio ya incluye un workflow listo en:

`/.github/workflows/pages.yml`

Ese workflow:

1. hace checkout del repositorio
2. configura GitHub Pages
3. copia `index.html` y `src/` a `dist/`
4. sube el artefacto estático
5. publica el sitio

### Activación

1. Abrir `Settings > Pages` en GitHub.
2. En `Source`, elegir `GitHub Actions`.
3. Hacer push a `main`.

### URL esperada

Cuando Pages esté habilitado, la URL del proyecto debería quedar así:

`https://vlasvlasvlas.github.io/estrellados/`

La app usa rutas relativas, así que es compatible con GitHub Pages sin reescribir imports ni assets.

## Dependencias runtime

- navegador moderno con soporte Web Audio
- permiso de interacción del usuario para iniciar audio
- permiso de geolocalización si se usa GPS
- conexión a internet para cargar VirtualSky desde CDN

## Documentos

- `docs/README.md`
- `docs/00-one-pager-curatorial.md`
- `docs/01-fases-de-trabajo.md`
- `docs/02-matriz-curatorial-tecnica.md`
- `docs/03-dossier-residencia.md`
- `docs/04-rider-tecnico-base.md`
- `docs/05-arquitectura-tecnica-v0.md`
