// Acceso a la carpeta de OneDrive mediante File System Access API (Chrome/Edge).
import { openDatabase, exportBytes, setReadonly, onChange } from './db.js';
import { evaluateLock, HEARTBEAT_MS } from './lock.js';

const DB_FILE = 'finanzas.sqlite';
const LOCK_FILE = 'finanzas.lock';
const BACKUP_DIR = 'backups';
const BACKUPS_KEPT = 30;

export const soportado = () => 'showDirectoryPicker' in window;

const sessionId = crypto.randomUUID();
let dir = null;
let lastModified = 0;
let saveTimer = null;
let heartbeat = null;
let backedUpToday = false;
let vigiaBloqueo = null;
const subs = new Set();

const VIGILANCIA_MS = 10_000;   // en solo lectura se revisa el bloqueo más seguido que el latido
export const state = { readonly: true, holder: null, saved: true, error: null, folder: '' };
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = (extra) => { Object.assign(state, extra); subs.forEach((fn) => fn(state)); };

export const userName = () => localStorage.getItem('finanzas.user') || '';
export const setUserName = (n) => localStorage.setItem('finanzas.user', n);

// --- Persistencia del handle de carpeta en IndexedDB -------------------------
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('finanzas-handles', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('h');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function idbOp(mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const req = fn(d.transaction('h', mode).objectStore('h'));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const saveHandle = (h) => idbOp('readwrite', (s) => s.put(h, 'dir'));
const loadHandle = () => idbOp('readonly', (s) => s.get('dir')).catch(() => null);

// --- Conexión ----------------------------------------------------------------
/** Handle recordado de una sesión anterior (requiere gesto del usuario para reactivar permisos). */
export const handleRecordado = loadHandle;

export async function elegirCarpeta() {
  const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'finanzas', startIn: 'documents' });
  await saveHandle(h);
  return conectar(h);
}

export async function reconectar(h) {
  if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new Error('Permiso denegado a la carpeta.');
  }
  return conectar(h);
}

async function conectar(h) {
  dir = h;
  emit({ folder: h.name, error: null });
  const lockInfo = await tomarBloqueo();
  setReadonly(!lockInfo.canEdit);
  const bytes = await leerDb();
  await openDatabase(bytes);
  if (!bytes && lockInfo.canEdit) await guardarAhora();   // crea el archivo en una base nueva
  emit({ readonly: !lockInfo.canEdit, holder: lockInfo.holder, saved: true });
  iniciarLatido();
  iniciarVigilancia();
  return state;
}

async function leerDb() {
  try {
    const f = await (await dir.getFileHandle(DB_FILE)).getFile();
    lastModified = f.lastModified;
    return new Uint8Array(await f.arrayBuffer());
  } catch (e) {
    if (e.name === 'NotFoundError') return null;
    throw e;
  }
}

// --- Bloqueo ------------------------------------------------------------------
async function leerBloqueo() {
  try {
    const f = await (await dir.getFileHandle(LOCK_FILE)).getFile();
    return JSON.parse(await f.text());
  } catch { return null; }
}
async function escribirBloqueo() {
  const fh = await dir.getFileHandle(LOCK_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify({ id: sessionId, user: userName() || 'Sin nombre', ts: Date.now() }));
  await w.close();
}
async function tomarBloqueo() {
  const r = evaluateLock(await leerBloqueo(), sessionId);
  if (r.canEdit) await escribirBloqueo();
  return r;
}
export async function liberarBloqueo() {
  if (!dir || state.readonly) return;
  try {
    const l = await leerBloqueo();
    if (l?.id === sessionId) await dir.removeEntry(LOCK_FILE);
  } catch { /* se liberará por caducidad */ }
}

/** Intenta pasar de solo lectura a edición (si el otro equipo ya cerró). */
export async function reintentar() {
  const r = evaluateLock(await leerBloqueo(), sessionId);
  if (!r.canEdit) { emit({ holder: r.holder }); return false; }
  await escribirBloqueo();
  const bytes = await leerDb();
  setReadonly(false);
  await openDatabase(bytes);
  emit({ readonly: false, holder: null, saved: true });
  return true;
}

function iniciarLatido() {
  clearInterval(heartbeat);
  heartbeat = setInterval(async () => {
    try {
      if (!state.readonly) {
        const l = await leerBloqueo();
        if (l && l.id !== sessionId && evaluateLock(l, sessionId).canEdit === false) {
          await guardarAhora();               // alguien más tomó el control: se guarda y pasa a lectura
          setReadonly(true);
          emit({ readonly: true, holder: l });
          return;
        }
        await escribirBloqueo();
      }
      await revisarCambioExterno();
    } catch (e) { emit({ error: e.message }); }
  }, HEARTBEAT_MS);
}

/** En solo lectura, revisa el bloqueo cada pocos segundos: refresca al dueño y pasa a edición sola cuando se libera. */
function iniciarVigilancia() {
  clearInterval(vigiaBloqueo);
  vigiaBloqueo = setInterval(async () => {
    if (!state.readonly || !dir) return;
    try { await reintentar(); } catch (e) { emit({ error: e.message }); }
  }, VIGILANCIA_MS);
}

async function revisarCambioExterno() {
  const f = await (await dir.getFileHandle(DB_FILE)).getFile();
  if (f.lastModified <= lastModified) return;
  if (state.readonly) {
    await openDatabase(new Uint8Array(await f.arrayBuffer()));
    lastModified = f.lastModified;
    emit({ saved: true, externalChange: false, tick: Date.now() });   // refresca la vista
  } else {
    emit({ externalChange: true });
  }
}

// --- Guardado ---------------------------------------------------------------
onChange(() => {
  if (state.readonly) return;
  emit({ saved: false });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => guardarAhora().catch((e) => emit({ error: e.message })), 600);
});

export async function guardarAhora() {
  if (!dir || state.readonly) return;
  clearTimeout(saveTimer);
  await respaldarSiCorresponde();
  const fh = await dir.getFileHandle(DB_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(exportBytes());
  await w.close();
  lastModified = (await fh.getFile()).lastModified;
  emit({ saved: true, error: null, externalChange: false });
}

/**
 * Guarda una copia de lo que hay AHORA en memoria en backups/finanzas-<etiqueta>-<fecha y hora>.sqlite.
 * No entra en la rotación de los 30 respaldos diarios, así que no se borra sola. Devuelve el nombre del archivo.
 */
export async function respaldarAhora(etiqueta) {
  if (!dir) throw new Error('No hay carpeta conectada.');
  const bdir = await dir.getDirectoryHandle(BACKUP_DIR, { create: true });
  const marca = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const nombre = `finanzas-${etiqueta}-${marca}.sqlite`;
  const w = await (await bdir.getFileHandle(nombre, { create: true })).createWritable();
  await w.write(exportBytes());
  await w.close();
  return nombre;
}

async function respaldarSiCorresponde() {
  if (backedUpToday) return;
  let origen;
  try { origen = await (await dir.getFileHandle(DB_FILE)).getFile(); } catch { return; }
  const hoy = new Date().toISOString().slice(0, 10);
  const bdir = await dir.getDirectoryHandle(BACKUP_DIR, { create: true });
  const nombre = `finanzas-${hoy}.sqlite`;
  try { await bdir.getFileHandle(nombre); } catch {
    const w = await (await bdir.getFileHandle(nombre, { create: true })).createWritable();
    await w.write(await origen.arrayBuffer());
    await w.close();
  }
  backedUpToday = true;
  const nombres = [];
  for await (const [n] of bdir.entries()) if (/^finanzas-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)) nombres.push(n);
  nombres.sort();
  for (const n of nombres.slice(0, Math.max(0, nombres.length - BACKUPS_KEPT))) await bdir.removeEntry(n);
}

window.addEventListener('pagehide', () => { liberarBloqueo(); });
