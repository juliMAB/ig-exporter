# Política de privacidad — IG Exporter

**Resumen: la extensión no recolecta, no transmite y no comparte ningún dato. Todo queda en tu equipo.**

## Qué datos toca

- Lee el contenido de las páginas de Instagram que **vos** abrís: el JSON público que Instagram ya embebió en el HTML y los datos que la propia página carga mientras scrolleás.
- Guarda los archivos (JSON + imágenes/videos) en **tu** carpeta de Descargas, bajo `ig-exporter/`.

## Qué NO hace

- **No** envía datos a ningún servidor. No hay backend, no hay telemetría, no hay analytics.
- **No** llama a la API de Instagram, ni a GraphQL, ni abre URLs de posts por su cuenta. Es 100% pasiva.
- **No** lee ni exporta cookies, contraseñas ni tokens.
- **No** vende ni comparte datos con terceros.

## Permisos y para qué se usan

- `downloads`: guardar los archivos en tu carpeta de Descargas.
- `storage`: recordar qué ya se bajó (para no repetir) y el estado del panel.
- `tabs`: saber si la pestaña activa es una página de Instagram.
- Acceso a `instagram.com` y a los CDN de Instagram (`cdninstagram.com`, `fbcdn.net`): leer la página y bajar los medios.

## Contacto

Abrí un issue en el repositorio del proyecto.
