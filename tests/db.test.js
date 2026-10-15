import { describe, it, expect } from 'vitest';
import { openDatabase, run, get, exportBytes, setReadonly } from '../src/db.js';

describe('db', () => {
  it('crea el esquema y persiste en bytes', async () => {
    setReadonly(false);
    await openDatabase(null);
    run(`INSERT INTO conceptos (tipo, nombre) VALUES ('gasto_fijo','Arriendo')`);
    const bytes = exportBytes();
    await openDatabase(bytes);
    expect(get('SELECT nombre FROM conceptos').nombre).toBe('Arriendo');
    expect(get('PRAGMA user_version').user_version).toBe(1);
  });
  it('bloquea escrituras en solo lectura', async () => {
    await openDatabase(null);
    setReadonly(true);
    expect(() => run(`INSERT INTO personas (nombre) VALUES ('x')`)).toThrow(/solo lectura/);
    setReadonly(false);
  });
});
