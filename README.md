# PWA Outbox · Registro de Incidencias offline

App web en JavaScript Vanilla (sin librerías y sin `async`/`await`) que guarda reportes sin internet y los envía al volver la red.

- **Demo:** https://ignaciovalera.github.io/pwa-outbox-practica/
- **Temas:** 5.1 IndexedDB con promesas · 5.2 Patrón Outbox y GitHub Pages · 5.3 Background Sync y `postMessage`

| Archivo | Qué hace |
|---|---|
| `db-helper.js` | Mini-wrapper de IndexedDB con Promesas: `abrirDB`, `guardarRegistro`, `obtenerTodosLosRegistros`, `actualizarEstadoRegistro`, `eliminarRegistro`. |
| `app.js` | Interfaz: envío con `fetch` POST, si falla guarda `'pendiente'` y registra `sync-reportes`; pinta la bandeja, borra registros, escucha `postMessage` y usa el evento `online` como respaldo sin `SyncManager`. |
| `sw.js` | Service Worker: cachea el App Shell, reenvía pendientes en el evento `sync` y avisa a las pestañas con `postMessage`. |
| `index.html` / `styles.css` / `manifest.json` | Estructura, estilos y manifiesto, todo con rutas relativas `./`. |

## Probar
1. Abre la demo y en DevTools → Network marca **Offline**.
2. Envía un reporte: aparece como `pendiente` (DevTools → Application → IndexedDB → `pwa-outbox-db`).
3. Quita **Offline**: el Service Worker lo envía y cambia a `sincronizado`.
