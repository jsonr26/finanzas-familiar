import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { MIGRATIONS } from '../src/schema.js';
import { openDatabase, run, get, all, exportBytes, setReadonly } from '../src/db.js';

describe('db', () => {
  it('crea el esquema y persiste en bytes', async () => {
    setReadonly(false);
    await openDatabase(null);
    run(`INSERT INTO conceptos (tipo, nombre) VALUES ('gasto_fijo','Arriendo')`);
    const bytes = exportBytes();
    await openDatabase(bytes);
    expect(get('SELECT nombre FROM conceptos').nombre).toBe('Arriendo');
    expect(get('PRAGMA user_version').user_version).toBe(13);
  });
  it('bloquea escrituras en solo lectura', async () => {
    await openDatabase(null);
    setReadonly(true);
    expect(() => run(`INSERT INTO personas (nombre) VALUES ('x')`)).toThrow(/solo lectura/);
    setReadonly(false);
  });
  it('un archivo de versión anterior abierto en solo lectura se migra en memoria', async () => {
    const SQL = await initSqlJs();
    const viejo = new SQL.Database();
    MIGRATIONS.slice(0, 4).forEach((m, i) => { viejo.exec(m); viejo.exec(`PRAGMA user_version = ${i + 1}`); });
    setReadonly(true);
    await openDatabase(viejo.export());
    expect(get('PRAGMA user_version').user_version).toBe(MIGRATIONS.length);
    expect(() => run(`INSERT INTO personas (nombre) VALUES ('x')`)).toThrow(/solo lectura/);
    setReadonly(false);
  });

  it('v13: los vínculos compra→concepto de la v12 pasan a compras_cubre con el valor completo de la compra', async () => {
    const SQL = await initSqlJs();
    const viejo = new SQL.Database();
    viejo.run('PRAGMA foreign_keys = ON');
    MIGRATIONS.slice(0, 12).forEach((m, i) => { viejo.exec(m); viejo.exec(`PRAGMA user_version = ${i + 1}`); });
    viejo.run(`INSERT INTO conceptos (tipo, nombre) VALUES ('gasto_fijo', 'Internet'), ('gasto_fijo', 'Tarjeta Visa')`);
    viejo.run(`INSERT INTO tarjetas (nombre, concepto_id) VALUES ('Visa', 2)`);
    viejo.run(`INSERT INTO compras_tarjeta (tarjeta_id, fecha, descripcion, monto, num_cuotas, concepto_id) VALUES (1, '2026-10-03', 'Con vínculo', 90000, 1, 1), (1, '2026-10-04', 'Sin vínculo', 5000, 1, NULL)`);
    setReadonly(false);
    await openDatabase(viejo.export());
    expect(get('PRAGMA user_version').user_version).toBe(MIGRATIONS.length);
    expect(all('SELECT compra_id, concepto_id, monto FROM compras_cubre')).toEqual([{ compra_id: 1, concepto_id: 1, monto: 90000 }]);
  });
});
