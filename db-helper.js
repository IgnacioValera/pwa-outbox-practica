/*
 * db-helper.js
 * Mini-wrapper de IndexedDB con Promesas (sin librerías).
 *
 * La API nativa de IndexedDB avisa con eventos (onsuccess, onerror...).
 * Aquí cada operación se envuelve en new Promise(...) para poder usarla
 * con .then() y .catch(), igual que fetch() y la Cache API.
 *
 * Este archivo se carga en dos lugares:
 *   - index.html  ->  <script src="./db-helper.js">
 *   - sw.js       ->  importScripts('./db-helper.js')
 * Por eso no usa window ni document: el Service Worker no los tiene.
 */

const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

/*
 * abrirDB: abre (o crea) la base de datos.
 * onupgradeneeded solo corre si la BD es nueva o si subimos DB_VERSION.
 * Es el ÚNICO lugar donde se pueden crear object stores.
 */
function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // keyPath 'id' + autoIncrement: IndexedDB asigna 1, 2, 3...
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/*
 * guardarRegistro (CREATE): inserta un objeto y devuelve su id.
 * req.onsuccess nos da el id, pero el dato solo está seguro en disco
 * cuando la transacción termina (tx.oncomplete). Por eso resolvemos ahí.
 */
function guardarRegistro(datos) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let idGenerado;

      const req = store.add(datos);
      req.onsuccess = (event) => {
        idGenerado = event.target.result;
      };

      tx.oncomplete = () => resolve(idGenerado);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

/*
 * obtenerTodosLosRegistros (READ): devuelve un arreglo con todo el store.
 * Solo lee, así que basta una transacción 'readonly'.
 */
function obtenerTodosLosRegistros() {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);

      const req = store.getAll();
      req.onsuccess = (event) => resolve(event.target.result);
      req.onerror = (event) => reject(event.target.error);
    });
  });
}

/*
 * actualizarEstadoRegistro (UPDATE): cambia 'pendiente' -> 'sincronizado'.
 * get() y put() van en la MISMA transacción 'readwrite', así nadie puede
 * modificar el registro entre la lectura y la escritura.
 */
function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const reqGet = store.get(id);
      reqGet.onsuccess = (event) => {
        const registro = event.target.result;
        if (!registro) {
          reject(new Error('No se encontró el registro con ID: ' + id));
          return;
        }
        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        store.put(registro);
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

/*
 * eliminarRegistro (DELETE): borra un registro por su llave primaria.
 */
function eliminarRegistro(id) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      store.delete(id);

      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}
