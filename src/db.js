import initSqlJs from 'sql.js/dist/sql-asm.js';
import { MIGRATIONS } from './schema.js';

let SQL, db;
let readonly = false;
const listeners = new Set();

export async function openDatabase(bytes) {
  SQL ??= await initSqlJs();
  db?.close();
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  migrate(); // también en solo lectura: queda en memoria, nunca se guarda (guardarAhora no corre en ese modo)
}

function migrate() {
  const actual = db.exec('PRAGMA user_version')[0].values[0][0];
  if (actual > MIGRATIONS.length) {
    throw new Error('El archivo fue creado por una versión más nueva de la aplicación.');
  }
  for (let v = actual; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export const setReadonly = (v) => { readonly = v; };
export const isReadonly = () => readonly;
export const exportBytes = () => db.export();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}
export const get = (sql, params) => all(sql, params)[0] ?? null;

export function run(sql, params = []) {
  if (readonly) throw new Error('El archivo está en modo solo lectura.');
  db.run(sql, params);
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  listeners.forEach((fn) => fn());
  return id;
}

let enTransaccion = false;
/** Las transacciones se pueden anidar: la interna participa de la externa. */
export function transaction(fn) {
  if (readonly) throw new Error('El archivo está en modo solo lectura.');
  if (enTransaccion) return fn();
  enTransaccion = true;
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    enTransaccion = false;
    listeners.forEach((f) => f());
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    enTransaccion = false;
    throw e;
  }
}
