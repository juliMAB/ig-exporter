# Ficha para la tienda de Opera (addons.opera.com)

Copiá y pegá esto en el formulario de subida.

## Nombre

```
IG Exporter
```

## Versión

```
1.1.0
```

## Categoría

```
Social
```

## Licencia

```
MIT (ver LICENSE en el repositorio)
```

## Resumen (una línea, para el catálogo)

```
Guardá publicaciones de Instagram —datos y medios— en tu disco, sin usar la API y sin mandar nada a ningún servidor.
```

## Descripción (detalle)

```
IG Exporter guarda publicaciones de Instagram en tu equipo: un archivo JSON con autor, texto, fecha, likes, comentarios, ubicación y las URLs de los medios, más las imágenes y videos descargados.

La extensión es 100% pasiva. No usa la API de Instagram, no hace GraphQL y no inicia ninguna conexión: solo lee el JSON que Instagram ya embebió en la página que tenés abierta y los datos que la propia página carga mientras scrolleás. Todo el proceso corre en tu navegador, con tu sesión, y los archivos quedan en tu carpeta de Descargas.

Qué podés hacer:
- Guardar una publicación puntual con un clic.
- Extraer una colección o tu grilla de guardados a medida que scrolleás.
- Reintentar sin duplicar: la extensión recuerda lo que ya bajó.

Dónde quedan los archivos:
<Descargas>/ig-exporter/<usuario>/<codigo>.json  (+ las imágenes y videos)

Privacidad:
No hay servidor, no hay telemetría y no se comparte nada con terceros. No lee cookies, contraseñas ni tokens. Ver la política de privacidad incluida.

Límite conocido: solo extrae lo que ya está cargado en la página; hay que scrollear para traer más, y los videos servidos por streaming (blob:) pueden no descargarse.
```

## Extension support page (opcional pero recomendado)

```
https://github.com/juliMAB/ig-exporter
```

## Ícono

Ya incluido en el paquete: `icons/icon128.png` (y 16/32/48).

## Capturas (las tenés que sacar vos)

La tienda pide capturas de **612×408 px** (máx. 800×600), fondo blanco, sin otras extensiones visibles. Sugeridas:
1. El panel de **IG Exporter** abierto sobre una publicación, con el botón "Guardar esta publicación".
2. La carpeta `Descargas/ig-exporter/...` con los `.json` y los medios.

## Pasos para publicar

1. Entrá a https://addons.opera.com/developer/ y logueate (o creá cuenta).
2. **Upload Extension** → subí el ZIP del paquete de la tienda.
3. Completá nombre, categoría, licencia, resumen, descripción, capturas e ícono.
4. Enviá a revisión. Un moderador la prueba; si pasa, queda publicada. Si la rechazan, te avisan el motivo y podés resubir.
