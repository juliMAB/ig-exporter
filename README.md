# IG Exporter

Extensión local (Manifest V3) para **Opera GX / Chrome / Edge / Brave** que guarda publicaciones de Instagram —datos + medios— en tu disco.

**No usa la API de Instagram. No hace GraphQL. No manda nada a ningún servidor.**

## Cómo funciona (seguridad)

- Corre **dentro de tu navegador**, con **tu propia sesión** ya logueada.
- Es **100% pasiva**: **no dispara ningún request a Instagram**. Ni a `/api/v1/...`, ni a `/graphql/...`, ni siquiera abre la URL pública del post.
- Solo lee dos cosas que la página **ya tiene**:
  1. el JSON embebido en el HTML que Instagram ya te entregó, y
  2. los payloads que la **propia página** pide al scrollear (la extensión los observa, no los provoca).
- Las descargas de medios están limitadas por lista blanca a los CDN de Instagram (`cdninstagram.com`, `fbcdn.net`).
- El JSON se guarda únicamente bajo la carpeta `ig-exporter/`.

En una prueba E2E sobre Chromium real se verifica que, tras apretar el botón, la extensión agrega **0 requests** a Instagram.

## Instalación en Opera GX

1. Abrí el menú de Opera y andá a **Extensiones → Extensiones** (o escribí `opera://extensions` en la barra).
2. Activá el **Modo desarrollador** (arriba a la derecha).
3. Clic en **Cargar extensión sin empaquetar** / *Load unpacked*.
4. Elegí esta carpeta (la que contiene `manifest.json`).
5. Opcional: fijá el ícono en la barra.

En Chrome/Edge/Brave es igual (`chrome://extensions` / `edge://extensions`).

## Uso

### Guardar una publicación

1. Abrí la publicación en Instagram y **esperá a que cargue del todo**.
2. Clic en el ícono de **IG Exporter**.
3. En el panel de abajo a la derecha, clic en **Guardar esta publicación**.

### Extraer una colección o la grilla de guardados

1. Abrí la vista de la colección (o *Guardados*).
2. **Scrolleá la grilla** hasta cargar todo lo que querés (Instagram carga de a poco; la extensión solo ve lo que ya está en pantalla).
3. Clic en el ícono y luego en **Extraer lo que hay en pantalla**.
4. Esperá el log. Si quedó algo afuera, **scrolleá más abajo y volvé a apretar** para traer el resto.

Es **idempotente**: cada vista guarda un registro de lo ya bajado, así reintentar no vuelve a descargar lo mismo.

## Dónde quedan los archivos

En tu carpeta de descargas:

```
<Descargas>/ig-exporter/<usuario>/<codigo>.json
<Descargas>/ig-exporter/<usuario>/<codigo>.jpg|mp4
<Descargas>/ig-exporter/<usuario>/<codigo>_2.jpg   (carrusel)
```

## Formato del JSON

```json
{
  "source": "instagram",
  "shortcode": "ABC123",
  "id": "111",
  "url": "https://www.instagram.com/p/ABC123/",
  "taken_at": 1700000000,
  "taken_at_iso": "2023-11-14T22:13:20.000Z",
  "media_type": 8,
  "product_type": "carousel_container",
  "caption": "texto del post",
  "owner": { "id": "12345", "username": "juli_aguirr", "full_name": "Juli" },
  "like_count": 42,
  "comment_count": 7,
  "play_count": null,
  "location": null,
  "is_carousel": true,
  "media": [
    { "kind": "image", "url": "https://.../m1.jpg", "width": 1080, "height": 1080 },
    { "kind": "video", "url": "https://.../m2.mp4", "width": 1080, "height": 1920 }
  ],
  "extracted_at": "2026-10-15T00:47:24.575Z"
}
```

## Tests

```
npm install            # solo playwright-core, para los E2E
npm test               # parser + nombres (offline, sin red)
npm run test:e2e       # carga la extensión en Chromium real con IG mockeada
```

Los E2E mockean **todo** el tráfico a `instagram.com` y a los CDN: cero requests reales a Instagram. Además **verifican la pasividad**: cuentan los requests a Instagram durante la extracción y exigen que la extensión aporte 0.

## Límites

- Videos que se sirven por streaming (`blob:`) pueden no bajarse.
- Solo extrae lo que está cargado en la página; hay que scrollear.
- No exporta comentarios ni listas de seguidores.
