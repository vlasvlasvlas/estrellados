# Arquitectura Tecnica v0

## Objetivo de esta version

Construir una base navegable y performativa que combine:

1. Visualizacion del cielo en tiempo real por ubicacion.
2. Metadata de estrellas visibles con interaccion clickeable.
3. Motor sonoro experimental inicial (nota, drone, pulso/arpegio base).

## Stack v0

- Frontend estatico: HTML + CSS + JavaScript ES Modules.
- Cielo: VirtualSky (render visual de boveda celeste).
- Audio: Web Audio API nativa.
- Datos estelares iniciales: catalogo local de estrellas brillantes.

## Modulos del prototipo

- src/app.js
Orquestacion general, estado de interfaz y eventos.

- src/astro.js
Calculos astronomicos basicos: conversion RA/Dec a Alt/Az y filtro de visibilidad.

- src/stars-catalog.js
Catalogo base de estrellas con metadatos fisicos y observacionales.

- src/sound-engine.js
Motor sonoro: notas por evento, drones por estrella y reloj ritmico segun modo temporal.

- src/styles.css
Lenguaje visual, layout responsive y componentes de control.

## Flujo de datos

1. Se define ubicacion (default o GPS).
2. Se calcula fecha observacional (modo ahora, 24h, estacional).
3. Se filtran estrellas visibles (altitud mayor a 0 grados).
4. Se renderiza panel clickeable con metadata.
5. Cada evento de usuario se traduce a accion sonora.

## Decisiones de diseno v0

- Mapa y clickeo desacoplados: el cielo se ve en VirtualSky y la interaccion fina vive en el panel lateral.
- Catalogo acotado: estrellas brillantes para asegurar legibilidad y rendimiento.
- Mapeo explicable: cada parametro sonoro tiene correspondencia con metadata astral.

## Limites actuales

- No hay picking directo sobre el pixel de cada estrella en el mapa.
- El catalogo no incluye todo el cielo profundo.
- No hay aun grabacion de performance ni escenas preprogramadas.

## Siguiente iteracion (v1)

1. Picking visual sobre canvas/mapa y feedback espacial mas directo.
2. Escenas performativas guardables (acto 1, 2 y 3).
3. Export de score y log de eventos para documentacion de residencia.
