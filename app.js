/*
 * app.js
 * Lógica de la interfaz (hilo principal):
 *   - Registrar el Service Worker.
 *   - Enviar reportes con fetch POST y, si no hay red, guardarlos en
 *     IndexedDB como 'pendiente' (patrón Outbox).
 *   - Pintar la bandeja de salida y permitir borrar registros.
 *   - Escuchar los avisos (postMessage) que manda sw.js.
 *   - Respaldo con el evento 'online' para navegadores sin SyncManager.
 *
 * Toda la asincronía va con Promesas: new Promise, .then, .catch, Promise.all.
 */

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';
const SYNC_TAG = 'sync-reportes';

const form = document.getElementById('form-incidencia');
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const lista = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');
const mensaje = document.getElementById('mensaje');

/* ---------- 1. Service Worker y mensajes desde sw.js ---------- */

if ('serviceWorker' in navigator) {
  // Ruta relativa: en GitHub Pages el sitio vive en /pwa-outbox-practica/
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => console.log('[App] SW registrado. Scope:', registro.scope))
    .catch((error) => console.error('[App] No se pudo registrar el SW:', error));

  // Mitad receptora del puente postMessage: sw.js avisa y aquí repintamos.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] El Service Worker terminó de sincronizar. Actualizando bandeja...');
      mostrarMensaje('Los reportes pendientes se sincronizaron en segundo plano.');
      renderizarColaOutbox();
    }
  });
}

/* ---------- 2. Indicador de red ---------- */

function actualizarIndicadorRed() {
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

function mostrarMensaje(texto) {
  mensaje.textContent = texto;
}

/* ---------- 3. READ: pintar la bandeja de salida ---------- */

function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      lista.innerHTML = '';

      if (registros.length === 0) {
        const vacio = document.createElement('li');
        vacio.className = 'vacia';
        vacio.textContent = 'No hay reportes guardados.';
        lista.appendChild(vacio);
        return;
      }

      // Los más recientes primero
      registros.reverse().forEach((item) => {
        const li = document.createElement('li');

        const info = document.createElement('div');
        info.className = 'item-info';

        const titulo = document.createElement('div');
        titulo.className = 'item-titulo';
        titulo.textContent = item.titulo; // textContent: evita inyectar HTML

        const hora = document.createElement('div');
        hora.className = 'item-hora';
        hora.textContent = 'Creado: ' + new Date(item.fechaCreacion).toLocaleString('es-MX');

        info.appendChild(titulo);
        info.appendChild(hora);

        const estado = document.createElement('span');
        estado.className = 'estado ' + item.estado;
        estado.textContent = item.estado;

        const btnBorrar = document.createElement('button');
        btnBorrar.type = 'button';
        btnBorrar.className = 'btn-borrar';
        btnBorrar.textContent = 'Borrar';
        btnBorrar.dataset.id = item.id;

        li.appendChild(info);
        li.appendChild(estado);
        li.appendChild(btnBorrar);
        lista.appendChild(li);
      });
    })
    .catch((error) => console.error('[App] No se pudo leer IndexedDB:', error));
}

/* ---------- 4. CREATE: envío resiliente (patrón Outbox) ---------- */

function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: datosFormulario.titulo, body: datosFormulario.descripcion })
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP ' + respuesta.status);
      return respuesta.json();
    })
    .then(() => {
      // Hubo red: se envió en vivo, lo guardamos como bitácora 'sincronizado'
      mostrarMensaje('Reporte enviado al servidor.');
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      // Sin red: el reporte queda en la bandeja de salida como 'pendiente'
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');
      mostrarMensaje('Sin conexión: el reporte quedó pendiente y se enviará al volver la red.');
      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => registrarSync());
    })
    .then(() => renderizarColaOutbox());
}

/*
 * Pide al navegador que dispare el evento 'sync' en sw.js cuando haya red.
 * Solo si el navegador soporta Background Sync (Chrome, Edge, Android).
 */
function registrarSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    return navigator.serviceWorker.ready
      .then((registro) => {
        console.log('[Outbox] Registrando la etiqueta ' + SYNC_TAG + ' en el SW...');
        return registro.sync.register(SYNC_TAG);
      })
      .catch((error) => {
        // Si falla el registro, el reporte sigue a salvo en IndexedDB
        console.warn('[Outbox] No se pudo registrar el sync:', error);
      });
  }
  return Promise.resolve();
}

/* ---------- 5. UPDATE de respaldo (Safari / iOS / Firefox) ---------- */

/*
 * Misma lógica que sincronizarPendientesSW() en sw.js, pero desde la página.
 * Solo se usa en navegadores sin SyncManager.
 */
function sincronizarPendientesFallback() {
  console.log('[Outbox] Fallback: buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay pendientes por sincronizar.');
        return;
      }

      // Cada registro pendiente se convierte en una promesa: POST + actualizar estado
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar el envío del ID ' + item.id);
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      // Esperamos a que TODOS terminen antes de repintar
      return Promise.all(promesasDeEnvio)
        .then(() => mostrarMensaje('Los reportes pendientes se sincronizaron.'));
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => console.error('[Outbox] Error al sincronizar:', error));
}

window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: si hay SyncManager, sw.js se encarga (evento 'sync').
  // Si los dos sincronizaran a la vez, el POST se mandaría duplicado.
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Usando el evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

/* ---------- 6. Formulario (submit) ---------- */

form.addEventListener('submit', (e) => {
  e.preventDefault(); // evita que la página se recargue

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  if (!datos.titulo || !datos.descripcion) return;

  form.reset();
  procesarEnvioReporte(datos);
});

/* ---------- 7. DELETE: borrar uno y purgar sincronizados ---------- */

// Un solo listener en la lista (delegación de eventos) para todos los botones "Borrar"
lista.addEventListener('click', (e) => {
  const boton = e.target.closest('.btn-borrar');
  if (!boton) return;

  const id = Number(boton.dataset.id); // dataset da texto; la llave en IndexedDB es número
  eliminarRegistro(id)
    .then(() => renderizarColaOutbox())
    .catch((error) => console.error('[App] No se pudo borrar:', error));
});

btnPurgar.addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const enviados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(enviados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => console.error('[App] No se pudo purgar:', error));
});

/* ---------- 8. Arranque ---------- */

actualizarIndicadorRed();
renderizarColaOutbox(); // al abrir la página, lee IndexedDB y muestra lo guardado

// Si en Safari/iOS se cerró la pestaña con pendientes, al volver a abrir con red se envían
if (navigator.onLine && !('SyncManager' in window)) {
  sincronizarPendientesFallback();
}
