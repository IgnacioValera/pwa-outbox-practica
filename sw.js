/*
 * sw.js
 * Service Worker: corre en un hilo aparte, sin window ni document.
 *   1. App Shell: guarda los archivos en Cache Storage para abrir sin red.
 *   2. Background Sync: con el evento 'sync' reenvía los reportes pendientes,
 *      aunque la pestaña esté cerrada.
 *   3. postMessage: avisa a las pestañas abiertas para que repinten la lista.
 */

// Trae abrirDB, obtenerTodosLosRegistros, actualizarEstadoRegistro... al SW.
// Los SW no tienen <script>, por eso se usa importScripts (ruta relativa).
importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v2';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

/* ---------- 1. Ciclo de vida y App Shell ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting()) // activa la nueva versión sin esperar
  );
});

self.addEventListener('activate', (event) => {
  // Borra cachés de versiones anteriores (static-outbox-v1, etc.)
  event.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_STATIC_NAME)
          .map((nombre) => caches.delete(nombre))
      ))
      .then(() => self.clients.claim()) // controla las pestañas ya abiertas
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo GET de nuestro propio sitio. El POST a la API pasa directo a la red:
  // así, sin internet, fetch falla y app.js lo guarda como 'pendiente'.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // Cache first: si está en caché se responde de ahí; si no, se pide a la red.
  event.respondWith(
    caches.match(req, { ignoreSearch: true })
      .then((enCache) => enCache || fetch(req))
  );
});

/* ---------- 2. postMessage: avisar a la interfaz ---------- */

function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

/* ---------- 3. Motor de sincronización en segundo plano ---------- */

function sincronizarPendientesSW() {
  console.log('[SW-Sync] Buscando transacciones pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[SW-Sync] Cola limpia. Nada por sincronizar.');
        return;
      }

      // arreglo de registros -> arreglo de promesas (POST + actualizar estado)
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((respuesta) => {
            if (!respuesta.ok) {
              throw new Error('Error HTTP ' + respuesta.status + ' al sincronizar ID ' + item.id);
            }
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio)
        .then(() => notificarClientesActualizacion());
    });
}

self.addEventListener('sync', (event) => {
  console.log('[SW-Sync] Evento sync con etiqueta:', event.tag);

  if (event.tag === 'sync-reportes') {
    // waitUntil mantiene vivo al SW hasta que la promesa termine
    event.waitUntil(
      sincronizarPendientesSW()
        .catch((error) => {
          console.error('[SW-Sync] Falló; el navegador reintentará después:', error);
          throw error; // relanzar = la promesa se rechaza = el navegador reprograma el sync
        })
    );
  }
});
