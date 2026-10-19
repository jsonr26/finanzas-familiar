import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, get, all } from '../src/db.js';
import { MIGRATIONS } from '../src/schema.js';
import * as repo from '../src/repo.js';
import { pendientesDePago, hoyISO } from '../src/calc.js';

describe('repo', () => {
  beforeEach(() => openDatabase(null));

  it('concepto con historial no se elimina, se da de baja', () => {
    const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Arriendo', presupuestado: true });
    repo.guardarMovimiento({ fecha: '2026-10-05', concepto_id: id, monto: 1_000_000 });
    expect(() => repo.eliminarConcepto(id)).toThrow(/baja/);
    repo.darDeBaja(id);
    expect(repo.conceptos({ soloActivos: true })).toHaveLength(0);
    repo.reactivar(id);
    expect(repo.conceptos({ soloActivos: true })).toHaveLength(1);
  });

  it('movimientos se filtran por mes, incluido diciembre', () => {
    const id = repo.guardarConcepto({ tipo: 'gasto_variable', nombre: 'Mercado' });
    repo.guardarMovimiento({ fecha: '2026-11-30', concepto_id: id, monto: 10 });
    repo.guardarMovimiento({ fecha: '2026-12-01', concepto_id: id, monto: 20 });
    repo.guardarMovimiento({ fecha: '2026-12-31', concepto_id: id, monto: 30 });
    repo.guardarMovimiento({ fecha: '2027-01-01', concepto_id: id, monto: 40 });
    expect(repo.movimientosMes(2026, 12).map((m) => m.monto).sort()).toEqual([20, 30]);
    expect(repo.ejecutadoPorConcepto(2026, 12)[0].total).toBe(50);
  });

  it('saldo anterior se inserta y se actualiza', () => {
    expect(repo.saldoAnterior(2026, 10)).toBe(0);
    repo.guardarSaldoAnterior(2026, 10, 500);
    repo.guardarSaldoAnterior(2026, 10, 700);
    expect(repo.saldoAnterior(2026, 10)).toBe(700);
  });

  it('guardar concepto registra el grupo y deriva el día de la fecha de pago', () => {
    const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Internet', grupo: 'Hogar', fecha_pago: '2026-10-17', periodicidad: 'mensual' });
    expect(repo.grupos()).toContain('Hogar');
    const c = repo.conceptos().find((x) => x.id === id);
    expect(c).toMatchObject({ dia_pago: 17, fecha_pago: '2026-10-17', periodicidad: 'mensual' });
  });

  it('grupos base y responsable del pago', () => {
    expect(repo.grupos()).toEqual(['Deudas', 'Hogar']);
    const ana = repo.crearPersona('Ana');
    const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Tarjeta', grupo: 'Deudas', responsable_id: ana });
    expect(repo.conceptos().find((c) => c.id === id).responsable).toBe('Ana');
  });

  it('saldo anterior se arrastra solo y un saldo manual se puede quitar', () => {
    const sueldo = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo' });
    const desc = repo.guardarConcepto({ tipo: 'descuento', nombre: 'Salud' });
    const gasto = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Arriendo' });
    repo.guardarIngreso({ anio: 2026, mes: 9, quincena: 1, concepto_id: sueldo, clase: 'sueldo', monto: 1000 });
    repo.guardarIngreso({ anio: 2026, mes: 9, quincena: 1, concepto_id: desc, clase: 'descuento', monto: 100 });
    repo.guardarMovimiento({ fecha: '2026-09-30', concepto_id: gasto, monto: 300 });
    expect(repo.saldoAnteriorInfo(2026, 10)).toEqual({ valor: 600, manual: false });
    repo.guardarSaldoAnterior(2026, 10, 50);
    expect(repo.saldoAnteriorInfo(2026, 10)).toEqual({ valor: 50, manual: true });
    repo.quitarSaldoAnterior(2026, 10);
    expect(repo.saldoAnterior(2026, 10)).toBe(600);
  });

  it('copiar ingresos del mes anterior: solo conceptos activos y solo si el mes está vacío', () => {
    const sueldo = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo' });
    const bono = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Bono' });
    repo.guardarIngreso({ anio: 2026, mes: 12, quincena: 2, concepto_id: sueldo, clase: 'sueldo', monto: 1000, nota: 'a' });
    repo.guardarIngreso({ anio: 2026, mes: 12, quincena: 1, concepto_id: bono, clase: 'otro', monto: 500 });
    repo.darDeBaja(bono);
    expect(repo.copiarIngresos(2027, 1)).toBe(1);
    expect(repo.ingresosMes(2027, 1)).toMatchObject([{ concepto_id: sueldo, monto: 1000, quincena: 2, nota: 'a' }]);
    expect(() => repo.copiarIngresos(2027, 1)).toThrow(/ya tiene/);
    expect(() => repo.copiarIngresos(2027, 3)).toThrow(/no tiene ingresos/);
  });

  it('presupuesto: monto base, ajuste del mes y ejecutado', () => {
    const renta = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Arriendo', grupo: 'Hogar', presupuestado: true, monto_estimado: 1000, fecha_pago: '2026-01-05' });
    const merc = repo.guardarConcepto({ tipo: 'gasto_variable', nombre: 'Mercado', grupo: 'Hogar', presupuestado: true, monto_estimado: 400 });
    const otro = repo.guardarConcepto({ tipo: 'gasto_variable', nombre: 'Salidas', presupuestado: false });
    repo.guardarMovimiento({ fecha: '2026-10-03', concepto_id: renta, monto: 1000 });
    repo.guardarMovimiento({ fecha: '2026-10-08', concepto_id: merc, monto: 150 });
    repo.guardarMovimiento({ fecha: '2026-10-09', concepto_id: otro, monto: 60 });
    repo.guardarAjuste(2026, 10, merc, 600);

    const por = (anio, mes) => Object.fromEntries(repo.presupuestoMes(anio, mes).map((f) => [f.nombre, f]));
    const oct = por(2026, 10);
    expect(oct.Arriendo).toMatchObject({ previsto: 1000, ejecutado: 1000, ajuste: null });
    expect(oct.Mercado).toMatchObject({ previsto: 600, ejecutado: 150, ajuste: 600 });
    expect(oct.Salidas).toMatchObject({ previsto: 0, ejecutado: 60 });
    expect(repo.resumenPresupuesto(2026, 10)).toEqual({ previsto: 1600, ejecutado: 1210 });
    // noviembre: el ajuste de octubre no aplica, vuelve el monto base
    expect(por(2026, 11).Mercado).toMatchObject({ previsto: 400, ejecutado: 0 });
    expect(por(2026, 11).Salidas).toBeUndefined();

    repo.guardarAjuste(2026, 10, merc, null);
    expect(por(2026, 10).Mercado.previsto).toBe(400);
  });

  it('copiar ajustes del mes anterior no pisa los existentes', () => {
    const a = repo.guardarConcepto({ tipo: 'gasto_variable', nombre: 'A', presupuestado: true });
    const b = repo.guardarConcepto({ tipo: 'gasto_variable', nombre: 'B', presupuestado: true });
    repo.guardarAjuste(2026, 9, a, 10);
    repo.guardarAjuste(2026, 9, b, 20);
    repo.guardarAjuste(2026, 10, b, 99);
    expect(repo.copiarAjustes(2026, 10)).toBe(1);
    const m = Object.fromEntries(repo.presupuestoMes(2026, 10).map((f) => [f.nombre, f.previsto]));
    expect(m).toEqual({ A: 10, B: 99 });
  });

  it('gastosMes marca como pagado (n_mov) un concepto con movimiento en el mes', () => {
    const luz = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Luz', fecha_pago: '2026-01-20' });
    repo.guardarMovimiento({ fecha: '2026-09-25', concepto_id: luz, monto: 80 });
    expect(repo.gastosMes(2026, 10)[0].n_mov).toBe(0);
    expect(repo.gastosMes(2026, 9)[0].n_mov).toBe(1);
  });

  it('proyección: ingresos repetidos del último mes, gastos presupuestados y saldo encadenado', () => {
    const sueldo = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo' });
    const renta = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Arriendo', presupuestado: true, monto_estimado: 400 });
    const caja = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Caja', categoria: 'Ahorro', presupuestado: true, monto_estimado: 100 });
    repo.guardarIngreso({ anio: 2026, mes: 12, quincena: 1, concepto_id: sueldo, clase: 'sueldo', monto: 1000 });
    repo.guardarMovimiento({ fecha: '2026-12-02', concepto_id: renta, monto: 450 }); // se pasó del presupuesto
    repo.guardarAjuste(2027, 2, renta, 500);
    const p = repo.proyeccion(2026, 12, 3);
    expect(p[0]).toMatchObject({ ingresos: 1000, origen: 'real', gastos: 450, ahorro: 100, saldoInicial: 0, saldoFinal: 450 });
    expect(p[1]).toMatchObject({ mes: 1, anio: 2027, ingresos: 1000, origen: 'repetido', gastos: 400, saldoFinal: 950 });
    expect(p[2]).toMatchObject({ gastos: 500, saldoFinal: 1350 });
  });

  it('presupuesto de ingresos: previsto vs real, y la proyección lo usa', () => {
    const sueldo = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo', presupuestado: true, monto_estimado: 1000 });
    const salud = repo.guardarConcepto({ tipo: 'descuento', nombre: 'Salud', presupuestado: true, monto_estimado: 100 });
    repo.guardarIngreso({ anio: 2026, mes: 12, quincena: 1, concepto_id: sueldo, clase: 'sueldo', monto: 600 });
    repo.guardarAjuste(2027, 2, sueldo, 1500);
    const f = Object.fromEntries(repo.presupuestoIngresosMes(2026, 12).map((x) => [x.nombre, x]));
    expect(f.Sueldo).toMatchObject({ previsto: 1000, ejecutado: 600 });
    expect(f.Salud).toMatchObject({ previsto: 100, ejecutado: 0 });
    const p = repo.proyeccion(2026, 12, 3);
    expect(p.map((m) => [m.ingresos, m.origen])).toEqual([[900, 'presupuesto'], [900, 'presupuesto'], [1400, 'presupuesto']]);
  });

  it('tarjeta: compras a cuotas, pagar elegidas crea un movimiento y borrarlo reabre las cuotas', () => {
    const cuenta = repo.guardarCuenta({ nombre: 'Banco Sindy', saldo_inicial: 0 });
    const t = repo.crearTarjeta({ nombre: 'Visa', cuenta_id: cuenta });
    const concepto = repo.tarjetas()[0].concepto_id;
    expect(repo.conceptos().find((c) => c.id === concepto)).toMatchObject({ nombre: 'Tarjeta Visa', grupo: 'Deudas' });
    repo.guardarCompra({ tarjeta_id: t, fecha: '2026-10-03', descripcion: 'Nevera', monto: 900, num_cuotas: 3 });
    repo.guardarCompra({ tarjeta_id: t, fecha: '2026-10-10', descripcion: 'Cena', monto: 100, num_cuotas: 1 });
    expect(repo.tarjetas()[0].pendiente).toBe(1000);

    // las cuotas del mes alimentan el presupuesto del concepto de la tarjeta
    const prev = (a, m) => repo.gastosMes(a, m).find((f) => f.id === concepto).previsto;
    expect([prev(2026, 10), prev(2026, 11), prev(2026, 12), prev(2027, 1)]).toEqual([400, 300, 300, 0]);

    const octubre = repo.cuotasPendientes(t).filter((q) => q.mes === 10);
    const r = repo.pagarCuotas({ ids: octubre.map((q) => q.id), fecha: '2026-10-15', concepto_id: concepto, cuenta_id: cuenta, nota: 'Visa octubre' });
    expect(r.total).toBe(400);
    expect(repo.movimientosMes(2026, 10)).toMatchObject([{ monto: 400, cuenta: 'Banco Sindy', concepto: 'Tarjeta Visa' }]);
    expect(repo.tarjetas()[0].pendiente).toBe(600);
    expect(repo.cuotasPagadas(t)).toHaveLength(2);
    expect(() => repo.pagarCuotas({ ids: [octubre[0].id], fecha: '2026-10-16', concepto_id: concepto })).toThrow(/ya fue pagada/);
    expect(() => repo.eliminarCompra(octubre[0].compra_id)).toThrow(/pagadas/);
    expect(() => repo.eliminarConcepto(concepto)).toThrow(/baja/);

    repo.eliminarMovimiento(r.movimiento);
    expect(repo.tarjetas()[0].pendiente).toBe(1000);
  });

  it('tarjeta: últimos 4 dígitos, cupo y color se guardan, se validan y vienen con fecha de pago y cuenta', () => {
    const cuenta = repo.guardarCuenta({ nombre: 'Banco Sindy', saldo_inicial: 0 });
    const t = repo.crearTarjeta({ nombre: 'Visa', cuenta_id: cuenta, fecha_pago: '2026-01-20', ultimos4: '4821', cupo: 5000000, color: 'morado' });
    expect(repo.tarjetas()[0]).toMatchObject({ id: t, ultimos4: '4821', cupo: 5000000, color: 'morado', fecha_pago: '2026-01-20', cuenta: 'Banco Sindy' });
    repo.actualizarTarjeta({ id: t, nombre: 'Visa', cuenta_id: cuenta, fecha_pago: '2026-01-20', ultimos4: '', cupo: '', color: '' });
    expect(repo.tarjetas()[0]).toMatchObject({ ultimos4: null, cupo: null, color: null });
    expect(() => repo.actualizarTarjeta({ id: t, nombre: 'Visa', ultimos4: '12' })).toThrow(/4 números/);
    expect(() => repo.actualizarTarjeta({ id: t, nombre: 'Visa', ultimos4: '1234 5678' })).toThrow(/4 números/);
    expect(() => repo.actualizarTarjeta({ id: t, nombre: 'Visa', cupo: -5 })).toThrow(/cupo/);
    expect(() => repo.actualizarTarjeta({ id: t, nombre: 'Visa', color: 'naranja' })).toThrow(/Color/);
    expect(() => repo.crearTarjeta({ nombre: 'Otra', ultimos4: 'abcd' })).toThrow(/4 números/);
    expect(repo.tarjetas()).toHaveLength(1);   // la validación falla antes de crear nada
  });

  it('caja: color y meta se guardan, se validan y se conservan si no se envían', () => {
    const id = repo.guardarCaja({ nombre: 'Viaje', banco: 'Nu', color: 'azul', meta: 10000000 });
    expect(repo.cajas()[0]).toMatchObject({ color: 'azul', meta: 10000000 });
    repo.guardarCaja({ id, nombre: 'Viaje 2', banco: 'Nu' });                  // sin color ni meta: se conservan
    expect(repo.cajas()[0]).toMatchObject({ nombre: 'Viaje 2', color: 'azul', meta: 10000000 });
    repo.guardarCaja({ id, nombre: 'Viaje 2', color: '', meta: '' });           // vacíos explícitos: se quitan
    expect(repo.cajas()[0]).toMatchObject({ color: null, meta: null });
    expect(() => repo.guardarCaja({ id, nombre: 'X', color: 'naranja' })).toThrow(/Color/);
    expect(() => repo.guardarCaja({ id, nombre: 'X', meta: -1 })).toThrow(/meta/);
    expect(() => repo.guardarCaja({ nombre: 'Otra', meta: 'abc' })).toThrow(/meta/);
    expect(repo.cajas()).toHaveLength(1);
  });

  it('último registro: toma el anotado más recientemente, sea movimiento o ingreso, y guarda la hora', () => {
    expect(repo.ultimoRegistro()).toBeNull();
    const sueldo = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo' });
    const mercado = repo.guardarConcepto({ tipo: 'gasto_variable', nombre: 'Mercado' });
    const ing = repo.guardarIngreso({ anio: 2026, mes: 10, quincena: 1, concepto_id: sueldo, clase: 'sueldo', monto: 1000 });
    expect(repo.ultimoRegistro()).toMatchObject({ tipo: 'ingreso', id: ing, concepto: 'Sueldo', anio: 2026, mes: 10 });
    const m1 = repo.guardarMovimiento({ fecha: '2026-10-20', concepto_id: mercado, monto: 50 });
    const m2 = repo.guardarMovimiento({ fecha: '2026-09-01', concepto_id: mercado, monto: 70 });   // fecha vieja, pero anotado después
    expect(repo.ultimoRegistro()).toMatchObject({ tipo: 'movimiento', id: m2, fecha: '2026-09-01', monto: 70 });
    expect(repo.movimientosMes(2026, 10)[0].creado_en).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    repo.guardarMovimiento({ id: m1, fecha: '2026-10-21', concepto_id: mercado, monto: 55 });       // editar no cambia la hora de anotación
    expect(repo.ultimoRegistro().id).toBe(m2);
    repo.eliminarMovimiento(m2);
    expect(repo.ultimoRegistro()).toMatchObject({ tipo: 'movimiento', id: m1 });
  });

  it('tarjetaDeConcepto identifica el concepto de una tarjeta activa y nada más', () => {
    const t = repo.crearTarjeta({ nombre: 'Visa' });
    const concepto = repo.tarjetas()[0].concepto_id;
    expect(repo.tarjetaDeConcepto(concepto)).toMatchObject({ id: t, nombre: 'Visa' });
    expect(repo.tarjetaDeConcepto(repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Arriendo' }))).toBeNull();
    expect(repo.tarjetaDeConcepto(9999)).toBeNull();
  });

  it('pagar cuotas es atómico: si falla no queda nada a medias', () => {
    const t = repo.crearTarjeta({ nombre: 'Master' });
    repo.guardarCompra({ tarjeta_id: t, fecha: '2026-10-03', descripcion: 'X', monto: 100, num_cuotas: 1 });
    const [q] = repo.cuotasPendientes(t);
    expect(() => repo.pagarCuotas({ ids: [q.id], fecha: '2026-10-15', concepto_id: 9999 })).toThrow();
    expect(repo.cuotasPendientes(t)).toHaveLength(1);
    expect(repo.movimientosMes(2026, 10)).toHaveLength(0);
  });

  it('cuentas: saldo = inicial + ingresos netos − gastos, con saldo real y cuenta sin asignar', () => {
    const sindy = repo.crearPersona('Sindy');
    const bs = repo.guardarCuenta({ nombre: 'Banco Sindy', persona_id: sindy, saldo_inicial: 100 });
    const bj = repo.guardarCuenta({ nombre: 'Banco Jeisson', saldo_inicial: 0 });
    const sueldo = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo' });
    const salud = repo.guardarConcepto({ tipo: 'descuento', nombre: 'Salud' });
    const gasto = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Arriendo' });
    repo.guardarIngreso({ anio: 2026, mes: 9, quincena: 1, concepto_id: sueldo, clase: 'sueldo', monto: 1000, persona_id: sindy });
    repo.guardarIngreso({ anio: 2026, mes: 10, quincena: 1, concepto_id: sueldo, clase: 'sueldo', monto: 2000, cuenta_id: bj });
    repo.guardarIngreso({ anio: 2026, mes: 10, quincena: 1, concepto_id: salud, clase: 'descuento', monto: 200, cuenta_id: bj });
    repo.guardarMovimiento({ fecha: '2026-09-05', concepto_id: gasto, monto: 300, persona_id: sindy });
    repo.guardarMovimiento({ fecha: '2026-10-05', concepto_id: gasto, monto: 500, cuenta_id: bj });
    repo.guardarMovimiento({ fecha: '2026-11-05', concepto_id: gasto, monto: 999, cuenta_id: bj }); // posterior al corte

    let r = repo.saldosCuentas(2026, 10);
    expect(r.sinCuenta).toEqual({ ingresos: 1000, gastos: 300 });
    expect(r.cuentas.find((c) => c.id === bj)).toMatchObject({ ingresos: 1800, gastos: 500, calculado: 1300 });
    expect(r.total).toBe(100 + 700 + 1300); // 2100 = inicial + ingresos − gastos
    expect(repo.saldoBaseCuentas()).toBe(100);
    expect(repo.saldoAnterior(2026, 11)).toBe(r.total); // el saldo de Mes al cierre de octubre incluye los saldos iniciales y cuadra con Cuentas

    expect(repo.asignarCuentaPorPersona(bs)).toBe(2);
    r = repo.saldosCuentas(2026, 10);
    expect(r.sinCuenta).toEqual({ ingresos: 0, gastos: 0 });
    expect(r.cuentas.find((c) => c.id === bs).calculado).toBe(800);
    expect(r.total).toBe(2100);

    repo.guardarSaldoReal(bs, 2026, 10, 750);
    expect(repo.saldosCuentas(2026, 10).cuentas.find((c) => c.id === bs)).toMatchObject({ real: 750, diferencia: -50 });
    repo.guardarSaldoReal(bs, 2026, 10, null);
    expect(repo.saldosCuentas(2026, 10).cuentas.find((c) => c.id === bs).real).toBeNull();
  });

  it('resumen anual: totales por mes, ahorro aparte, saldo de cierre y excedidos', () => {
    const sueldo = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo' });
    const renta = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Arriendo', grupo: 'Hogar', presupuestado: true, monto_estimado: 100 });
    const caja = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Caja', categoria: 'Ahorro', presupuestado: true, monto_estimado: 50 });
    repo.guardarIngreso({ anio: 2026, mes: 1, quincena: 1, concepto_id: sueldo, clase: 'sueldo', monto: 1000 });
    repo.guardarIngreso({ anio: 2026, mes: 2, quincena: 1, concepto_id: sueldo, clase: 'sueldo', monto: 1000 });
    repo.guardarMovimiento({ fecha: '2026-01-05', concepto_id: renta, monto: 150 });
    repo.guardarMovimiento({ fecha: '2026-01-06', concepto_id: caja, monto: 50 });
    repo.guardarMovimiento({ fecha: '2026-02-05', concepto_id: renta, monto: 100 });
    repo.guardarMovimiento({ fecha: '2025-12-31', concepto_id: renta, monto: 999 }); // otro año
    const merc = repo.guardarConcepto({ tipo: 'gasto_variable', nombre: 'Mercado', presupuestado: true, monto_estimado: 10 });
    repo.guardarMovimiento({ fecha: '2026-03-01', concepto_id: merc, monto: 500 });
    const r = repo.resumenAnual(2026);
    expect(r.meses).toHaveLength(12);
    expect(r.meses[0]).toMatchObject({ mes: 1, ingresos: 1000, gastos: 150, ahorro: 50, previsto: 110, saldoFinal: 800 - 999 });
    expect(r.meses[1]).toMatchObject({ gastos: 100, saldoFinal: 800 - 999 + 900 });
    expect(r.meses[2].gastos).toBe(500);
    expect(r.total).toMatchObject({ ingresos: 2000, gastos: 750, ahorro: 50, previsto: 1320 });
    expect(r.grupos).toEqual([['Sin grupo', 500], ['Hogar', 250]]);
    expect(r.excedidos).toEqual([{ nombre: 'Mercado', previsto: 120, ejecutado: 500, exceso: 380 }]);
  });

  it('cajas de ahorro: saldo, validaciones, tasas y estimación del mes', () => {
    const caja = repo.guardarCaja({ nombre: 'Cajita viaje', banco: 'Nu' });
    repo.guardarCajaMov({ caja_id: caja, fecha: '2026-09-10', tipo: 'aporte', monto: 1_000_000 });
    repo.guardarCajaMov({ caja_id: caja, fecha: '2026-09-20', tipo: 'retiro', monto: 200_000 });
    repo.guardarCajaMov({ caja_id: caja, fecha: '2026-09-30', tipo: 'rendimiento', monto: 5_000 });
    expect(repo.cajas()[0]).toMatchObject({ aportes: 1_000_000, retiros: 200_000, rendimientos: 5_000, saldo: 805_000 });
    expect(() => repo.guardarCajaMov({ caja_id: caja, fecha: '2026-09-30', tipo: 'aporte', monto: 0 })).toThrow(/mayor que cero/);
    expect(() => repo.guardarCajaMov({ caja_id: caja, fecha: '2026-09-30', tipo: 'otro', monto: 1 })).toThrow(/no válido/);
    expect(() => repo.guardarCajaTasa({ caja_id: caja, desde: '2026-01-01', tasa_ea: 11.25 })).toThrow(/entre 0 y 100/);

    expect(repo.estimarCajaMes(caja, 2026, 10)).toMatchObject({ sinTasa: true, rendimiento: 0, saldoInicial: 805_000 });
    repo.guardarCajaTasa({ caja_id: caja, desde: '2026-04-09', tasa_ea: 0.1125, verificada: '2026-10-01' });
    const e = repo.estimarCajaMes(caja, 2026, 10);
    expect(e.sinTasa).toBe(false);
    expect(e.rendimiento).toBeCloseTo(805_000 * (1.1125 ** (31 / 365) - 1), 0);
    repo.guardarCajaMov({ caja_id: caja, fecha: '2026-10-31', tipo: 'rendimiento', monto: 7_000 });
    expect(repo.estimarCajaMes(caja, 2026, 10).registrado).toBe(7_000);

    expect(() => repo.eliminarCaja(caja)).toThrow(/baja/);
    repo.guardarCaja({ id: caja, nombre: 'Cajita viaje', banco: 'Nu', activo: false });
    expect(repo.cajas()).toHaveLength(0);
    expect(repo.cajas(false)).toHaveLength(1);
  });

  describe('autopréstamos', () => {
    let a, b;
    beforeEach(() => {
      a = repo.guardarCaja({ nombre: 'Emergencias' });
      b = repo.guardarCaja({ nombre: 'Viaje' });
      repo.guardarCajaMov({ caja_id: a, fecha: '2026-01-10', tipo: 'aporte', monto: 3_000_000 });
      repo.guardarCajaMov({ caja_id: b, fecha: '2026-01-10', tipo: 'aporte', monto: 1_000_000 });
    });
    const crear = (extra = {}) => repo.crearAutoprestamo({
      nombre: 'Carro', origenes: [{ caja_id: a, monto: 600_000 }, { caja_id: b, monto: 400_000 }],
      tasa_mensual: 0.01, plazo: 4, fecha_inicio: '2026-10-01', primera: '2026-11-05', ...extra,
    });

    it('desembolso: retira de cada caja, genera cuotas y valida el saldo', () => {
      expect(() => crear({ origenes: [{ caja_id: b, monto: 2_000_000 }] })).toThrow(/solo tiene/);
      expect(repo.cajas().find((c) => c.id === a).saldo).toBe(3_000_000); // la validación no dejó nada a medias
      const id = crear();
      expect(repo.cajas().find((c) => c.id === a).saldo).toBe(2_400_000);
      expect(repo.cajas().find((c) => c.id === b).saldo).toBe(600_000);
      const q = repo.cuotasPrestamo(id);
      expect(q).toHaveLength(4);
      expect(q.map((x) => x.vencimiento)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05', '2027-02-05']);
      expect(q.reduce((t, x) => t + x.capital, 0)).toBe(1_000_000);
      const p = repo.autoprestamos()[0];
      expect(p).toMatchObject({ n_cuotas: 4, pagadas: 0, capital_pendiente: 1_000_000, proxima: '2026-11-05', ultima: '2027-02-05' });
      expect(repo.conceptos().find((c) => c.id === p.concepto_id)).toMatchObject({ nombre: 'Autopréstamo Carro', grupo: 'Deudas' });
    });

    it('las cuotas del mes son el previsto del concepto', () => {
      const id = crear();
      const concepto = repo.autoprestamos()[0].concepto_id;
      const [q1] = repo.cuotasPrestamo(id);
      const prev = (m) => repo.gastosMes(2026, m).find((f) => f.id === concepto).previsto;
      expect([prev(10), prev(11), prev(2)]).toEqual([0, q1.valor, 0].map((v, i) => (i === 2 ? 0 : v)));
    });

    it('pagar cuotas: un movimiento; el capital vuelve a las cajas en proporción y el interés va a la caja de ganancias', () => {
      const id = crear();
      const [q1, q2] = repo.cuotasPrestamo(id);
      const r = repo.pagarCuotasPrestamo({ prestamo_id: id, ids: [q1.id], fecha: '2026-11-05', nota: 'Cuota 1' });
      expect(r.total).toBe(q1.valor);
      expect(repo.movimientosMes(2026, 11)).toMatchObject([{ monto: q1.valor, concepto: 'Autopréstamo Carro' }]);
      const gan = repo.cajas().find((c) => c.nombre === 'Ganancias autopréstamos');
      expect(gan).toMatchObject({ saldo: q1.interes, aportes: q1.interes });
      expect(repo.cajaMovs(gan.id)).toMatchObject([{ tipo: 'aporte', monto: q1.interes, nota: expect.stringContaining('Interés cuota 1/4') }]);
      const delCapital = [a, b].flatMap((c) => repo.cajaMovs(c).filter((m) => m.cuota_id));
      expect(delCapital.reduce((t, m) => t + m.monto, 0)).toBe(q1.capital);          // solo capital vuelve a las cajas de origen
      expect(repo.cajaMovs(a).find((m) => m.cuota_id).monto).toBe(Math.round(q1.capital * 0.6));
      expect(repo.cajaMovs(a).find((m) => m.cuota_id).nota).toMatch(/^Capital/);
      expect(repo.cajaGanancias()).toBe(gan.id);                                      // se reutiliza, no se crea otra
      expect(() => repo.pagarCuotasPrestamo({ prestamo_id: id, ids: [q1.id], fecha: '2026-11-06' })).toThrow(/ya fue pagada/);

      const ctrl = repo.prestamosPorCaja().find((c) => c.caja_id === a);
      expect(ctrl.prestado).toBe(600_000);
      expect(ctrl.devuelto).toBeCloseTo(0.6 * q1.capital, 5);
      expect(ctrl.pendiente).toBeCloseTo(600_000 - 0.6 * q1.capital, 5);
      expect(ctrl.interesCobrado).toBeCloseTo(0.6 * q1.interes, 5);
      expect(ctrl.termina).toBe('2027-02-05');
      expect(q2.numero).toBe(2);
    });

    it('pagar todas cierra el préstamo y su concepto; quitar un pago lo reabre y quita los aportes', () => {
      const id = crear();
      const ids = repo.cuotasPrestamo(id).map((q) => q.id);
      const { movimiento } = repo.pagarCuotasPrestamo({ prestamo_id: id, ids, fecha: '2026-11-05' });
      const p = repo.autoprestamos()[0];
      expect(p).toMatchObject({ estado: 'pagado', pagadas: 4 });
      expect(repo.conceptos().find((c) => c.id === p.concepto_id).activo).toBe(0);
      expect(repo.prestamosPorCaja()[0].termina).toBeNull();
      // las cajas de origen recuperan solo el capital; todo el interés queda en la caja de ganancias
      expect(Math.abs(repo.cajas().find((c) => c.id === a).saldo - 3_000_000)).toBeLessThan(5);
      expect(Math.abs(repo.cajas().find((c) => c.id === b).saldo - 1_000_000)).toBeLessThan(5);
      const ganId = repo.cajaGanancias();
      expect(repo.cajas().find((c) => c.id === ganId).saldo).toBe(repo.cuotasPrestamo(id).reduce((t, q) => t + q.interes, 0));

      repo.eliminarMovimiento(movimiento);
      expect(repo.autoprestamos()[0]).toMatchObject({ estado: 'activo', pagadas: 0 });
      expect(repo.conceptos().find((c) => c.id === p.concepto_id).activo).toBe(1);
      expect(repo.cajas().find((c) => c.id === a).saldo).toBe(2_400_000);
      expect(repo.cajas().find((c) => c.id === ganId).saldo).toBe(0); // también se revirtió el interés
    });

    it('un préstamo sin interés no crea la caja de ganancias', () => {
      const id = crear({ tasa_mensual: 0 });
      repo.pagarCuotasPrestamo({ prestamo_id: id, ids: [repo.cuotasPrestamo(id)[0].id], fecha: '2026-11-05' });
      expect(repo.cajas(false).find((c) => c.nombre === 'Ganancias autopréstamos')).toBeUndefined();
    });

    it('cambiar la tasa recalcula solo las cuotas pendientes', () => {
      const id = crear({ tasa_mensual: 0.01 });
      const [q1] = repo.cuotasPrestamo(id);
      repo.pagarCuotasPrestamo({ prestamo_id: id, ids: [q1.id], fecha: '2026-11-05' });
      repo.cambiarTasaAutoprestamo(id, 0.03);
      const q = repo.cuotasPrestamo(id);
      expect(q[0]).toMatchObject({ capital: q1.capital, interes: q1.interes, valor: q1.valor }); // lo pagado no cambia
      const pend = q.slice(1);
      expect(pend.reduce((t, x) => t + x.capital, 0)).toBe(1_000_000 - q1.capital);
      expect(pend[0].interes).toBe(Math.round((1_000_000 - q1.capital) * 0.03));
      expect(pend.map((x) => x.vencimiento)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
      expect(repo.autoprestamos()[0].tasa_mensual).toBe(0.03);
      repo.cambiarTasaAutoprestamo(id, 0);
      expect(repo.cuotasPrestamo(id).slice(1).every((x) => x.interes === 0)).toBe(true);
      expect(() => repo.cambiarTasaAutoprestamo(id, 1.5)).toThrow(/no es válido/);
    });

    it('proyección y pago del mes de varios préstamos: un movimiento por préstamo, todo o nada', () => {
      const cuentaA = repo.guardarCuenta({ nombre: 'Banco A' }), cuentaB = repo.guardarCuenta({ nombre: 'Banco B' });
      const p1 = crear({ nombre: 'Carro', cuenta_id: cuentaA });
      const p2 = repo.crearAutoprestamo({ nombre: 'Viaje', origenes: [{ caja_id: b, monto: 200_000 }], tasa_mensual: 0.01, plazo: 2, fecha_inicio: '2026-10-01', primera: '2026-11-20', cuenta_id: cuentaB });
      const proy = repo.proyeccionPagosPrestamos();
      const nov = proy.find((m) => m.clave === '2026-11');
      expect(nov).toMatchObject({ n: 2, estado: expect.stringMatching(/pendiente|vencido/) });
      expect(nov.cuotas.map((c) => c.nombre)).toEqual(['Carro', 'Viaje']);
      expect(proy.at(-1).saldoDespues).toBe(0);

      // un id inexistente en el segundo préstamo: no debe quedar pagado el primero
      const c1 = repo.cuotasPrestamo(p1)[0], v1 = repo.cuotasPrestamo(p2)[0];
      expect(() => repo.pagarCuotasPrestamos({ fecha: '2026-11-05', pagos: [{ prestamo_id: p1, ids: [c1.id] }, { prestamo_id: p2, ids: [99999] }] })).toThrow(/ya fue pagada/);
      expect(repo.movimientosMes(2026, 11)).toHaveLength(0);
      expect(repo.autoprestamos().every((p) => p.pagadas === 0)).toBe(true);

      const r = repo.pagarCuotasPrestamos({ fecha: '2026-11-05', pagos: [{ prestamo_id: p1, ids: [c1.id], cuenta_id: cuentaA }, { prestamo_id: p2, ids: [v1.id], cuenta_id: cuentaB }] });
      expect(r.total).toBe(c1.valor + v1.valor);
      expect(repo.movimientosMes(2026, 11).map((m) => [m.concepto, m.cuenta]).sort()).toEqual([['Autopréstamo Carro', 'Banco A'], ['Autopréstamo Viaje', 'Banco B']]);
      expect(repo.proyeccionPagosPrestamos().find((m) => m.clave === '2026-11')).toMatchObject({ estado: 'pagado', porPagar: 0 });
      // deshacer uno solo reabre solo ese préstamo
      repo.eliminarMovimiento(r.movimientos[1]);
      expect(repo.autoprestamos().map((p) => [p.nombre, p.pagadas]).sort()).toEqual([['Carro', 1], ['Viaje', 0]]);
    });

    it('eliminar un préstamo sin pagos devuelve el desembolso; con pagos no se deja', () => {
      const id = crear();
      const [q1] = repo.cuotasPrestamo(id);
      const { movimiento } = repo.pagarCuotasPrestamo({ prestamo_id: id, ids: [q1.id], fecha: '2026-11-05' });
      expect(() => repo.eliminarAutoprestamo(id)).toThrow(/cuotas pagadas/);
      repo.eliminarMovimiento(movimiento);
      repo.eliminarAutoprestamo(id);
      expect(repo.autoprestamos()).toHaveLength(0);
      expect(repo.cajas().find((c) => c.id === a).saldo).toBe(3_000_000);
      expect(repo.conceptos().filter((c) => c.nombre.startsWith('Autopréstamo'))).toHaveLength(0);
    });
  });

  it('borrarTodo deja la base vacía, con los grupos base, y se puede volver a usar', () => {
    const ana = repo.crearPersona('Ana');
    const cuenta = repo.guardarCuenta({ nombre: 'Banco', persona_id: ana });
    const sueldo = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo', presupuestado: true, monto_estimado: 100 });
    const gasto = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Arriendo' });
    repo.guardarIngreso({ anio: 2026, mes: 10, quincena: 1, concepto_id: sueldo, clase: 'sueldo', monto: 1000, cuenta_id: cuenta });
    repo.guardarMovimiento({ fecha: '2026-10-05', concepto_id: gasto, monto: 50, cuenta_id: cuenta });
    repo.guardarAjuste(2026, 10, gasto, 70);
    repo.guardarSaldoAnterior(2026, 10, 10);
    const t = repo.crearTarjeta({ nombre: 'Visa' });
    repo.guardarCompra({ tarjeta_id: t, fecha: '2026-10-03', descripcion: 'X', monto: 90, num_cuotas: 3 });
    const caja = repo.guardarCaja({ nombre: 'Cajita' });
    repo.guardarCajaMov({ caja_id: caja, fecha: '2026-10-01', tipo: 'aporte', monto: 5000 });
    repo.guardarCajaTasa({ caja_id: caja, desde: '2026-01-01', tasa_ea: 0.1 });
    const p = repo.crearAutoprestamo({ nombre: 'Carro', origenes: [{ caja_id: caja, monto: 1000 }], tasa_mensual: 0.02, plazo: 2, fecha_inicio: '2026-10-01' });
    repo.pagarCuotasPrestamo({ prestamo_id: p, ids: [repo.cuotasPrestamo(p)[0].id], fecha: '2026-10-05' });

    repo.borrarTodo();

    const tablas = ['personas', 'cuentas', 'conceptos', 'ingresos', 'movimientos', 'presupuesto', 'saldos_mes', 'tarjetas', 'compras_tarjeta', 'cuotas_tarjeta',
      'cajas_ahorro', 'cajas_movs', 'cajas_tasas', 'autoprestamos', 'autoprestamos_origen', 'cuotas', 'cuentas_saldos', 'config', 'compras_cubre'];
    for (const n of tablas) expect(get(`SELECT COUNT(*) AS n FROM ${n}`).n, n).toBe(0);
    expect(repo.grupos()).toEqual(['Deudas', 'Hogar']);
    expect(get('PRAGMA user_version').user_version).toBe(MIGRATIONS.length);
    // los contadores vuelven a 1 y todo sigue funcionando
    expect(repo.crearPersona('Nueva')).toBe(1);
    expect(repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Luz' })).toBe(1);
    expect(repo.cajaGanancias()).toBe(1);
    expect(repo.saldoAnterior(2026, 10)).toBe(0);
  });

  it('concepto cada 2 meses: solo presupuesta, proyecta y avisa en los meses que toca', () => {
    const luz = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Agua', presupuestado: true, monto_estimado: 80, fecha_pago: '2026-10-05', periodicidad: 'mensual', cada_meses: 2 });
    expect(repo.conceptos().find((c) => c.id === luz)).toMatchObject({ periodicidad: 'mensual', cada_meses: 2 });
    const prev = (a, m) => repo.gastosMes(a, m).find((f) => f.id === luz).previsto;
    expect([prev(2026, 8), prev(2026, 9), prev(2026, 10), prev(2026, 11), prev(2026, 12), prev(2027, 2), prev(2027, 3)]).toEqual([80, 0, 80, 0, 80, 80, 0]);
    expect(repo.proyeccion(2026, 10, 4).map((m) => m.gastos)).toEqual([80, 0, 80, 0]);
    expect(repo.resumenAnual(2026).meses.map((m) => m.previsto).filter(Boolean)).toEqual([80, 80, 80, 80, 80, 80]); // feb, abr, jun, ago, oct y dic
    // «Por pagar» solo en los meses que toca
    const pend = (m) => pendientesDePago(repo.gastosMes(2026, m), 2026, m, '2026-09-01').length;
    expect([pend(10), pend(11), pend(12)]).toEqual([1, 0, 1]);
    // un ajuste manual sigue mandando sobre la frecuencia
    repo.guardarAjuste(2026, 11, luz, 30);
    expect(prev(2026, 11)).toBe(30);
  });

  it('frecuencia mayor a mensual exige fecha de pago; las otras periodicidades ignoran cada_meses', () => {
    expect(() => repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Seguro', periodicidad: 'mensual', cada_meses: 3 })).toThrow(/fecha de pago/);
    expect(() => repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Seguro', fecha_pago: '2026-01-10', cada_meses: 13 })).toThrow(/entre 1 y 12/);
    const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Predial', fecha_pago: '2026-03-20', periodicidad: 'anual', cada_meses: 3 });
    expect(repo.conceptos().find((c) => c.id === id).cada_meses).toBe(1);
  });

  describe('conceptos que abonan a una caja de ahorro', () => {
    let viaje, casa, concepto;
    beforeEach(() => {
      viaje = repo.guardarCaja({ nombre: 'Viaje' });
      casa = repo.guardarCaja({ nombre: 'Casa' });
      concepto = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Ahorro viaje', categoria: 'Gasto', caja_id: viaje });
    });
    const movsCaja = (c) => repo.cajaMovs(c).filter((m) => m.movimiento_id);

    it('elegir caja fuerza la categoría Ahorro y la muestra con su nombre', () => {
      expect(repo.conceptos().find((c) => c.id === concepto)).toMatchObject({ categoria: 'Ahorro', caja_id: viaje, caja: 'Viaje' });
    });

    it('registrar el pago crea el aporte ligado; editarlo lo actualiza; quitarlo lo borra', () => {
      const id = repo.guardarMovimiento({ fecha: '2026-10-05', concepto_id: concepto, monto: 300_000 });
      expect(movsCaja(viaje)).toMatchObject([{ tipo: 'aporte', monto: 300_000, fecha: '2026-10-05', nota: 'Pago de «Ahorro viaje»', movimiento_id: id }]);
      expect(repo.cajas().find((c) => c.id === viaje).saldo).toBe(300_000);

      repo.guardarMovimiento({ id, fecha: '2026-10-07', concepto_id: concepto, monto: 350_000 });
      expect(movsCaja(viaje)).toHaveLength(1);
      expect(movsCaja(viaje)[0]).toMatchObject({ monto: 350_000, fecha: '2026-10-07' });

      repo.eliminarMovimiento(id);
      expect(movsCaja(viaje)).toHaveLength(0);
      expect(repo.cajas().find((c) => c.id === viaje).saldo).toBe(0);
    });

    it('un monto negativo es un retiro de la caja', () => {
      repo.guardarMovimiento({ fecha: '2026-10-05', concepto_id: concepto, monto: 100_000 });
      repo.guardarMovimiento({ fecha: '2026-10-06', concepto_id: concepto, monto: -40_000 });
      expect(repo.cajas().find((c) => c.id === viaje)).toMatchObject({ aportes: 100_000, retiros: 40_000, saldo: 60_000 });
    });

    it('cambiar el concepto del movimiento mueve el aporte de caja o lo quita', () => {
      const otro = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Ahorro casa', caja_id: casa });
      const sinCaja = repo.guardarConcepto({ tipo: 'gasto_variable', nombre: 'Mercado' });
      const id = repo.guardarMovimiento({ fecha: '2026-10-05', concepto_id: concepto, monto: 200_000 });
      repo.guardarMovimiento({ id, fecha: '2026-10-05', concepto_id: otro, monto: 200_000 });
      expect([movsCaja(viaje).length, movsCaja(casa).length]).toEqual([0, 1]);
      repo.guardarMovimiento({ id, fecha: '2026-10-05', concepto_id: sinCaja, monto: 200_000 });
      expect([movsCaja(viaje).length, movsCaja(casa).length]).toEqual([0, 0]);
    });

    it('un concepto sin caja no toca las cajas, y cambiar la caja del concepto no reescribe pagos anteriores', () => {
      const sinCaja = repo.guardarConcepto({ tipo: 'gasto_variable', nombre: 'Mercado' });
      repo.guardarMovimiento({ fecha: '2026-10-05', concepto_id: sinCaja, monto: 10 });
      expect(repo.cajaMovs(viaje)).toHaveLength(0);
      const id = repo.guardarMovimiento({ fecha: '2026-10-05', concepto_id: concepto, monto: 100 });
      repo.guardarConcepto({ id: concepto, tipo: 'gasto_fijo', nombre: 'Ahorro viaje', caja_id: casa });
      expect(movsCaja(viaje)).toHaveLength(1); // el pago viejo sigue en su caja
      repo.guardarMovimiento({ fecha: '2026-11-05', concepto_id: concepto, monto: 100 });
      expect(movsCaja(casa)).toHaveLength(1);   // los nuevos van a la nueva caja
      expect(id).toBeGreaterThan(0);
    });

    it('una caja con conceptos vinculados no se puede eliminar', () => {
      expect(() => repo.eliminarCaja(viaje)).toThrow(/baja/);
      expect(repo.cajaMovs(casa)).toHaveLength(0);
      repo.eliminarCaja(casa); // sin vínculos ni movimientos, sí
    });
  });

  describe('notas y baja por fecha', () => {
    const hoy = hoyISO();
    const mesHoy = hoy.slice(0, 7);
    const [A, M] = hoy.split('-').map(Number);
    const mesAntes = (n) => { const d = new Date(A, M - 1 - n, 1); return [d.getFullYear(), d.getMonth() + 1]; };

    it('guarda las notas (vacío = sin nota) y no cambia el estado si el formulario no lo envía', () => {
      const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Gym', notas: '  Plan anual, cobra el 5  ' });
      expect(repo.conceptos().find((c) => c.id === id).notas).toBe('Plan anual, cobra el 5');
      repo.darDeBaja(id);
      repo.guardarConcepto({ id, tipo: 'gasto_fijo', nombre: 'Gym', notas: '' });
      expect(repo.conceptos().find((c) => c.id === id)).toMatchObject({ notas: null, activo: 0 });
    });

    it('inactivar con fecha: el presupuesto de meses anteriores se conserva y desde ese mes no cuenta', () => {
      const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Gym', presupuestado: true, monto_estimado: 100 });
      const [a3, m3] = mesAntes(3), [a1, m1] = mesAntes(1);
      repo.guardarConcepto({ id, tipo: 'gasto_fijo', nombre: 'Gym', presupuestado: true, monto_estimado: 100, activo: false, fecha_baja: `${a1}-${String(m1).padStart(2, '0')}-10` });
      expect(repo.conceptos().find((c) => c.id === id)).toMatchObject({ activo: 0, fecha_baja: `${a1}-${String(m1).padStart(2, '0')}-10` });
      const prev = (a, m) => repo.presupuestoMes(a, m).find((f) => f.id === id)?.previsto;
      expect(prev(a3, m3)).toBe(100);          // el pasado conserva su presupuesto
      expect(prev(a1, m1)).toBeUndefined();    // desde el mes de la baja ya no cuenta
      expect(prev(A, M)).toBeUndefined();
      expect(repo.resumenAnual(A).total.previsto).toBeLessThan(100 * 12);
      expect(repo.proyeccion(A, M, 3).map((m) => m.gastos)).toEqual([0, 0, 0]);
    });

    it('un ajuste manual de un mes de baja se ignora, y los pagos del mes siguen apareciendo', () => {
      const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Gym', presupuestado: true, monto_estimado: 100 });
      repo.guardarAjuste(A, M, id, 300);
      repo.guardarMovimiento({ fecha: hoy, concepto_id: id, monto: 40 });
      repo.darDeBaja(id);
      const fila = repo.presupuestoMes(A, M).find((f) => f.id === id);
      expect(fila).toMatchObject({ previsto: 0, ejecutado: 40 });
      repo.reactivar(id);
      expect(repo.presupuestoMes(A, M).find((f) => f.id === id)).toMatchObject({ previsto: 300 });
    });

    it('no deja inactivar desde un mes futuro; reactivar desde el formulario limpia la fecha', () => {
      const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Gym' });
      const futuro = `${A + 1}-01-01`;
      expect(() => repo.guardarConcepto({ id, tipo: 'gasto_fijo', nombre: 'Gym', activo: false, fecha_baja: futuro })).toThrow(/futuro/);
      repo.guardarConcepto({ id, tipo: 'gasto_fijo', nombre: 'Gym', activo: false });
      expect(repo.conceptos().find((c) => c.id === id)).toMatchObject({ activo: 0, fecha_baja: hoy });
      repo.guardarConcepto({ id, tipo: 'gasto_fijo', nombre: 'Gym', activo: true });
      expect(repo.conceptos().find((c) => c.id === id)).toMatchObject({ activo: 1, fecha_baja: null });
      expect(mesHoy).toHaveLength(7);
    });

    it('deudaPendienteConcepto avisa de cuotas de tarjeta o préstamo sin pagar', () => {
      const t = repo.crearTarjeta({ nombre: 'Visa' });
      repo.guardarCompra({ tarjeta_id: t, fecha: hoy, descripcion: 'X', monto: 900, num_cuotas: 3 });
      const concepto = repo.tarjetas()[0].concepto_id;
      expect(repo.deudaPendienteConcepto(concepto)).toBe(900);
      expect(repo.deudaPendienteConcepto(repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Otro' }))).toBe(0);
    });

    it('al pagar todo un préstamo, su concepto sigue contando el mes del último pago', () => {
      const caja = repo.guardarCaja({ nombre: 'Caja' });
      repo.guardarCajaMov({ caja_id: caja, fecha: '2026-01-01', tipo: 'aporte', monto: 10_000 });
      const p = repo.crearAutoprestamo({ nombre: 'Mini', origenes: [{ caja_id: caja, monto: 1000 }], tasa_mensual: 0, plazo: 1, fecha_inicio: hoy, primera: hoy });
      repo.pagarCuotasPrestamo({ prestamo_id: p, ids: [repo.cuotasPrestamo(p)[0].id], fecha: hoy });
      const c = repo.conceptos().find((x) => x.nombre === 'Autopréstamo Mini');
      expect(c.activo).toBe(0);
      expect(repo.presupuestoMes(A, M).find((f) => f.id === c.id)).toMatchObject({ previsto: 1000, ejecutado: 1000 });
    });
  });

  describe('editar compras y tarjetas', () => {
    let t, concepto;
    beforeEach(() => {
      t = repo.crearTarjeta({ nombre: 'Visa' });
      concepto = repo.tarjetas()[0].concepto_id;
    });
    const compra = (extra = {}) => repo.guardarCompra({ tarjeta_id: t, fecha: '2026-10-03', descripcion: 'Nevera', monto: 900, num_cuotas: 3, ...extra });
    const cuotas = (id) => all('SELECT * FROM cuotas_tarjeta WHERE compra_id=? ORDER BY numero', [id]);
    const editar = (id, cambios) => repo.actualizarCompra({ id, fecha: '2026-10-03', descripcion: 'Nevera', monto: 900, num_cuotas: 3, tasa_mensual: 0, ...cambios });
    const pagar = (...ids) => repo.pagarCuotas({ ids, fecha: '2026-10-15', concepto_id: concepto });

    it('sin pagos: rehace el calendario, conserva los ids existentes y agrega o quita al final', () => {
      const id = compra();
      const antes = cuotas(id).map((q) => q.id);
      editar(id, { monto: 1200, num_cuotas: 4 });
      let q = cuotas(id);
      expect(q.map((x) => [x.numero, x.mes, x.valor])).toEqual([[1, 10, 300], [2, 11, 300], [3, 12, 300], [4, 1, 300]]);
      expect(q.slice(0, 3).map((x) => x.id)).toEqual(antes);   // los ids no cambian
      expect(repo.tarjetas()[0].pendiente).toBe(1200);
      editar(id, { monto: 1200, num_cuotas: 2 });
      expect(cuotas(id)).toHaveLength(2);
      expect(cuotas(id).map((x) => x.valor)).toEqual([600, 600]);
      editar(id, { monto: 1000, num_cuotas: 2, descripcion: 'Nevera LG', primera: '2027-02-10' });
      q = cuotas(id);
      expect(q.map((x) => [x.anio, x.mes])).toEqual([[2027, 2], [2027, 3]]);
      expect(repo.comprasTarjeta(t)[0]).toMatchObject({ descripcion: 'Nevera LG', monto: 1000, num_cuotas: 2 });
    });

    it('con pagos: lo pagado no cambia y solo se recalculan las pendientes', () => {
      const id = compra();
      const [c1] = cuotas(id);
      pagar(c1.id);
      editar(id, { monto: 1200 });                       // faltan 1200 − 300 = 900 en 2 cuotas
      const q = cuotas(id);
      expect(q[0]).toMatchObject({ id: c1.id, valor: 300, movimiento_id: expect.any(Number) });
      expect(q.slice(1).map((x) => x.valor)).toEqual([450, 450]);
      expect(repo.tarjetas()[0].pendiente).toBe(900);

      editar(id, { monto: 1200, num_cuotas: 5 });        // 4 pendientes de 225
      expect(cuotas(id).map((x) => x.valor)).toEqual([300, 225, 225, 225, 225]);
      expect(cuotas(id).map((x) => x.numero)).toEqual([1, 2, 3, 4, 5]);
      expect(cuotas(id).map((x) => x.mes)).toEqual([10, 11, 12, 1, 2]);
    });

    it('con pagos, cambiar la tasa afecta solo lo que falta', () => {
      const id = compra({ tasa_mensual: 0.02 });
      const [c1] = cuotas(id);
      pagar(c1.id);
      editar(id, { tasa_mensual: 0.05 });
      const q = cuotas(id);
      expect(q[0]).toMatchObject({ capital: c1.capital, interes: c1.interes, valor: c1.valor });
      const resto = 900 - c1.capital;
      expect(q[1].interes).toBe(Math.round(resto * 0.05));
      expect(q.slice(1).reduce((t2, x) => t2 + x.capital, 0)).toBe(resto);
    });

    it('rechaza montos y cuotas que contradicen lo ya pagado, sin cambiar nada', () => {
      const id = compra();
      const q = cuotas(id);
      pagar(q[0].id, q[1].id);                           // 600 pagados
      expect(() => editar(id, { monto: 600 })).toThrow(/mayor que el capital ya pagado/);
      expect(() => editar(id, { monto: 900, num_cuotas: 2 })).toThrow(/más que las ya pagadas/);
      expect(() => editar(id, { monto: 0 })).toThrow(/mayor que cero/);
      expect(() => editar(id, { tasa_mensual: 2 })).toThrow(/no es válido/);
      expect(comprasOk(id)).toBe(true);
    });
    const comprasOk = (id) => repo.comprasTarjeta(t)[0].monto === 900 && cuotas(id).length === 3;

    it('una cuota pagada fuera de orden no genera dos cuotas en el mismo mes', () => {
      const id = compra();
      pagar(cuotas(id)[2].id);                            // pagó la #3 (diciembre)
      editar(id, { monto: 900, num_cuotas: 4 });          // quedan 3 pendientes sobre 600
      const meses = cuotas(id).map((x) => `${x.anio}-${x.mes}`);
      expect(new Set(meses).size).toBe(meses.length);
      expect(cuotas(id).map((x) => x.numero)).toEqual([1, 2, 3, 4]);
    });

    it('el presupuesto del concepto de la tarjeta toma las cuotas nuevas', () => {
      const id = compra();
      const prev = (m) => repo.gastosMes(2026, m).find((f) => f.id === concepto).previsto;
      expect([prev(10), prev(11)]).toEqual([300, 300]);
      editar(id, { monto: 1500, num_cuotas: 3 });
      expect([prev(10), prev(11), prev(12)]).toEqual([500, 500, 500]);
    });

    it('editar la tarjeta renombra su concepto y actualiza fecha de pago y cuenta', () => {
      const cuenta = repo.guardarCuenta({ nombre: 'Banco' });
      repo.actualizarTarjeta({ id: t, nombre: 'Visa Gold', cuenta_id: cuenta, fecha_pago: '2026-10-20' });
      expect(repo.tarjetas()[0]).toMatchObject({ nombre: 'Visa Gold', cuenta_id: cuenta });
      expect(repo.conceptos().find((c) => c.id === concepto)).toMatchObject({ nombre: 'Tarjeta Visa Gold', fecha_pago: '2026-10-20', dia_pago: 20 });
      repo.actualizarTarjeta({ id: t, nombre: 'Visa Gold', cuenta_id: null, fecha_pago: '' });
      expect(repo.conceptos().find((c) => c.id === concepto)).toMatchObject({ fecha_pago: null, dia_pago: null });
    });
  });

  describe('conceptos quincenales', () => {
    it('presupuesta el doble, proyecta y suma en el resumen; los pagos descuentan pendientes', () => {
      const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Empleada', presupuestado: true, monto_estimado: 300, periodicidad: 'mensual', cada_meses: 1, quincenal: 1 });
      expect(repo.conceptos().find((c) => c.id === id)).toMatchObject({ quincenal: 1, cada_meses: 1, fecha_pago: null });
      const prev = (m) => repo.gastosMes(2026, m).find((f) => f.id === id).previsto;
      expect([prev(10), prev(11), prev(2)]).toEqual([600, 600, 600]);
      expect(repo.proyeccion(2026, 10, 2).map((m) => m.gastos)).toEqual([600, 600]);
      expect(repo.resumenAnual(2026).total.previsto).toBe(600 * 12);
      const pend = () => pendientesDePago(repo.gastosMes(2026, 10), 2026, 10, '2026-10-01').filter((p) => p.id === id).map((p) => [p.vence, p.monto_pago]);
      expect(pend()).toEqual([['2026-10-15', 300], ['2026-10-31', 300]]);
      repo.guardarMovimiento({ fecha: '2026-10-15', concepto_id: id, monto: 300 });
      expect(pend()).toEqual([['2026-10-31', 300]]);
      repo.guardarMovimiento({ fecha: '2026-10-30', concepto_id: id, monto: 300 });
      expect(pend()).toEqual([]);
      expect(repo.presupuestoMes(2026, 10).find((f) => f.id === id)).toMatchObject({ previsto: 600, ejecutado: 600 });
    });

    it('un ingreso quincenal presupuesta el doble', () => {
      const id = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo', presupuestado: true, monto_estimado: 2_500_000, quincenal: 1 });
      expect(repo.presupuestoIngresosMes(2026, 10).find((f) => f.id === id).previsto).toBe(5_000_000);
      expect(repo.proyeccion(2026, 10, 1)[0].ingresos).toBe(5_000_000);
    });

    it('no se combina con «cada N meses» y se ignora en otras periodicidades', () => {
      expect(() => repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'X', fecha_pago: '2026-01-10', cada_meses: 2, quincenal: 1 })).toThrow(/no se combina/);
      const id = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Predial', fecha_pago: '2026-03-20', periodicidad: 'anual', quincenal: 1 });
      expect(repo.conceptos().find((c) => c.id === id).quincenal).toBe(0);
    });
  });

  describe('compras de tarjeta que cubren uno o varios conceptos', () => {
    let t, internet, agua;
    beforeEach(() => {
      t = repo.crearTarjeta({ nombre: 'Visa' });
      internet = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Internet', presupuestado: true, monto_estimado: 100, fecha_pago: '2026-01-15' });
      agua = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Agua', presupuestado: true, monto_estimado: 50, fecha_pago: '2026-01-20' });
    });
    const fila = (c, m) => repo.gastosMes(2026, m).find((f) => f.id === c);
    const pend = (c, m) => pendientesDePago(repo.gastosMes(2026, m), 2026, m, '2026-10-01').filter((p) => p.id === c).map((p) => p.monto_pago);
    const compra = (monto, cubre, extra = {}) => repo.guardarCompra({ tarjeta_id: t, fecha: '2026-10-03', descripcion: 'X', monto, num_cuotas: 1, cubre, ...extra });

    it('una cuota que vence en el mes cubre el concepto: baja el previsto y deja de estar pendiente', () => {
      expect([fila(internet, 10).previsto, pend(internet, 10)]).toEqual([100, [100]]);
      compra(100, [{ concepto_id: internet, monto: 100 }]);
      expect(fila(internet, 10)).toMatchObject({ previsto: 0, cubierto: 100 });
      expect(pend(internet, 10)).toEqual([]);
      expect(pend(internet, 11)).toEqual([100]);
      const tarjeta = repo.tarjetas()[0].concepto_id;
      expect(fila(tarjeta, 10).previsto).toBe(100);
      expect(repo.resumenPresupuesto(2026, 10).previsto).toBe(100 + 50);   // Internet 0 + Agua 50 + Tarjeta 100
    });

    it('una compra cubre varios conceptos, cada uno con su parte', () => {
      compra(120, [{ concepto_id: internet, monto: 90 }, { concepto_id: agua, monto: 30 }]);
      expect([fila(internet, 10).previsto, fila(agua, 10).previsto]).toEqual([10, 20]);
      expect([pend(internet, 10), pend(agua, 10)]).toEqual([[10], [20]]);
      const c = repo.comprasTarjeta(t)[0];
      expect(c.cubre.map((x) => [x.nombre, x.monto])).toEqual([['Agua', 30], ['Internet', 90]]);
    });

    it('con cuotas e intereses cada concepto cubre su proporción de cada cuota', () => {
      repo.guardarCompra({ tarjeta_id: t, fecha: '2026-10-03', descripcion: 'Financiada', monto: 1000, num_cuotas: 2, tasa_mensual: 0.02,
        cubre: [{ concepto_id: internet, monto: 750 }, { concepto_id: agua, monto: 250 }] });
      const q1 = repo.cuotasPendientes(t)[0].valor;
      expect(fila(internet, 10).cubierto).toBeCloseTo(q1 * 0.75, 6);
      expect(fila(agua, 10).cubierto).toBeCloseTo(q1 * 0.25, 6);
      expect(fila(internet, 10).cubierto + fila(agua, 10).cubierto).toBeCloseTo(q1, 6);
    });

    it('varias compras sobre el mismo concepto se suman, y cubrir en parte deja el saldo', () => {
      compra(60, [{ concepto_id: internet, monto: 60 }]);
      expect([fila(internet, 10).previsto, pend(internet, 10)]).toEqual([40, [40]]);
      compra(30, [{ concepto_id: internet, monto: 30 }]);
      expect(fila(internet, 10).previsto).toBe(10);
    });

    it('editar reemplaza los vínculos; sin `cubre` los conserva; quitar la compra los deshace', () => {
      const id = compra(100, [{ concepto_id: internet, monto: 100 }]);
      const base = { id, fecha: '2026-10-03', descripcion: 'X', num_cuotas: 1, tasa_mensual: 0 };
      repo.actualizarCompra({ ...base, monto: 100 });                                   // no toca los vínculos
      expect(fila(internet, 10).previsto).toBe(0);
      repo.actualizarCompra({ ...base, monto: 100, cubre: [{ concepto_id: agua, monto: 40 }] });
      expect([fila(internet, 10).previsto, fila(agua, 10).previsto]).toEqual([100, 10]);
      repo.actualizarCompra({ ...base, monto: 100, cubre: [] });
      expect(fila(agua, 10).previsto).toBe(50);
      repo.actualizarCompra({ ...base, monto: 100, cubre: [{ concepto_id: internet, monto: 100 }] });
      repo.eliminarCompra(id);
      expect(fila(internet, 10).previsto).toBe(100);
      expect(get('SELECT COUNT(*) AS n FROM compras_cubre').n).toBe(0);                // se fueron con la compra
    });

    it('no deja pasar de lo asignado, repetir un concepto, montos vacíos ni conceptos no cubribles', () => {
      const quincenal = repo.guardarConcepto({ tipo: 'gasto_fijo', nombre: 'Empleada', quincenal: 1 });
      const ingreso = repo.guardarConcepto({ tipo: 'ingreso', nombre: 'Sueldo' });
      const deTarjeta = repo.tarjetas()[0].concepto_id;
      expect(() => compra(100, [{ concepto_id: internet, monto: 70 }, { concepto_id: agua, monto: 40 }])).toThrow(/superan el valor/);
      expect(() => compra(100, [{ concepto_id: internet, monto: 50 }, { concepto_id: internet, monto: 20 }])).toThrow(/dos veces/);
      expect(() => compra(100, [{ concepto_id: internet, monto: 0 }])).toThrow(/mayor que cero/);
      expect(() => compra(100, [{ concepto_id: internet }])).toThrow(/mayor que cero/);
      for (const concepto_id of [quincenal, ingreso, deTarjeta, 9999]) expect(() => compra(100, [{ concepto_id, monto: 10 }])).toThrow(/no se puede cubrir/);
      expect(repo.comprasTarjeta(t)).toHaveLength(0);                                   // nada quedó a medias
      expect(repo.conceptosCubribles().map((c) => c.nombre).sort()).toEqual(['Agua', 'Internet']);
      // bajar el valor de la compra por debajo de lo asignado se rechaza, con y sin reenviar los vínculos
      const id = compra(100, [{ concepto_id: internet, monto: 90 }]);
      const base = { id, fecha: '2026-10-03', descripcion: 'X', num_cuotas: 1, tasa_mensual: 0 };
      expect(() => repo.actualizarCompra({ ...base, monto: 80 })).toThrow(/no puede ser menor/);
      expect(() => repo.actualizarCompra({ ...base, monto: 80, cubre: [{ concepto_id: internet, monto: 90 }] })).toThrow(/superan el valor/);
      expect(repo.comprasTarjeta(t)[0]).toMatchObject({ monto: 100 });
    });

    it('un concepto vinculado no se elimina y conserva el vínculo aunque luego se inactive', () => {
      const id = compra(100, [{ concepto_id: internet, monto: 100 }]);
      expect(() => repo.eliminarConcepto(internet)).toThrow(/baja/);
      repo.darDeBaja(internet);
      const base = { id, fecha: '2026-10-03', descripcion: 'Y', num_cuotas: 1, tasa_mensual: 0, monto: 100 };
      expect(() => repo.actualizarCompra({ ...base, cubre: [{ concepto_id: internet, monto: 100 }] })).not.toThrow();
    });
  });
});
