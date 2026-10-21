# Caza Recompensas

Bot que lee las ofertas publicadas por varias comunidades y las envía a un sitio de destino a través de su endpoint de ingesta. Corre solo en GitHub Actions, sin depender de ningún equipo propio.

Estado: lee tres fuentes y publica en el sitio de destino. `npm run dry-run [fuente]` muestra lo que enviaría sin publicar nada; `npm run check` corre typecheck y tests.

## Principios

1. **Solo hechos, no contenido.** De cada post se toma el enlace de la tienda, el cupón, el precio, la categoría y un título. Las fotos las pone el sitio de destino, desde la tienda; la descripción no se copia.
2. **Nunca se reenvía el afiliado de otra comunidad.** El enlace llega al destino tal cual lo publicó la fuente y el destino lo resuelve hasta la tienda, quita los parámetros de afiliado y añade el suyo.
3. **El destino decide.** Rechaza duplicados, tiendas desconocidas, ofertas vencidas y ofertas sin imágenes; el bot solo recuerda lo ya decidido.
4. **Una fuente rota no detiene a las demás.** Se registra el fallo, se sigue con las otras y la corrida termina en error para que GitHub avise por correo.

## Cómo funciona

```text
GitHub Actions (cada 30 min)
  para cada fuente: leer su lista → quitar posts ya vistos o vencidos → enviar del más antiguo al más nuevo
                                                                      │
                         POST {TARGET_URL}/api/bot/ingest ◄───────────┘   (Authorization: Bearer BOT_INGEST_SECRET)
```

| Respuesta del destino | Qué hace el bot                                            |
| --------------------- | ---------------------------------------------------------- |
| 201 publicada         | Recuerda el post                                           |
| 409 duplicada         | Recuerda el post                                           |
| 422 no publicable     | Recuerda el post (no se reintenta)                         |
| 429 tope por hora     | Corta la corrida; el resto queda para la siguiente         |
| 5xx / red             | Reintenta esa oferta en la próxima corrida                 |
| 401 / 503             | Para y termina con error (secreto malo o endpoint apagado) |

## Qué publica

El bot sigue a las comunidades, no copia sus páginas. En cada corrida, por fuente:

1. Solo posts **recientes**: publicados hace menos de 120 minutos (`BOT_MAX_AGE_MINUTES`). Así, la primera corrida no sube la portada entera.
2. Se quitan los ya vistos y los que ya vencieron.
3. Se toman los **3 más nuevos** (`BOT_MAX_PER_SOURCE`) y se envían del más antiguo al más nuevo.

Con tres fuentes y una corrida cada 30 minutos son como máximo 9 ofertas por corrida (el destino además limita por hora). Los posts que no entran vuelven a competir en la corrida siguiente mientras sigan dentro de la ventana; los que envejecen, se pierden. `npm run dry-run` muestra exactamente qué se enviaría.

## Fuentes

Ninguna tiene API oficial. Hay dos formas de leerlas (`src/sources`):

- **Datos embebidos en el HTML:** algunas páginas traen el listado como JSON dentro de la propia página. Se lee con `fetch`, sin navegador, y suele incluir precio, cupón y fecha de fin.
- **Aplicaciones de una sola página:** el HTML llega vacío, así que se renderizan con Playwright. Si el enlace de la tienda y el cupón están en la página de cada oferta, solo se abren las no vistas (máx. 12 por corrida). Los enlaces de Amazon OneLink (`amazon.co.uk/…?ar_su=`) se desenvuelven al producto real, y las ofertas que son cupones de tienda (sin enlace de producto) se omiten.

Agregar una fuente es crear un archivo en `src/sources` que cumpla `Source` (ver `src/types.ts`) y registrarlo en `src/sources/index.ts`.

## Configuración

| Nombre              | Dónde                     | Qué es                                                            |
| ------------------- | ------------------------- | ----------------------------------------------------------------- |
| `TARGET_URL`        | Variable de Actions / env | Origen del sitio de destino                                       |
| `BOT_INGEST_SECRET` | Secreto de Actions / env  | Secreto compartido que abre el endpoint de ingesta (≥ 24 car.)    |
| `BOT_ENABLED`       | Variable de Actions       | `true` enciende el workflow; sin ella no corre                    |
| `STATE_FILE`        | env (opcional)            | Dónde se guardan los posts ya vistos (`seen-posts.json`)          |
| `BOT_MAX_AGE_MINUTES` | env (opcional) | Antigüedad máxima de un post (120) |
| `BOT_MAX_PER_SOURCE` | env (opcional) | Posts por fuente y por corrida (3) |
| `ONLY_SOURCE`       | env (opcional)            | Corre una sola fuente, por su nombre en `src/sources`            |

Puesta en marcha: Settings → Secrets and variables → Actions → definir `BOT_INGEST_SECRET`, `TARGET_URL` y `BOT_ENABLED=true`; luego Actions → run bot → Run workflow para probar.

Cada corrida cuesta unos 2–3 minutos (instala Chromium). El repositorio es público, así que los minutos de Actions no tienen límite; en uno privado (2000 min/mes) habría que bajar la frecuencia. Los posts ya vistos viven en la caché de Actions (se pierden tras 7 días sin corridas; el destino rechaza los duplicados igual).

## Pendiente

- Panel de administración y tabla de estado en Supabase (posts vistos, corridas, errores por fuente, interruptor de pausa).
- Leer los cupones y categorías que algunas fuentes no muestran en su listado.
