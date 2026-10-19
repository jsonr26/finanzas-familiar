// Consultas y comandos de dominio sobre la base de datos.
import { all, get, run, transaction } from './db.js';
import { inicioMes, inicioMesSig, claveMes, hoyISO, activoEnMes, mesAnterior, saldoInicial, montoPrevisto, proyectarMeses, calendarioCuotas, estimarRendimiento, repartir, vencimientoEnMes, proyectarPagosPrestamos } from './calc.js';

// --- Personas ------------------------------------------------------------------
export const personas = (soloActivas = true) =>
  all(`SELECT * FROM personas ${soloActivas ? 'WHERE activo = 1' : ''} ORDER BY nombre`);
export const crearPersona = (nombre) => run('INSERT INTO personas (nombre) VALUES (?)', [nombre]);
export const personaPorNombre = (nombre) => get('SELECT * FROM personas WHERE nombre = ?', [nombre]);

// --- Conceptos -----------------------------------------------------------------
export const TIPOS = {
  ingreso: 'Ingreso', descuento: 'Descuento', gasto_fijo: 'Gasto fijo', gasto_variable: 'Gasto variable',
};

export function conceptos({ tipo, soloActivos = false } = {}) {
  const w = [], p = [];
  if (tipo) { w.push('c.tipo = ?'); p.push(tipo); }
  if (soloActivos) w.push('c.activo = 1');
  return all(`SELECT c.*, p.nombre AS responsable, ca.nombre AS caja FROM conceptos c LEFT JOIN personas p ON p.id = c.responsable_id
    LEFT JOIN cajas_ahorro ca ON ca.id = c.caja_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY c.tipo, c.grupo, c.nombre`, p);
}

export const PERIODICIDADES = { mensual: 'Mensual', anual: 'Anual', manual: 'Manual (fecha puntual)' };

export const grupos = () => all('SELECT nombre FROM grupos ORDER BY nombre').map((g) => g.nombre);
export const crearGrupo = (nombre) => run('INSERT OR IGNORE INTO grupos (nombre) VALUES (?)', [nombre.trim()]);

export function guardarConcepto(c) {
  const grupo = c.grupo?.trim() || null;
  const fecha = c.fecha_pago || null;
  const notas = c.notas?.trim() || null;
  const inactivo = c.activo === false;
  const baja = inactivo ? c.fecha_baja || hoyISO() : null;
  if (baja && baja.slice(0, 7) > hoyISO().slice(0, 7)) throw new Error('«Inactivo desde» no puede ser de un mes futuro.');
  const caja = c.caja_id ? Number(c.caja_id) : null;
  const categoria = caja ? 'Ahorro' : c.categoria || 'Gasto'; // un concepto que abona a una caja es siempre ahorro
  const cada = (c.periodicidad || 'mensual') === 'mensual' ? Math.round(Number(c.cada_meses) || 1) : 1;
  if (!(cada >= 1 && cada <= 12)) throw new Error('La frecuencia debe ser entre 1 y 12 meses.');
  const quincenal = (c.periodicidad || 'mensual') === 'mensual' && c.quincenal ? 1 : 0;
  if (quincenal && cada > 1) throw new Error('Quincenal no se combina con «cada N meses».');
  if (cada > 1 && !fecha) throw new Error('Indica la fecha de pago: su mes marca en qué meses toca pagar.');
  const vals = [c.tipo, c.nombre.trim(), grupo, categoria, fecha ? Number(fecha.slice(8, 10)) : null,
    c.responsable_id || null, c.presupuestado ? 1 : 0, fecha, c.periodicidad || 'mensual', Number(c.monto_estimado) || 0, cada, caja, notas, quincenal];
  return transaction(() => {
    if (grupo) run('INSERT OR IGNORE INTO grupos (nombre) VALUES (?)', [grupo]);
    if (c.id) {
      run(`UPDATE conceptos SET tipo=?, nombre=?, grupo=?, categoria=?, dia_pago=?, responsable_id=?, presupuestado=?, fecha_pago=?, periodicidad=?, monto_estimado=?, cada_meses=?, caja_id=?, notas=?, quincenal=? WHERE id=?`, [...vals, c.id]);
      // el estado solo cambia si el formulario lo envía (activo explícito)
      if (c.activo !== undefined) run('UPDATE conceptos SET activo=?, fecha_baja=? WHERE id=?', [inactivo ? 0 : 1, baja, c.id]);
      return c.id;
    }
    return run(`INSERT INTO conceptos (tipo, nombre, grupo, categoria, dia_pago, responsable_id, presupuestado, fecha_pago, periodicidad, monto_estimado, cada_meses, caja_id, notas, quincenal) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, vals);
  });
}

/** Lo que aún se debe por cuotas de tarjeta o autopréstamo ligadas a un concepto (para avisar antes de darlo de baja). */
export const deudaPendienteConcepto = (id) => get(
  `SELECT COALESCE((SELECT SUM(q.valor) FROM tarjetas t JOIN compras_tarjeta ct ON ct.tarjeta_id = t.id JOIN cuotas_tarjeta q ON q.compra_id = ct.id
                     WHERE t.concepto_id = ? AND q.movimiento_id IS NULL), 0)
        + COALESCE((SELECT SUM(q.valor) FROM autoprestamos a JOIN cuotas q ON q.prestamo_id = a.id
                     WHERE a.concepto_id = ? AND q.movimiento_id IS NULL), 0) AS total`, [id, id]).total;

/** Dar de baja no borra: conserva el historial y deja de ofrecerse en formularios. */
export const darDeBaja = (id, desde = hoyISO()) => run(`UPDATE conceptos SET activo=0, fecha_baja=? WHERE id=?`, [desde, id]);
export const reactivar = (id) => run(`UPDATE conceptos SET activo=1, fecha_baja=NULL WHERE id=?`, [id]);
export const usosConcepto = (id) =>
  get(`SELECT (SELECT COUNT(*) FROM movimientos WHERE concepto_id=?)
            + (SELECT COUNT(*) FROM ingresos WHERE concepto_id=?)
            + (SELECT COUNT(*) FROM presupuesto WHERE concepto_id=?)
            + (SELECT COUNT(*) FROM tarjetas WHERE concepto_id=?)
            + (SELECT COUNT(*) FROM autoprestamos WHERE concepto_id=?)
            + (SELECT COUNT(*) FROM compras_cubre WHERE concepto_id=?) AS n`, [id, id, id, id, id, id]).n;
export const eliminarConcepto = (id) => {
  if (usosConcepto(id) > 0) throw new Error('El concepto tiene historial; dalo de baja en lugar de eliminarlo.');
  run('DELETE FROM conceptos WHERE id=?', [id]);
};

// --- Ingresos ------------------------------------------------------------------
export const ingresosMes = (anio, mes) => all(
  `SELECT i.*, c.nombre AS concepto, p.nombre AS persona, cu.nombre AS cuenta FROM ingresos i
     JOIN conceptos c ON c.id = i.concepto_id LEFT JOIN personas p ON p.id = i.persona_id
     LEFT JOIN cuentas cu ON cu.id = i.cuenta_id
    WHERE anio=? AND mes=? ORDER BY i.quincena, p.nombre, i.clase = 'descuento', c.nombre`, [anio, mes]);

export function guardarIngreso(x) {
  const v = [x.anio, x.mes, x.quincena, x.persona_id || null, x.concepto_id, x.clase, x.monto, x.nota || null, x.cuenta_id || null];
  if (x.id) {
    run(`UPDATE ingresos SET anio=?, mes=?, quincena=?, persona_id=?, concepto_id=?, clase=?, monto=?, nota=?, cuenta_id=? WHERE id=?`, [...v, x.id]);
    return x.id;
  }
  return run(`INSERT INTO ingresos (anio, mes, quincena, persona_id, concepto_id, clase, monto, nota, cuenta_id, creado_en) VALUES (?,?,?,?,?,?,?,?,?,?)`, [...v, ahoraISO()]);
}
/** Momento actual en ISO (UTC): se guarda en `creado_en` al anotar un movimiento o un ingreso. */
const ahoraISO = () => new Date().toISOString();

export const eliminarIngreso = (id) => run('DELETE FROM ingresos WHERE id=?', [id]);

/** Copia las líneas del mes anterior (solo de conceptos activos) a un mes que aún no tiene ingresos. */
export function copiarIngresos(anio, mes) {
  if (ingresosMes(anio, mes).length) throw new Error('Este mes ya tiene ingresos registrados.');
  const ant = mesAnterior(anio, mes);
  run(`INSERT INTO ingresos (anio, mes, persona_id, concepto_id, clase, monto, nota, quincena, cuenta_id, creado_en)
       SELECT ?, ?, i.persona_id, i.concepto_id, i.clase, i.monto, i.nota, i.quincena, i.cuenta_id, ?
         FROM ingresos i JOIN conceptos c ON c.id = i.concepto_id
        WHERE i.anio = ? AND i.mes = ? AND c.activo = 1`, [anio, mes, ahoraISO(), ant.anio, ant.mes]);
  const n = get('SELECT changes() AS n').n;
  if (!n) throw new Error('El mes anterior no tiene ingresos para copiar.');
  return n;
}

/**
 * El último movimiento o ingreso anotado (por `creado_en`; los viejos sin hora cuentan como anteriores a los nuevos y entre
 * sí se ordenan por id). Devuelve { tipo: 'movimiento'|'ingreso', id, anio, mes, fecha, concepto, monto, cuenta, clase, creado_en } o null.
 */
export function ultimoRegistro() {
  const mov = get(`SELECT m.id, m.fecha, c.nombre AS concepto, m.monto, cu.nombre AS cuenta, m.creado_en FROM movimientos m
      JOIN conceptos c ON c.id = m.concepto_id LEFT JOIN cuentas cu ON cu.id = m.cuenta_id
     ORDER BY COALESCE(m.creado_en, '') DESC, m.id DESC LIMIT 1`);
  const ing = get(`SELECT i.id, i.anio, i.mes, i.clase, c.nombre AS concepto, i.monto, cu.nombre AS cuenta, i.creado_en FROM ingresos i
      JOIN conceptos c ON c.id = i.concepto_id LEFT JOIN cuentas cu ON cu.id = i.cuenta_id
     ORDER BY COALESCE(i.creado_en, '') DESC, i.id DESC LIMIT 1`);
  const m = mov ? { tipo: 'movimiento', ...mov, anio: Number(mov.fecha.slice(0, 4)), mes: Number(mov.fecha.slice(5, 7)) } : null;
  const i = ing ? { tipo: 'ingreso', ...ing, fecha: null } : null;
  if (!m || !i) return m ?? i;
  return (i.creado_en ?? '') > (m.creado_en ?? '') ? i : m;
}

/** Saldo con el que arranca el mes: el escrito a mano o, si no hay, el que arrastran los meses previos. */
function mapasHistoricos() {
  const neto = {}, gasto = {}, manual = {};
  for (const r of all('SELECT anio, mes, clase, SUM(monto) AS t FROM ingresos GROUP BY anio, mes, clase')) {
    const k = claveMes(r.anio, r.mes);
    neto[k] = (neto[k] ?? 0) + (r.clase === 'descuento' ? -r.t : r.t);
  }
  for (const r of all('SELECT substr(fecha, 1, 7) AS k, SUM(monto) AS t FROM movimientos GROUP BY k')) gasto[r.k] = r.t;
  for (const r of all('SELECT anio, mes, saldo_anterior AS s FROM saldos_mes')) manual[claveMes(r.anio, r.mes)] = r.s;
  return { neto, gasto, manual, base: saldoBaseCuentas() };
}
/**
 * Suma de los saldos iniciales de las cuentas que cuenta la vista Cuentas (activas o con movimientos): es con lo
 * que arranca la cadena de saldos de Mes, Inicio, Resumen anual y la proyección.
 */
export const saldoBaseCuentas = () => get(
  `SELECT COALESCE(SUM(saldo_inicial), 0) AS t FROM cuentas c
    WHERE activo = 1 OR EXISTS (SELECT 1 FROM ingresos WHERE cuenta_id = c.id) OR EXISTS (SELECT 1 FROM movimientos WHERE cuenta_id = c.id)`).t;
export const saldoAnteriorInfo = (anio, mes) => saldoInicial(mapasHistoricos(), anio, mes);
export const saldoAnterior = (anio, mes) => saldoAnteriorInfo(anio, mes).valor;
export const guardarSaldoAnterior = (anio, mes, s) =>
  run(`INSERT INTO saldos_mes (anio, mes, saldo_anterior) VALUES (?,?,?)
       ON CONFLICT(anio, mes) DO UPDATE SET saldo_anterior = excluded.saldo_anterior`, [anio, mes, s]);
/** Vuelve al saldo automático (el que arrastran los meses previos). */
export const quitarSaldoAnterior = (anio, mes) => run('DELETE FROM saldos_mes WHERE anio=? AND mes=?', [anio, mes]);

// --- Movimientos ---------------------------------------------------------------
export const movimientosMes = (anio, mes) => all(
  `SELECT m.*, c.nombre AS concepto, c.grupo, c.categoria, p.nombre AS persona, cu.nombre AS cuenta FROM movimientos m
     JOIN conceptos c ON c.id = m.concepto_id LEFT JOIN personas p ON p.id = m.persona_id
     LEFT JOIN cuentas cu ON cu.id = m.cuenta_id
    WHERE m.fecha >= ? AND m.fecha < ? ORDER BY m.fecha DESC, m.id DESC`, [inicioMes(anio, mes), inicioMesSig(anio, mes)]);

export function guardarMovimiento(x) {
  const v = [x.fecha, x.concepto_id, x.persona_id || null, x.monto, x.nota || null, x.cuenta_id || null];
  return transaction(() => {
    let id = x.id;
    if (id) run(`UPDATE movimientos SET fecha=?, concepto_id=?, persona_id=?, monto=?, nota=?, cuenta_id=? WHERE id=?`, [...v, id]);
    else id = run(`INSERT INTO movimientos (fecha, concepto_id, persona_id, monto, nota, cuenta_id, creado_en) VALUES (?,?,?,?,?,?,?)`, [...v, ahoraISO()]);
    sincronizarCajaDelMovimiento(id, x);
    return id;
  });
}

/**
 * Si el concepto abona a una caja de ahorro, mantiene el aporte de la caja ligado a este movimiento (se crea, se
 * actualiza o se mueve de caja al editar, y se borra si el concepto ya no tiene caja). Un monto negativo es un retiro.
 */
function sincronizarCajaDelMovimiento(id, x) {
  const c = get('SELECT caja_id, nombre FROM conceptos WHERE id=?', [x.concepto_id]);
  const previo = get('SELECT id FROM cajas_movs WHERE movimiento_id=?', [id]);
  if (!c?.caja_id) { if (previo) run('DELETE FROM cajas_movs WHERE id=?', [previo.id]); return; }
  const datos = [c.caja_id, x.fecha, x.monto < 0 ? 'retiro' : 'aporte', Math.abs(x.monto), `Pago de «${c.nombre}»`];
  if (previo) run('UPDATE cajas_movs SET caja_id=?, fecha=?, tipo=?, monto=?, nota=? WHERE id=?', [...datos, previo.id]);
  else run('INSERT INTO cajas_movs (caja_id, fecha, tipo, monto, nota, movimiento_id) VALUES (?,?,?,?,?,?)', [...datos, id]);
}

/**
 * Quita un movimiento. Si pagaba cuotas de un autopréstamo, también se quitan los aportes que esas cuotas
 * hicieron a las cajas y el préstamo vuelve a quedar activo (las cuotas de tarjeta se reabren solas por la FK).
 */
export function eliminarMovimiento(id) {
  transaction(() => {
    const prestamos = all('SELECT DISTINCT prestamo_id FROM cuotas WHERE movimiento_id=?', [id]);
    run('DELETE FROM cajas_movs WHERE cuota_id IN (SELECT id FROM cuotas WHERE movimiento_id=?) OR movimiento_id=?', [id, id]);
    run('DELETE FROM movimientos WHERE id=?', [id]);
    for (const { prestamo_id: p } of prestamos) {
      run(`UPDATE autoprestamos SET estado='activo' WHERE id=? AND estado='pagado'`, [p]);
      const a = get('SELECT concepto_id FROM autoprestamos WHERE id=?', [p]);
      if (a?.concepto_id) reactivar(a.concepto_id);
    }
  });
}

export const ejecutadoPorConcepto = (anio, mes) => all(
  `SELECT c.id, c.nombre, c.grupo, c.categoria, SUM(m.monto) AS total FROM movimientos m
     JOIN conceptos c ON c.id = m.concepto_id
    WHERE m.fecha >= ? AND m.fecha < ? GROUP BY c.id ORDER BY c.grupo, c.nombre`, [inicioMes(anio, mes), inicioMesSig(anio, mes)]);

// --- Presupuesto ---------------------------------------------------------------------
/**
 * Todos los conceptos de gasto con lo previsto y lo ejecutado del mes. Previsto = ajuste del mes
 * (tabla presupuesto) o, si no hay, el monto base del concepto cuando aplica ese mes. n_mov cuenta
 * los movimientos del mes (sirve para saber si un pago ya se hizo).
 */
export function gastosMes(anio, mes) {
  return all(
    `SELECT c.id, c.nombre, c.grupo, c.categoria, c.tipo, c.activo, c.fecha_baja, c.presupuestado, c.monto_estimado,
            c.periodicidad, c.cada_meses, c.quincenal, c.fecha_pago, p.nombre AS responsable, pr.monto AS ajuste,
            (SELECT SUM(v) FROM (
               SELECT q.valor AS v FROM tarjetas t JOIN compras_tarjeta ct ON ct.tarjeta_id = t.id
                 JOIN cuotas_tarjeta q ON q.compra_id = ct.id
                WHERE t.concepto_id = c.id AND q.anio = ? AND q.mes = ?
               UNION ALL
               SELECT q.valor FROM autoprestamos a JOIN cuotas q ON q.prestamo_id = a.id
                WHERE a.concepto_id = c.id AND substr(q.vencimiento, 1, 7) = ?)) AS cuotas_mes,
            (SELECT SUM(q.valor * cc.monto / ct.monto) FROM compras_cubre cc JOIN compras_tarjeta ct ON ct.id = cc.compra_id
               JOIN cuotas_tarjeta q ON q.compra_id = ct.id
              WHERE cc.concepto_id = c.id AND q.anio = ? AND q.mes = ?) AS cubierto_tarjeta,
            COALESCE(e.total, 0) AS ejecutado, COALESCE(e.n, 0) AS n_mov
       FROM conceptos c
       LEFT JOIN personas p ON p.id = c.responsable_id
       LEFT JOIN (SELECT concepto_id, SUM(monto) AS total, COUNT(*) AS n FROM movimientos
                   WHERE fecha >= ? AND fecha < ? GROUP BY concepto_id) e ON e.concepto_id = c.id
       LEFT JOIN presupuesto pr ON pr.concepto_id = c.id AND pr.anio = ? AND pr.mes = ?
      WHERE c.tipo IN ('gasto_fijo', 'gasto_variable')
      ORDER BY c.grupo, c.nombre`,
    [anio, mes, claveMes(anio, mes), anio, mes, inicioMes(anio, mes), inicioMesSig(anio, mes), anio, mes],
  ).map((f) => ({ ...f, cubierto: f.cubierto_tarjeta || 0, previsto: montoPrevisto(f, anio, mes) }));
}

/**
 * Igual que gastosMes pero para conceptos de ingreso y descuento; lo ejecutado sale de las líneas
 * de ingresos del mes (tabla ingresos), no de los movimientos.
 */
export function ingresosPresupuestoMes(anio, mes) {
  return all(
    `SELECT c.id, c.nombre, c.grupo, c.categoria, c.tipo, c.activo, c.fecha_baja, c.presupuestado, c.monto_estimado,
            c.periodicidad, c.cada_meses, c.quincenal, c.fecha_pago, pr.monto AS ajuste,
            COALESCE(e.total, 0) AS ejecutado, COALESCE(e.n, 0) AS n_mov
       FROM conceptos c
       LEFT JOIN (SELECT concepto_id, SUM(monto) AS total, COUNT(*) AS n FROM ingresos
                   WHERE anio = ? AND mes = ? GROUP BY concepto_id) e ON e.concepto_id = c.id
       LEFT JOIN presupuesto pr ON pr.concepto_id = c.id AND pr.anio = ? AND pr.mes = ?
      WHERE c.tipo IN ('ingreso', 'descuento')
      ORDER BY c.tipo, c.nombre`,
    [anio, mes, anio, mes],
  ).map((f) => ({ ...f, previsto: montoPrevisto(f, anio, mes) }));
}
// Filas con algo que mostrar: previsto, gastado o un ajuste que siga vigente (un concepto de baja ignora sus ajustes).
const conAlgo = (anio, mes) => (f) => f.previsto || f.ejecutado || f.cubierto || (f.ajuste !== null && activoEnMes(f, anio, mes));
export const presupuestoIngresosMes = (anio, mes) => ingresosPresupuestoMes(anio, mes).filter(conAlgo(anio, mes));

/** Filas con algo que mostrar en el presupuesto del mes: previsto, ajustado o ejecutado. */
export const presupuestoMes = (anio, mes) => gastosMes(anio, mes).filter(conAlgo(anio, mes));

export function resumenPresupuesto(anio, mes) {
  const filas = presupuestoMes(anio, mes).filter((f) => f.categoria !== 'Ahorro');
  return { previsto: filas.reduce((s, f) => s + f.previsto, 0), ejecutado: filas.reduce((s, f) => s + f.ejecutado, 0) };
}

/** Ajusta el monto de un concepto en un mes concreto; null borra el ajuste y vuelve al monto base. */
export const guardarAjuste = (anio, mes, conceptoId, monto) => (monto === null
  ? run('DELETE FROM presupuesto WHERE anio=? AND mes=? AND concepto_id=?', [anio, mes, conceptoId])
  : run(`INSERT INTO presupuesto (anio, mes, concepto_id, monto) VALUES (?,?,?,?)
         ON CONFLICT(anio, mes, concepto_id) DO UPDATE SET monto = excluded.monto`, [anio, mes, conceptoId, monto]));

/** Copia los ajustes del mes anterior a los conceptos que aún no tienen ajuste en este mes. */
export function copiarAjustes(anio, mes) {
  const ant = mesAnterior(anio, mes);
  run(`INSERT OR IGNORE INTO presupuesto (anio, mes, concepto_id, monto)
       SELECT ?, ?, concepto_id, monto FROM presupuesto WHERE anio = ? AND mes = ?`, [anio, mes, ant.anio, ant.mes]);
  return get('SELECT changes() AS n').n;
}

/**
 * Proyección de saldo para n meses desde (anio, mes). Gastos y ahorro: lo presupuestado de cada mes
 * (en el mes inicial, o si el mes ya tiene registros, lo mayor entre presupuestado y ejecutado por concepto).
 * Ingresos (neto de descuentos): los presupuestados si el mes tiene alguno; si no, los registrados
 * o, sin registros, el neto del último mes que sí tenga. `origen`: presupuesto | real | repetido.
 */
export function proyeccion(anio, mes, n = 6) {
  const { neto } = mapasHistoricos();
  let ultimo = 0, a = anio, m = mes;
  const previas = Object.keys(neto).filter((k) => k <= claveMes(anio, mes)).sort();
  if (previas.length) ultimo = neto[previas.at(-1)];
  const meses = [];
  for (let i = 0; i < n; i++) {
    const k = claveMes(a, m);
    const real = neto[k] !== undefined;
    if (real) ultimo = neto[k];
    const valor = (f) => (i === 0 || f.n_mov ? Math.max(f.previsto, f.ejecutado) : f.previsto);
    let gastos = 0, ahorro = 0;
    for (const f of gastosMes(a, m)) {
      if (f.categoria === 'Ahorro') ahorro += valor(f); else gastos += valor(f);
    }
    const lineas = ingresosPresupuestoMes(a, m);
    const hayPresupuesto = lineas.some((f) => f.previsto);
    const ingresos = hayPresupuesto ? lineas.reduce((t, f) => t + (f.tipo === 'descuento' ? -valor(f) : valor(f)), 0) : ultimo;
    meses.push({ anio: a, mes: m, ingresos, origen: hayPresupuesto ? 'presupuesto' : real ? 'real' : 'repetido', gastos, ahorro });
    ({ anio: a, mes: m } = m === 12 ? { anio: a + 1, mes: 1 } : { anio: a, mes: m + 1 });
  }
  return proyectarMeses(saldoAnteriorInfo(anio, mes).valor, meses);
}

// --- Cuentas bancarias -----------------------------------------------------------------
export const cuentas = (soloActivas = true) =>
  all(`SELECT c.*, p.nombre AS persona FROM cuentas c LEFT JOIN personas p ON p.id = c.persona_id
       ${soloActivas ? 'WHERE c.activo = 1' : ''} ORDER BY c.nombre`);

export function guardarCuenta(c) {
  const v = [c.nombre.trim(), c.persona_id || null, Number(c.saldo_inicial) || 0, c.activo === false ? 0 : 1];
  if (c.id) {
    run('UPDATE cuentas SET nombre=?, persona_id=?, saldo_inicial=?, activo=? WHERE id=?', [...v, c.id]);
    return c.id;
  }
  return run('INSERT INTO cuentas (nombre, persona_id, saldo_inicial, activo) VALUES (?,?,?,?)', v);
}

/** Saldo real del banco al cierre de un mes; null borra la anotación. */
export const guardarSaldoReal = (cuentaId, anio, mes, saldo) => (saldo === null
  ? run('DELETE FROM cuentas_saldos WHERE cuenta_id=? AND anio=? AND mes=?', [cuentaId, anio, mes])
  : run(`INSERT INTO cuentas_saldos (cuenta_id, anio, mes, saldo) VALUES (?,?,?,?)
         ON CONFLICT(cuenta_id, anio, mes) DO UPDATE SET saldo = excluded.saldo`, [cuentaId, anio, mes, saldo]));

/** Asigna a la cuenta los ingresos y movimientos de su persona que aún no tienen cuenta. */
export function asignarCuentaPorPersona(cuentaId) {
  const c = get('SELECT persona_id FROM cuentas WHERE id=?', [cuentaId]);
  if (!c?.persona_id) throw new Error('La cuenta no tiene una persona asociada.');
  return transaction(() => {
    run('UPDATE ingresos SET cuenta_id=? WHERE cuenta_id IS NULL AND persona_id=?', [cuentaId, c.persona_id]);
    const ing = get('SELECT changes() AS n').n;
    run('UPDATE movimientos SET cuenta_id=? WHERE cuenta_id IS NULL AND persona_id=?', [cuentaId, c.persona_id]);
    return ing + get('SELECT changes() AS n').n;
  });
}

/**
 * Saldo de cada cuenta al cierre de (anio, mes): saldo inicial + ingresos netos − movimientos,
 * acumulados hasta ese mes, junto al saldo real anotado y la diferencia. `sinCuenta` agrupa lo que
 * todavía no tiene cuenta, para que el total siga cuadrando con ingresos − gastos.
 */
export function saldosCuentas(anio, mes) {
  const ing = new Map(all(`SELECT cuenta_id, SUM(CASE WHEN clase = 'descuento' THEN -monto ELSE monto END) AS t
                             FROM ingresos WHERE anio * 100 + mes <= ? GROUP BY cuenta_id`, [anio * 100 + mes]).map((r) => [r.cuenta_id, r.t]));
  const gas = new Map(all('SELECT cuenta_id, SUM(monto) AS t FROM movimientos WHERE fecha < ? GROUP BY cuenta_id', [inicioMesSig(anio, mes)]).map((r) => [r.cuenta_id, r.t]));
  const reales = new Map(all('SELECT cuenta_id, saldo FROM cuentas_saldos WHERE anio=? AND mes=?', [anio, mes]).map((r) => [r.cuenta_id, r.saldo]));
  const filas = cuentas(false).filter((c) => c.activo || ing.has(c.id) || gas.has(c.id)).map((c) => {
    const ingresos = ing.get(c.id) ?? 0, gastos = gas.get(c.id) ?? 0;
    const calculado = c.saldo_inicial + ingresos - gastos;
    const real = reales.get(c.id) ?? null;
    return { ...c, ingresos, gastos, calculado, real, diferencia: real === null ? null : real - calculado };
  });
  const sinCuenta = { ingresos: ing.get(null) ?? 0, gastos: gas.get(null) ?? 0 };
  const total = filas.reduce((s, f) => s + f.calculado, 0) + sinCuenta.ingresos - sinCuenta.gastos;
  return { cuentas: filas, sinCuenta, total };
}

// --- Tarjetas de crédito -----------------------------------------------------------------
/** Crea la tarjeta y su concepto de gasto «Tarjeta X» (grupo Deudas), que recibe los pagos. */
export const COLORES_TARJETA = ['verde', 'morado', 'azul', 'coral', 'rosa', 'gris', 'ambar'];   // también los de las cajas de ahorro
/** Valida y normaliza los datos opcionales que se dibujan en la tarjeta: últimos 4 dígitos, cupo y color. */
function datosTarjeta({ ultimos4, cupo, color }) {
  const d = String(ultimos4 ?? '').trim();
  if (d && !/^\d{4}$/.test(d)) throw new Error('Los últimos dígitos deben ser exactamente 4 números.');
  const c = cupo === '' || cupo === null || cupo === undefined ? null : Number(cupo);
  if (c !== null && !(Number.isFinite(c) && c >= 0)) throw new Error('El cupo debe ser un número de 0 o más.');
  if (color && !COLORES_TARJETA.includes(color)) throw new Error('Color de tarjeta no válido.');
  return [d || null, c || null, color || null];
}

export function crearTarjeta({ nombre, cuenta_id, fecha_pago, ultimos4, cupo, color }) {
  const n = nombre.trim();
  const extra = datosTarjeta({ ultimos4, cupo, color });
  return transaction(() => {
    const concepto = guardarConcepto({ tipo: 'gasto_fijo', nombre: `Tarjeta ${n}`, grupo: 'Deudas', presupuestado: true, fecha_pago: fecha_pago || null, periodicidad: 'mensual' });
    return run('INSERT INTO tarjetas (nombre, concepto_id, cuenta_id, ultimos4, cupo, color) VALUES (?,?,?,?,?,?)', [n, concepto, cuenta_id || null, ...extra]);
  });
}
/** Cambia nombre, cuenta de pago sugerida y fecha de pago; el concepto «Tarjeta X» se renombra con ella. */
export function actualizarTarjeta({ id, nombre, cuenta_id, fecha_pago, ultimos4, cupo, color }) {
  const t = get('SELECT * FROM tarjetas WHERE id=?', [id]);
  if (!t) throw new Error('Tarjeta no encontrada.');
  const n = nombre.trim();
  const extra = datosTarjeta({ ultimos4, cupo, color });
  transaction(() => {
    run('UPDATE tarjetas SET nombre=?, cuenta_id=?, ultimos4=?, cupo=?, color=? WHERE id=?', [n, cuenta_id || null, ...extra, id]);
    const fecha = fecha_pago || null;
    run('UPDATE conceptos SET nombre=?, fecha_pago=?, dia_pago=? WHERE id=?',
      [`Tarjeta ${n}`, fecha, fecha ? Number(fecha.slice(8, 10)) : null, t.concepto_id]);
  });
}

export const tarjetas = () => all(
  `SELECT t.*, (SELECT fecha_pago FROM conceptos WHERE id = t.concepto_id) AS fecha_pago,
          (SELECT nombre FROM cuentas WHERE id = t.cuenta_id) AS cuenta,
          COALESCE(SUM(CASE WHEN q.id IS NOT NULL AND q.movimiento_id IS NULL THEN q.valor END), 0) AS pendiente
     FROM tarjetas t LEFT JOIN compras_tarjeta ct ON ct.tarjeta_id = t.id LEFT JOIN cuotas_tarjeta q ON q.compra_id = ct.id
    WHERE t.activo = 1 GROUP BY t.id ORDER BY t.nombre`);

/** Tarjeta activa cuyo concepto «Tarjeta X» es este (null si el concepto no es de una tarjeta). */
export const tarjetaDeConcepto = (conceptoId) => get('SELECT * FROM tarjetas WHERE concepto_id = ? AND activo = 1', [conceptoId]) ?? null;

/** Cuotas aún sin pagar de una tarjeta, de la más antigua a la más reciente. */
export const cuotasPendientes = (tarjetaId) => all(
  `SELECT q.*, ct.descripcion, ct.fecha AS fecha_compra, ct.num_cuotas FROM cuotas_tarjeta q
     JOIN compras_tarjeta ct ON ct.id = q.compra_id
    WHERE ct.tarjeta_id = ? AND q.movimiento_id IS NULL ORDER BY q.anio, q.mes, ct.fecha, ct.id, q.numero`, [tarjetaId]);

export const cuotasPagadas = (tarjetaId, limite = 50) => all(
  `SELECT q.*, ct.descripcion, ct.num_cuotas, m.fecha AS fecha_pago FROM cuotas_tarjeta q
     JOIN compras_tarjeta ct ON ct.id = q.compra_id JOIN movimientos m ON m.id = q.movimiento_id
    WHERE ct.tarjeta_id = ? ORDER BY m.fecha DESC, q.id DESC LIMIT ?`, [tarjetaId, limite]);

export function comprasTarjeta(tarjetaId) {
  const compras = all(
  `SELECT ct.*, COUNT(q.id) AS n, COALESCE(SUM(q.movimiento_id IS NOT NULL), 0) AS pagadas, SUM(q.valor) AS total,
          COALESCE(SUM(CASE WHEN q.movimiento_id IS NOT NULL THEN q.capital END), 0) AS capital_pagado,
          MIN(CASE WHEN q.movimiento_id IS NULL THEN q.anio * 100 + q.mes END) AS proxima, MAX(q.anio * 100 + q.mes) AS ultima
     FROM compras_tarjeta ct LEFT JOIN cuotas_tarjeta q ON q.compra_id = ct.id
    WHERE ct.tarjeta_id = ? GROUP BY ct.id ORDER BY ct.fecha DESC, ct.id DESC`, [tarjetaId]);
  const cubre = all(`SELECT cc.compra_id, cc.concepto_id, cc.monto, co.nombre FROM compras_cubre cc JOIN conceptos co ON co.id = cc.concepto_id
                      WHERE cc.compra_id IN (SELECT id FROM compras_tarjeta WHERE tarjeta_id = ?) ORDER BY co.nombre`, [tarjetaId]);
  return compras.map((c) => ({ ...c, cubre: cubre.filter((x) => x.compra_id === c.id) }));
}

/**
 * Conceptos de gasto que una compra con tarjeta puede «cubrir»: no los quincenales (no se sabría cuál de sus dos
 * pagos cubre) ni los de tarjetas o autopréstamos (ya son deuda con cuotas propias).
 */
export const conceptosCubribles = () => conceptos({ soloActivos: true }).filter((c) => c.tipo.startsWith('gasto') && !c.quincenal
  && !get('SELECT 1 AS x FROM tarjetas WHERE concepto_id=? UNION SELECT 1 FROM autoprestamos WHERE concepto_id=?', [c.id, c.id]));

/**
 * Valida y normaliza los conceptos que cubre una compra: [{concepto_id, monto}]. Cada concepto debe poder cubrirse
 * (o ya estar cubierto por esta compra, para no perder el vínculo si luego se inactivó), sin repetirse, con monto > 0,
 * y la suma no puede pasar del valor de la compra.
 */
function validarCubre(cubre, montoCompra, yaCubiertos = []) {
  const lista = (cubre ?? []).map((x) => ({ concepto_id: Number(x.concepto_id), monto: Number(x.monto) }));
  const permitidos = new Set([...conceptosCubribles().map((c) => c.id), ...yaCubiertos]);
  if (new Set(lista.map((x) => x.concepto_id)).size !== lista.length) throw new Error('Un concepto no puede aparecer dos veces en la misma compra.');
  for (const x of lista) {
    if (!permitidos.has(x.concepto_id)) throw new Error('Ese concepto no se puede cubrir con una compra de tarjeta (debe ser un gasto activo, no quincenal ni de tarjeta o préstamo).');
    if (!(x.monto > 0)) throw new Error('Indica el monto de la compra que cubre cada concepto (mayor que cero).');
  }
  const suma = lista.reduce((t, x) => t + x.monto, 0);
  if (suma > montoCompra + 0.005) throw new Error(`Los montos asignados (${Math.round(suma).toLocaleString('es-CO')}) superan el valor de la compra (${Math.round(montoCompra).toLocaleString('es-CO')}).`);
  return lista;
}
const guardarCubre = (compraId, lista) => {
  run('DELETE FROM compras_cubre WHERE compra_id=?', [compraId]);
  for (const x of lista) run('INSERT INTO compras_cubre (compra_id, concepto_id, monto) VALUES (?,?,?)', [compraId, x.concepto_id, x.monto]);
};

/** Registra una compra y genera sus cuotas; `primera` (AAAA-MM-DD) fija el mes de la primera cuota. */
export function guardarCompra({ tarjeta_id, fecha, descripcion, monto, num_cuotas, tasa_mensual = 0, primera, cubre = [] }) {
  if (!(monto > 0)) throw new Error('El monto debe ser mayor que cero.');
  const n = Math.round(num_cuotas);
  if (!(n >= 1 && n <= 120)) throw new Error('Las cuotas deben ser entre 1 y 120.');
  if (!(tasa_mensual >= 0 && tasa_mensual < 1)) throw new Error('El interés mensual no es válido.');
  const [a, m] = (primera || fecha).split('-').map(Number);
  const lista = validarCubre(cubre, monto);
  return transaction(() => {
    const id = run('INSERT INTO compras_tarjeta (tarjeta_id, fecha, descripcion, monto, num_cuotas, tasa_mensual) VALUES (?,?,?,?,?,?)',
      [tarjeta_id, fecha, descripcion.trim(), monto, n, tasa_mensual]);
    guardarCubre(id, lista);
    for (const q of calendarioCuotas({ monto, cuotas: n, tasaMensual: tasa_mensual, anio: a, mes: m })) {
      run('INSERT INTO cuotas_tarjeta (compra_id, numero, anio, mes, capital, interes, valor) VALUES (?,?,?,?,?,?,?)',
        [id, q.numero, q.anio, q.mes, q.capital, q.interes, q.valor]);
    }
    return id;
  });
}

/**
 * Edita una compra y recalcula sus cuotas. Sin cuotas pagadas se rehace todo el calendario; con pagos, lo pagado
 * no se toca y solo se recalculan las pendientes: capital que falta = monto − capital ya pagado, repartido en
 * (cuotas − pagadas) cuotas mes a mes desde la primera pendiente, con la tasa nueva hacia adelante. Las cuotas
 * pendientes se actualizan en su sitio (conservan su id) y se agregan o quitan al final si cambia el número.
 */
export function actualizarCompra({ id, fecha, descripcion, monto, num_cuotas, tasa_mensual = 0, primera, cubre }) {
  if (!(monto > 0)) throw new Error('El monto debe ser mayor que cero.');
  const n = Math.round(num_cuotas);
  if (!(n >= 1 && n <= 120)) throw new Error('Las cuotas deben ser entre 1 y 120.');
  if (!(tasa_mensual >= 0 && tasa_mensual < 1)) throw new Error('El interés mensual no es válido.');
  if (!get('SELECT id FROM compras_tarjeta WHERE id=?', [id])) throw new Error('Compra no encontrada.');
  // `cubre` ausente = no cambia los vínculos; presente = los reemplaza (los conceptos ya vinculados se conservan aunque se inactiven)
  const lista = cubre === undefined ? null : validarCubre(cubre, monto, all('SELECT concepto_id FROM compras_cubre WHERE compra_id=?', [id]).map((x) => x.concepto_id));
  if (lista === null) {
    const asignado = get('SELECT COALESCE(SUM(monto), 0) AS t FROM compras_cubre WHERE compra_id=?', [id]).t;
    if (asignado > monto + 0.005) throw new Error('El valor de la compra no puede ser menor que lo asignado a los conceptos que cubre.');
  }
  const cuotas = all('SELECT * FROM cuotas_tarjeta WHERE compra_id=? ORDER BY anio, mes, numero', [id]);
  const pagadas = cuotas.filter((q) => q.movimiento_id !== null);
  const pend = cuotas.filter((q) => q.movimiento_id === null);

  let base = monto, cuantas = n, anio, mes;
  if (pagadas.length) {
    const capitalPagado = pagadas.reduce((t, q) => t + q.capital, 0);
    base = monto - capitalPagado;
    if (!(base > 0)) throw new Error(`El monto debe ser mayor que el capital ya pagado (${Math.round(capitalPagado).toLocaleString('es-CO')}).`);
    cuantas = n - pagadas.length;
    if (cuantas < 1) throw new Error(`Las cuotas deben ser más que las ya pagadas (${pagadas.length}).`);
    const ref = pend[0] ?? pagadas.at(-1);
    ({ anio, mes } = pend[0] ? ref : (ref.mes === 12 ? { anio: ref.anio + 1, mes: 1 } : { anio: ref.anio, mes: ref.mes + 1 }));
  } else {
    [anio, mes] = (primera || fecha).split('-').map(Number);
  }
  const nuevas = calendarioCuotas({ monto: base, cuotas: cuantas, tasaMensual: tasa_mensual, anio, mes });
  // si se pagó una cuota fuera de orden, las pendientes saltan esos meses para no repetir mes en la misma compra
  const ocupados = new Set(pagadas.map((q) => claveMes(q.anio, q.mes)));
  let a = anio, m = mes;
  for (const q of nuevas) {
    while (ocupados.has(claveMes(a, m))) ({ anio: a, mes: m } = m === 12 ? { anio: a + 1, mes: 1 } : { anio: a, mes: m + 1 });
    q.anio = a; q.mes = m;
    ({ anio: a, mes: m } = m === 12 ? { anio: a + 1, mes: 1 } : { anio: a, mes: m + 1 });
  }

  transaction(() => {
    run('UPDATE compras_tarjeta SET fecha=?, descripcion=?, monto=?, num_cuotas=?, tasa_mensual=? WHERE id=?', [fecha, descripcion.trim(), monto, n, tasa_mensual, id]);
    if (lista) guardarCubre(id, lista);
    nuevas.forEach((q, i) => {
      if (pend[i]) run('UPDATE cuotas_tarjeta SET anio=?, mes=?, capital=?, interes=?, valor=? WHERE id=?', [q.anio, q.mes, q.capital, q.interes, q.valor, pend[i].id]);
      else run('INSERT INTO cuotas_tarjeta (compra_id, numero, anio, mes, capital, interes, valor) VALUES (?,?,?,?,?,?,?)', [id, 0, q.anio, q.mes, q.capital, q.interes, q.valor]);
    });
    pend.slice(nuevas.length).forEach((q) => run('DELETE FROM cuotas_tarjeta WHERE id=?', [q.id]));
    // los números de cuota siguen el orden cronológico
    all('SELECT id FROM cuotas_tarjeta WHERE compra_id=? ORDER BY anio, mes, numero, id', [id])
      .forEach((q, i) => run('UPDATE cuotas_tarjeta SET numero=? WHERE id=?', [i + 1, q.id]));
  });
}

export function eliminarCompra(id) {
  if (get('SELECT COUNT(*) AS n FROM cuotas_tarjeta WHERE compra_id=? AND movimiento_id IS NOT NULL', [id]).n) {
    throw new Error('La compra ya tiene cuotas pagadas; no se puede quitar.');
  }
  run('DELETE FROM compras_tarjeta WHERE id=?', [id]);
}

/**
 * Paga las cuotas elegidas con UN movimiento por la suma (así entra a los registros del mes y a la cuenta).
 * Si luego se borra ese movimiento, las cuotas vuelven a quedar pendientes.
 */
export function pagarCuotas({ ids, fecha, concepto_id, cuenta_id, persona_id, nota }) {
  if (!ids.length) throw new Error('Selecciona al menos una cuota.');
  return transaction(() => {
    const marcas = ids.map(() => '?').join(',');
    const filas = all(`SELECT id, valor FROM cuotas_tarjeta WHERE id IN (${marcas}) AND movimiento_id IS NULL`, ids);
    if (filas.length !== ids.length) throw new Error('Alguna de las cuotas ya fue pagada. Recarga la vista.');
    const total = filas.reduce((s, f) => s + f.valor, 0);
    const movimiento = guardarMovimiento({ fecha, concepto_id, cuenta_id, persona_id, monto: total, nota });
    run(`UPDATE cuotas_tarjeta SET movimiento_id=? WHERE id IN (${marcas})`, [movimiento, ...ids]);
    return { movimiento, total };
  });
}

// --- Resumen anual -------------------------------------------------------------------
/**
 * Los 12 meses de un año: ingresos netos, gastos, ahorro, presupuesto de gastos, saldo de cierre, más
 * los grupos con más gasto y los conceptos que más se pasaron de lo presupuestado en el año.
 */
export function resumenAnual(anio) {
  const mapas = mapasHistoricos();
  const gasto = {}, ahorro = {};
  for (const r of all(`SELECT substr(m.fecha, 1, 7) AS k, c.categoria AS cat, SUM(m.monto) AS t
                         FROM movimientos m JOIN conceptos c ON c.id = m.concepto_id
                        WHERE m.fecha >= ? AND m.fecha < ? GROUP BY k, cat`, [inicioMes(anio, 1), inicioMes(anio + 1, 1)])) {
    (r.cat === 'Ahorro' ? ahorro : gasto)[r.k] = r.t;
  }
  const porConcepto = new Map(), porGrupo = new Map();
  const meses = [];
  for (let mes = 1; mes <= 12; mes++) {
    const k = claveMes(anio, mes);
    const sig = mes === 12 ? [anio + 1, 1] : [anio, mes + 1];
    let previsto = 0;
    for (const f of gastosMes(anio, mes)) {
      if (f.categoria === 'Ahorro') continue;
      previsto += f.previsto;
      const c = porConcepto.get(f.id) ?? { nombre: f.nombre, previsto: 0, ejecutado: 0 };
      c.previsto += f.previsto; c.ejecutado += f.ejecutado;
      porConcepto.set(f.id, c);
      if (f.ejecutado) porGrupo.set(f.grupo ?? 'Sin grupo', (porGrupo.get(f.grupo ?? 'Sin grupo') ?? 0) + f.ejecutado);
    }
    meses.push({
      mes, ingresos: mapas.neto[k] ?? 0, gastos: gasto[k] ?? 0, ahorro: ahorro[k] ?? 0, previsto,
      saldoFinal: saldoInicial(mapas, sig[0], sig[1]).valor,
    });
  }
  const suma = (campo) => meses.reduce((t, m) => t + m[campo], 0);
  return {
    meses,
    total: { ingresos: suma('ingresos'), gastos: suma('gastos'), ahorro: suma('ahorro'), previsto: suma('previsto') },
    grupos: [...porGrupo].sort((a, b) => b[1] - a[1]),
    excedidos: [...porConcepto.values()].filter((c) => c.previsto > 0 && c.ejecutado > c.previsto)
      .map((c) => ({ ...c, exceso: c.ejecutado - c.previsto })).sort((a, b) => b.exceso - a.exceso).slice(0, 5),
  };
}

// --- Cajas de ahorro (informativas: no tocan movimientos ni cuentas) ----------------------------------
const signo = (m) => (m.tipo === 'retiro' ? -m.monto : m.monto);

/** Color y meta de una caja; si no vienen en `c` se conservan los que ya tenía (`previo`). */
function datosCaja(c, previo = {}) {
  const color = c.color === undefined ? previo.color ?? null : c.color || null;
  if (color && !COLORES_TARJETA.includes(color)) throw new Error('Color de caja no válido.');
  const meta = c.meta === undefined ? previo.meta ?? null : c.meta === '' || c.meta === null ? null : Number(c.meta);
  if (meta !== null && !(Number.isFinite(meta) && meta >= 0)) throw new Error('La meta debe ser un número de 0 o más.');
  return [color, meta || null];
}

export function guardarCaja(c) {
  const previo = c.id ? get('SELECT color, meta FROM cajas_ahorro WHERE id=?', [c.id]) ?? {} : {};
  const v = [c.nombre.trim(), c.banco?.trim() || null, c.activo === false ? 0 : 1, ...datosCaja(c, previo)];
  if (c.id) { run('UPDATE cajas_ahorro SET nombre=?, banco=?, activo=?, color=?, meta=? WHERE id=?', [...v, c.id]); return c.id; }
  return run('INSERT INTO cajas_ahorro (nombre, banco, activo, color, meta) VALUES (?,?,?,?,?)', v);
}

export function eliminarCaja(id) {
  const n = get(`SELECT (SELECT COUNT(*) FROM cajas_movs WHERE caja_id=?) + (SELECT COUNT(*) FROM cajas_tasas WHERE caja_id=?)
    + (SELECT COUNT(*) FROM conceptos WHERE caja_id=?) AS n`, [id, id, id]).n;
  if (n) throw new Error('La caja tiene movimientos o tasas; dala de baja en lugar de eliminarla.');
  run('DELETE FROM cajas_ahorro WHERE id=?', [id]);
}

/** Cajas con su saldo (aportes − retiros + rendimientos) y los totales por tipo. */
export const cajas = (soloActivas = true) => all(
  `SELECT c.*,
     COALESCE(SUM(CASE WHEN m.tipo = 'aporte' THEN m.monto END), 0) AS aportes,
     COALESCE(SUM(CASE WHEN m.tipo = 'retiro' THEN m.monto END), 0) AS retiros,
     COALESCE(SUM(CASE WHEN m.tipo = 'rendimiento' THEN m.monto END), 0) AS rendimientos
   FROM cajas_ahorro c LEFT JOIN cajas_movs m ON m.caja_id = c.id
   ${soloActivas ? 'WHERE c.activo = 1' : ''} GROUP BY c.id ORDER BY c.nombre`)
  .map((c) => ({ ...c, saldo: c.aportes - c.retiros + c.rendimientos }));

export const cajaMovs = (cajaId) => all('SELECT * FROM cajas_movs WHERE caja_id=? ORDER BY fecha DESC, id DESC', [cajaId]);

export function guardarCajaMov(x) {
  if (!['aporte', 'retiro', 'rendimiento'].includes(x.tipo)) throw new Error('Tipo de movimiento no válido.');
  if (!(x.monto > 0)) throw new Error('El monto debe ser mayor que cero.');
  const v = [x.caja_id, x.fecha, x.tipo, x.monto, x.nota || null];
  if (x.id) { run('UPDATE cajas_movs SET caja_id=?, fecha=?, tipo=?, monto=?, nota=? WHERE id=?', [...v, x.id]); return x.id; }
  return run('INSERT INTO cajas_movs (caja_id, fecha, tipo, monto, nota) VALUES (?,?,?,?,?)', v);
}
export const eliminarCajaMov = (id) => run('DELETE FROM cajas_movs WHERE id=?', [id]);

export const cajaTasas = (cajaId) => all('SELECT * FROM cajas_tasas WHERE caja_id=? ORDER BY desde DESC, id DESC', [cajaId]);
/** tasa_ea como fracción (0.1125 = 11,25 % EA); `verificada` = fecha en que se confirmó con el banco. */
export function guardarCajaTasa({ caja_id, desde, tasa_ea, verificada }) {
  if (!(tasa_ea > 0 && tasa_ea < 1)) throw new Error('La tasa efectiva anual debe estar entre 0 y 100 %.');
  return run('INSERT INTO cajas_tasas (caja_id, desde, tasa_ea, verificada) VALUES (?,?,?,?)', [caja_id, desde, tasa_ea, verificada || null]);
}
export const eliminarCajaTasa = (id) => run('DELETE FROM cajas_tasas WHERE id=?', [id]);

/**
 * Rendimiento estimado de una caja en un mes, a partir del saldo al inicio del mes y los aportes y
 * retiros del mes; se compara con lo registrado como rendimiento en ese mes.
 */
export function estimarCajaMes(cajaId, anio, mes) {
  const inicio = inicioMes(anio, mes), sig = inicioMesSig(anio, mes);
  const movs = all('SELECT * FROM cajas_movs WHERE caja_id=? AND fecha < ?', [cajaId, sig]);
  const saldo = movs.filter((m) => m.fecha < inicio).reduce((s, m) => s + signo(m), 0);
  const flujos = movs.filter((m) => m.fecha >= inicio && m.tipo !== 'rendimiento').map((m) => ({ fecha: m.fecha, monto: signo(m) }));
  const registrado = movs.filter((m) => m.fecha >= inicio && m.tipo === 'rendimiento').reduce((s, m) => s + m.monto, 0);
  const e = estimarRendimiento({ saldo, flujos, tasas: cajaTasas(cajaId), desde: inicio, hasta: sig });
  return { ...e, saldoInicial: saldo, registrado };
}

// --- Autopréstamos (de cajas de ahorro) ----------------------------------------------------------
/**
 * Caja donde se acumulan los intereses que pagan los autopréstamos. Se crea sola la primera vez que hace falta
 * y su id queda en `config` (clave `caja_ganancias`), así se puede renombrar sin perderla.
 */
export function cajaGanancias() {
  const id = Number(get('SELECT valor FROM config WHERE clave=?', ['caja_ganancias'])?.valor);
  if (id && get('SELECT id FROM cajas_ahorro WHERE id=?', [id])) return id;
  const nueva = guardarCaja({ nombre: 'Ganancias autopréstamos' });
  run(`INSERT INTO config (clave, valor) VALUES ('caja_ganancias', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`, [String(nueva)]);
  return nueva;
}

/** La caja de ganancias con su saldo, o null si todavía no se ha creado (no la crea). */
export function gananciasActual() {
  const id = Number(get('SELECT valor FROM config WHERE clave=?', ['caja_ganancias'])?.valor);
  return (id && cajas(false).find((c) => c.id === id)) || null;
}

/**
 * Crea el préstamo, su calendario de cuotas (cuota fija) y un retiro en cada caja que presta.
 * origenes: [{caja_id, monto}]; primera = fecha de la primera cuota (las demás, mes a mes).
 */
export function crearAutoprestamo({ nombre, origenes, tasa_mensual = 0, plazo, fecha_inicio, primera, cuenta_id }) {
  const lista = origenes.filter((o) => o.monto > 0);
  if (!lista.length) throw new Error('Indica cuánto presta al menos una caja.');
  const monto = lista.reduce((t, o) => t + o.monto, 0);
  const n = Math.round(plazo);
  if (!(n >= 1 && n <= 120)) throw new Error('Las cuotas deben ser entre 1 y 120.');
  if (!(tasa_mensual >= 0 && tasa_mensual < 1)) throw new Error('El interés mensual no es válido.');
  const saldos = new Map(cajas(false).map((c) => [c.id, c]));
  for (const o of lista) {
    const c = saldos.get(o.caja_id);
    if (!c) throw new Error('Caja no encontrada.');
    if (o.monto > c.saldo) throw new Error(`La caja «${c.nombre}» solo tiene ${Math.round(c.saldo).toLocaleString('es-CO')} de saldo.`);
  }
  const [a, m] = (primera || fecha_inicio).split('-').map(Number);
  return transaction(() => {
    const concepto = guardarConcepto({ tipo: 'gasto_fijo', nombre: `Autopréstamo ${nombre.trim()}`, grupo: 'Deudas', presupuestado: true, periodicidad: 'mensual' });
    const id = run(`INSERT INTO autoprestamos (nombre, monto, tasa_mensual, plazo, fecha_inicio, concepto_id, cuenta_id) VALUES (?,?,?,?,?,?,?)`,
      [nombre.trim(), monto, tasa_mensual, n, fecha_inicio, concepto, cuenta_id || null]);
    for (const o of lista) {
      run('INSERT INTO autoprestamos_origen (prestamo_id, caja_id, monto) VALUES (?,?,?)', [id, o.caja_id, o.monto]);
      run(`INSERT INTO cajas_movs (caja_id, fecha, tipo, monto, nota, autoprestamo_id) VALUES (?,?,?,?,?,?)`,
        [o.caja_id, fecha_inicio, 'retiro', o.monto, `Autopréstamo ${nombre.trim()}`, id]);
    }
    for (const q of calendarioCuotas({ monto, cuotas: n, tasaMensual: tasa_mensual, anio: a, mes: m })) {
      run('INSERT INTO cuotas (prestamo_id, numero, vencimiento, capital, interes, valor) VALUES (?,?,?,?,?,?)',
        [id, q.numero, vencimientoEnMes(primera || fecha_inicio, q.anio, q.mes), q.capital, q.interes, q.valor]);
    }
    return id;
  });
}

/** Préstamos con su avance: cuotas pagadas, capital/interés pendientes y pagados, próxima y última cuota. */
export function autoprestamos() {
  const origenes = all(`SELECT o.*, c.nombre AS caja FROM autoprestamos_origen o JOIN cajas_ahorro c ON c.id = o.caja_id ORDER BY c.nombre`);
  return all(
    `SELECT a.*, COUNT(q.id) AS n_cuotas, COALESCE(SUM(q.movimiento_id IS NOT NULL), 0) AS pagadas,
            COALESCE(SUM(CASE WHEN q.movimiento_id IS NULL THEN q.capital END), 0) AS capital_pendiente,
            COALESCE(SUM(CASE WHEN q.movimiento_id IS NULL THEN q.interes END), 0) AS interes_pendiente,
            COALESCE(SUM(CASE WHEN q.movimiento_id IS NULL THEN q.valor END), 0) AS valor_pendiente,
            COALESCE(SUM(CASE WHEN q.movimiento_id IS NOT NULL THEN q.capital END), 0) AS capital_pagado,
            COALESCE(SUM(CASE WHEN q.movimiento_id IS NOT NULL THEN q.interes END), 0) AS interes_pagado,
            MIN(CASE WHEN q.movimiento_id IS NULL THEN q.vencimiento END) AS proxima, MAX(q.vencimiento) AS ultima,
            (SELECT valor FROM cuotas WHERE prestamo_id = a.id ORDER BY numero LIMIT 1) AS cuota
       FROM autoprestamos a LEFT JOIN cuotas q ON q.prestamo_id = a.id
      GROUP BY a.id ORDER BY a.estado, a.fecha_inicio DESC, a.id DESC`,
  ).map((a) => ({ ...a, origenes: origenes.filter((o) => o.prestamo_id === a.id) }));
}

export const cuotasPrestamo = (prestamoId) => all(
  `SELECT q.*, m.fecha AS fecha_pago_real FROM cuotas q LEFT JOIN movimientos m ON m.id = q.movimiento_id
    WHERE q.prestamo_id = ? ORDER BY q.numero`, [prestamoId]);

/**
 * Paga cuotas de un préstamo con UN movimiento por la suma (en el concepto «Autopréstamo X»). De cada cuota, el capital
 * vuelve a las cajas que prestaron (un aporte por caja, en proporción a lo que puso cada una) y el interés va como
 * aporte a la caja de ganancias (`cajaGanancias`).
 */
export function pagarCuotasPrestamo({ prestamo_id, ids, fecha, cuenta_id, persona_id, nota }) {
  if (!ids.length) throw new Error('Selecciona al menos una cuota.');
  return transaction(() => {
    const a = get('SELECT * FROM autoprestamos WHERE id=?', [prestamo_id]);
    if (!a) throw new Error('Préstamo no encontrado.');
    const marcas = ids.map(() => '?').join(',');
    const filas = all(`SELECT * FROM cuotas WHERE prestamo_id=? AND id IN (${marcas}) AND movimiento_id IS NULL ORDER BY numero`, [prestamo_id, ...ids]);
    if (filas.length !== ids.length) throw new Error('Alguna de las cuotas ya fue pagada. Recarga la vista.');
    const total = filas.reduce((t, f) => t + f.valor, 0);
    const movimiento = guardarMovimiento({ fecha, concepto_id: a.concepto_id, cuenta_id, persona_id, monto: total, nota });
    run(`UPDATE cuotas SET movimiento_id=? WHERE id IN (${marcas})`, [movimiento, ...ids]);
    const origenes = all('SELECT * FROM autoprestamos_origen WHERE prestamo_id=? ORDER BY caja_id', [prestamo_id]);
    const aporte = (caja, monto, nota, cuota) => run(
      `INSERT INTO cajas_movs (caja_id, fecha, tipo, monto, nota, cuota_id) VALUES (?,?,?,?,?,?)`, [caja, fecha, 'aporte', monto, nota, cuota]);
    for (const q of filas) {
      const cual = `cuota ${q.numero}/${a.plazo} · Autopréstamo ${a.nombre}`;
      repartir(q.capital, origenes.map((o) => o.monto)).forEach((parte, i) => {
        if (parte > 0) aporte(origenes[i].caja_id, parte, `Capital ${cual}`, q.id);
      });
      if (q.interes > 0) aporte(cajaGanancias(), q.interes, `Interés ${cual}`, q.id);
    }
    if (!get('SELECT COUNT(*) AS n FROM cuotas WHERE prestamo_id=? AND movimiento_id IS NULL', [prestamo_id]).n) {
      run(`UPDATE autoprestamos SET estado='pagado' WHERE id=?`, [prestamo_id]);
      if (a.concepto_id) darDeBaja(a.concepto_id, inicioMesSig(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)))); // el mes del último pago aún cuenta
    }
    return { movimiento, total };
  });
}

/** Cuotas de los autopréstamos activos (pagadas y pendientes) en el formato que espera `calc.proyectarPagosPrestamos`. */
export const cuotasDePrestamosActivos = () => all(
  `SELECT q.id, q.prestamo_id, a.nombre, a.plazo, a.cuenta_id, q.numero, q.vencimiento, q.capital, q.interes, q.valor,
          q.movimiento_id IS NOT NULL AS pagada
     FROM cuotas q JOIN autoprestamos a ON a.id = q.prestamo_id
    WHERE a.estado = 'activo' ORDER BY q.vencimiento, a.id, q.numero`).map((q) => ({ ...q, pagada: !!q.pagada }));

export const proyeccionPagosPrestamos = () => proyectarPagosPrestamos(cuotasDePrestamosActivos());

/**
 * Paga cuotas de varios préstamos de una vez: un movimiento por préstamo (cada uno con su concepto y su cuenta).
 * Todo o nada: si algo falla, no queda ningún pago a medias. pagos: [{prestamo_id, ids, cuenta_id}].
 */
export function pagarCuotasPrestamos({ pagos, fecha }) {
  if (!pagos.length) throw new Error('No hay cuotas para pagar.');
  return transaction(() => {
    let total = 0;
    const movimientos = [];
    for (const p of pagos) {
      const nombre = get('SELECT nombre FROM autoprestamos WHERE id=?', [p.prestamo_id])?.nombre ?? '';
      const r = pagarCuotasPrestamo({ prestamo_id: p.prestamo_id, ids: p.ids, fecha, cuenta_id: p.cuenta_id || null,
        nota: `${nombre}: ${p.ids.length} cuota${p.ids.length === 1 ? '' : 's'}` });
      total += r.total;
      movimientos.push(r.movimiento);
    }
    return { total, movimientos };
  });
}

/**
 * Cambia la tasa mensual y recalcula las cuotas PENDIENTES: el capital que falta se vuelve a repartir entre
 * ellas (mismos números y vencimientos, cuota fija a la nueva tasa). Lo ya pagado no se toca.
 */
export function cambiarTasaAutoprestamo(id, tasa_mensual) {
  if (!(tasa_mensual >= 0 && tasa_mensual < 1)) throw new Error('El interés mensual no es válido.');
  const pend = all('SELECT * FROM cuotas WHERE prestamo_id=? AND movimiento_id IS NULL ORDER BY numero', [id]);
  if (!pend.length) throw new Error('El préstamo ya no tiene cuotas pendientes.');
  const [anio, mes] = pend[0].vencimiento.split('-').map(Number);
  const nuevas = calendarioCuotas({ monto: pend.reduce((t, q) => t + q.capital, 0), cuotas: pend.length, tasaMensual: tasa_mensual, anio, mes });
  transaction(() => {
    pend.forEach((q, i) => run('UPDATE cuotas SET capital=?, interes=?, valor=? WHERE id=?', [nuevas[i].capital, nuevas[i].interes, nuevas[i].valor, q.id]));
    run('UPDATE autoprestamos SET tasa_mensual=? WHERE id=?', [tasa_mensual, id]);
  });
}

/** Solo se puede eliminar un préstamo sin cuotas pagadas: devuelve el desembolso (quita los retiros) y su concepto. */
export function eliminarAutoprestamo(id) {
  if (get('SELECT COUNT(*) AS n FROM cuotas WHERE prestamo_id=? AND movimiento_id IS NOT NULL', [id]).n) {
    throw new Error('El préstamo ya tiene cuotas pagadas; quita primero esos pagos desde la vista Mes.');
  }
  const a = get('SELECT concepto_id FROM autoprestamos WHERE id=?', [id]);
  transaction(() => {
    run('DELETE FROM cajas_movs WHERE autoprestamo_id=?', [id]);
    run('DELETE FROM autoprestamos WHERE id=?', [id]); // cuotas y orígenes caen en cascada
    if (a?.concepto_id && usosConcepto(a.concepto_id) === 0) run('DELETE FROM conceptos WHERE id=?', [a.concepto_id]);
  });
}

/**
 * Control por caja de lo que ha prestado: prestado, devuelto (capital), lo que falta, intereses cobrados y
 * por cobrar, y la fecha estimada en que termina de devolverlo (última cuota pendiente).
 */
export function prestamosPorCaja() {
  const porCaja = new Map();
  for (const a of autoprestamos()) {
    for (const o of a.origenes) {
      const parte = o.monto / a.monto;
      const c = porCaja.get(o.caja_id) ?? { caja_id: o.caja_id, caja: o.caja, prestado: 0, devuelto: 0, pendiente: 0, interesCobrado: 0, interesPorCobrar: 0, termina: null, prestamos: [] };
      const fila = {
        prestamo_id: a.id, nombre: a.nombre, estado: a.estado, prestado: o.monto, devuelto: parte * a.capital_pagado, pendiente: parte * a.capital_pendiente,
        interesCobrado: parte * a.interes_pagado, interesPorCobrar: parte * a.interes_pendiente, termina: a.proxima ? a.ultima : null,
      };
      c.prestado += fila.prestado; c.devuelto += fila.devuelto; c.pendiente += fila.pendiente;
      c.interesCobrado += fila.interesCobrado; c.interesPorCobrar += fila.interesPorCobrar;
      if (fila.termina && (!c.termina || fila.termina > c.termina)) c.termina = fila.termina;
      c.prestamos.push(fila);
      porCaja.set(o.caja_id, c);
    }
  }
  return [...porCaja.values()].sort((x, y) => x.caja.localeCompare(y.caja));
}

// --- Reinicio ------------------------------------------------------------------------------
/**
 * Borra TODOS los datos (movimientos, ingresos, conceptos, personas, cuentas, tarjetas, cajas, préstamos,
 * presupuesto, configuración…) y deja la base como recién creada: mismo esquema, grupos base y contadores en cero.
 * No se puede deshacer; quien lo llame debe haber respaldado antes (storage.respaldarAhora).
 */
export function borrarTodo() {
  // De las tablas que apuntan a otras hacia las referenciadas, para respetar las claves foráneas.
  const tablas = ['cajas_movs', 'cuotas_tarjeta', 'compras_cubre', 'compras_tarjeta', 'tarjetas', 'cuotas', 'autoprestamos_origen', 'autoprestamos',
    'cajas_tasas', 'cajas_ahorro', 'cuentas_saldos', 'movimientos', 'ingresos', 'presupuesto', 'saldos_mes', 'cuentas',
    'conceptos', 'personas', 'grupos', 'config'];
  transaction(() => {
    for (const t of tablas) run(`DELETE FROM ${t}`);
    run('DELETE FROM sqlite_sequence');
    run(`INSERT OR IGNORE INTO grupos (nombre) VALUES ('Hogar'), ('Deudas')`);
  });
}

export { transaction };
