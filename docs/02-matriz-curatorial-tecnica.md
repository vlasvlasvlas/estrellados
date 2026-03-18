# Matriz Curatorial-Tecnica (v1)

Sistema: cielo visible en tiempo real + interaccion por click, traducido a capas de drone, arpegio y ritmo.

| Parametro celeste | Normalizacion tecnica | Resultado sonoro | Regla curatorial |
|---|---|---|---|
| Magnitud aparente | Escala -1 a +6 | Volumen/presencia | Mas brillo, mas protagonismo |
| Distancia | Escala logaritmica | Reverb + low-pass | Mas lejos, mas difuso |
| Tipo espectral (OBAFGKM) | Tabla discreta | Familia timbrica | O/B brillante, K/M oscuro |
| Indice de color (B-V) | Rango continuo | Brillo armonico | Azul abre, rojo cierra |
| Altitud | 0 a 90 grados | Registro/pitch | Horizonte grave, cenit agudo |
| Azimut | 0 a 360 grados | Paneo estereo | Relacion fija cardinal-espacio |
| Modo temporal | ahora/24h/estacional | BPM y densidad | El tiempo del cielo define pulso |
| Proximidad al horizonte | Umbral de zona | Textura de ruido/aire | Friccion atmosferica en borde |
| Constelacion | Agrupacion | Motivo/arpegio | Celula compartida por grupo |
| Estado salida/puesta | Evento | Envelope/acento | Salida ataca, puesta libera |
| Tipo de cuerpo | Clasificacion | Capa activa | Planetas drones, luna macro-mod |
| Peso de interaccion | Estado UI | Solo/mute/freeze/send FX | Performance guiada por gesto |

## Reglas de interaccion

1. Click: activa/desactiva voz y abre metadata.
2. Doble click: solo temporal (8 s).
3. Shift+click: envia objeto al bus de arpegio.
4. Long press: freeze del snapshot celeste (10-20 s).
5. Slider de tiempo: cambia entre modos temporales.
6. Polifonia maxima: 8 voces activas.
7. Silencio estructural: 10 s cada 3 min.
8. Fallback: preset neutro si falta distancia o espectro.
