import { describe, it, expect } from 'vitest';
import {
  normalizar, coincide,
  neto, parseMonto, sumarPor, inicioMesSig, describirPago,
  saldoInicial, aplicaEnMes, montoPrevisto, estadoPresupuesto, pendientesDePago, mesAnterior, sumarDias, proyectarMeses, calendarioCuotas, tasaVigente, estimarRendimiento, repartir, proyectarPagosPrestamos, seleccionarCuotasMes, cubiertosConTarjeta, activoEnMes, frecuenciaDe, desdeFrecuencia, eaAMensual, mensualAEa, formatearEntrada,
} from '../src/calc.js';

describe('calc', () => {
  it('neto = ingresos - descuentos', () => {
    const r = neto([
      { clase: 'sueldo', monto: 6_500_000 },
      { clase: 'prima', monto: 1_000_000 },
      { clase: 'descuento', monto: 260_000 },
      { clase: 'descuento', monto: 260_000 },
    ]);
    expect(r).toEqual({ ingresos: 7_500_000, descuentos: 520_000, neto: 6_980_000 });
  });
  it.each([
    ['1.234.567,89', 1234567.89], ['1,234,567.89', 1234567.89], ['$ 264,300', 264300],
    ['264.300', 264300], ['12,5', 12.5], ['1500000', 1500000],
  ])('parseMonto(%s)', (txt, esperado) => expect(parseMonto(txt)).toBeCloseTo(esperado));
  it('parseMonto vacío es NaN', () => expect(parseMonto('')).toBeNaN());
  it('sumarPor agrupa', () => {
    const m = sumarPor([{ c: 'a', monto: 1 }, { c: 'b', monto: 2 }, { c: 'a', monto: 3 }], (x) => x.c);
    expect(m.get('a')).toBe(4);
  });
  it('inicioMesSig cruza de año', () => expect(inicioMesSig(2026, 12)).toBe('2027-01-01'));
  it('describirPago según periodicidad', () => {
    expect(describirPago({ fecha_pago: '2026-10-05', periodicidad: 'mensual' })).toBe('día 5 de cada mes');
    expect(describirPago({ fecha_pago: '2026-03-20', periodicidad: 'anual' })).toBe('20 de marzo cada año');
    expect(describirPago({ fecha_pago: '2026-12-01', periodicidad: 'manual' })).toBe('1 de diciembre de 2026');
    expect(describirPago({ fecha_pago: null, periodicidad: 'mensual' })).toBe('');
  });
});

describe('saldo inicial encadenado', () => {
  const datos = {
    neto: { '2026-08': 1000, '2026-09': 1000, '2026-11': 500 },
    gasto: { '2026-08': 400, '2026-09': 1200, '2026-10': 100 },
    manual: {},
  };
  it('sin datos previos arranca en cero', () => expect(saldoInicial(datos, 2026, 8)).toEqual({ valor: 0, manual: false }));
  it('arrastra el cierre de cada mes, incluso los meses sin movimiento', () => {
    expect(saldoInicial(datos, 2026, 9).valor).toBe(600);
    expect(saldoInicial(datos, 2026, 10).valor).toBe(400);
    expect(saldoInicial(datos, 2026, 11).valor).toBe(300);
    expect(saldoInicial(datos, 2027, 1).valor).toBe(800);
  });
  it('un saldo manual manda en su mes y reinicia la cadena hacia adelante', () => {
    const d = { ...datos, manual: { '2026-10': 5000 } };
    expect(saldoInicial(d, 2026, 10)).toEqual({ valor: 5000, manual: true });
    expect(saldoInicial(d, 2026, 11)).toEqual({ valor: 4900, manual: false });
    expect(saldoInicial(d, 2026, 9).valor).toBe(600);
  });
});

describe('presupuesto', () => {
  const mensual = { periodicidad: 'mensual', fecha_pago: '2026-01-05', presupuestado: 1, monto_estimado: 100 };
  it('aplicaEnMes según periodicidad', () => {
    expect(aplicaEnMes(mensual, 2027, 3)).toBe(true);
    const anual = { periodicidad: 'anual', fecha_pago: '2026-03-20' };
    expect(aplicaEnMes(anual, 2027, 3)).toBe(true);
    expect(aplicaEnMes(anual, 2027, 4)).toBe(false);
    const manual = { periodicidad: 'manual', fecha_pago: '2026-12-01' };
    expect(aplicaEnMes(manual, 2026, 12)).toBe(true);
    expect(aplicaEnMes(manual, 2027, 12)).toBe(false);
    expect(aplicaEnMes({ periodicidad: 'anual', fecha_pago: null }, 2026, 1)).toBe(false);
  });
  it('el ajuste del mes (incluso 0) manda sobre el monto base', () => {
    expect(montoPrevisto({ ...mensual, ajuste: null }, 2026, 10)).toBe(100);
    expect(montoPrevisto({ ...mensual, ajuste: 250 }, 2026, 10)).toBe(250);
    expect(montoPrevisto({ ...mensual, ajuste: 0 }, 2026, 10)).toBe(0);
    expect(montoPrevisto({ ...mensual, presupuestado: 0, ajuste: null }, 2026, 10)).toBe(0);
    expect(montoPrevisto({ periodicidad: 'anual', fecha_pago: '2026-03-20', presupuestado: 1, monto_estimado: 900 }, 2026, 10)).toBe(0);
  });
  it('estadoPresupuesto: semáforo y ahorro', () => {
    expect(estadoPresupuesto(100, 50)).toBe('ok');
    expect(estadoPresupuesto(100, 80)).toBe('alerta');
    expect(estadoPresupuesto(100, 100)).toBe('alerta');
    expect(estadoPresupuesto(100, 101)).toBe('excedido');
    expect(estadoPresupuesto(0, 30)).toBe('sin');
    expect(estadoPresupuesto(0, 0)).toBe('vacio');
    expect(estadoPresupuesto(100, 50, 'Ahorro')).toBe('progreso');
    expect(estadoPresupuesto(100, 150, 'Ahorro')).toBe('ok');
  });
});

describe('pendientes de pago', () => {
  const base = { activo: 1, n_mov: 0, periodicidad: 'mensual', nombre: 'X', previsto: 100 };
  const filas = [
    { ...base, id: 1, nombre: 'Arriendo', fecha_pago: '2026-01-05' },
    { ...base, id: 2, nombre: 'Internet', fecha_pago: '2026-01-17' },
    { ...base, id: 3, nombre: 'Gas', fecha_pago: '2026-01-12' },
    { ...base, id: 4, nombre: 'Luz', fecha_pago: '2026-01-31' },
    { ...base, id: 5, nombre: 'Pagado', fecha_pago: '2026-01-02', n_mov: 1 },
    { ...base, id: 6, nombre: 'Baja', fecha_pago: '2026-01-02', activo: 0 },
    { ...base, id: 7, nombre: 'Sin fecha', fecha_pago: null },
  ];
  it('clasifica vencidos, próximos y pendientes, ordenados por fecha', () => {
    const r = pendientesDePago(filas, 2026, 10, '2026-10-10');
    expect(r.map((x) => [x.nombre, x.vence, x.estado])).toEqual([
      ['Arriendo', '2026-10-05', 'vencido'],
      ['Gas', '2026-10-12', 'proximo'],
      ['Internet', '2026-10-17', 'proximo'],
      ['Luz', '2026-10-31', 'pendiente'],
    ]);
  });
  it('el día 31 se ajusta al último día de un mes corto', () => {
    expect(pendientesDePago([{ ...base, id: 1, fecha_pago: '2026-01-31' }], 2027, 2, '2027-02-01')[0].vence).toBe('2027-02-28');
  });
  it('meses pasados no se calculan; meses futuros sí', () => {
    expect(pendientesDePago(filas, 2026, 9, '2026-10-10')).toEqual([]);
    expect(pendientesDePago(filas, 2026, 11, '2026-10-10').every((x) => x.estado === 'pendiente' || x.estado === 'proximo')).toBe(true);
  });
  it('mesAnterior y sumarDias cruzan de año', () => {
    expect(mesAnterior(2026, 1)).toEqual({ anio: 2025, mes: 12 });
    expect(sumarDias('2026-12-28', 7)).toBe('2027-01-04');
  });
});

describe('proyección', () => {
  it('encadena el saldo final de cada mes con el inicial del siguiente', () => {
    const r = proyectarMeses(100, [{ ingresos: 50, gastos: 30, ahorro: 10 }, { ingresos: 50, gastos: 80, ahorro: 0 }]);
    expect(r.map((m) => [m.saldoInicial, m.saldoFinal])).toEqual([[100, 110], [110, 80]]);
  });
});

describe('calendario de cuotas', () => {
  it('sin interés reparte parejo y la última cuota absorbe el redondeo', () => {
    const q = calendarioCuotas({ monto: 1000, cuotas: 3, anio: 2026, mes: 11 });
    expect(q.map((c) => [c.anio, c.mes, c.valor])).toEqual([[2026, 11, 333], [2026, 12, 333], [2027, 1, 334]]);
    expect(q.every((c) => c.interes === 0)).toBe(true);
  });
  it('con interés: cuota fija, interés sobre saldo y capital total = monto', () => {
    const q = calendarioCuotas({ monto: 1_200_000, cuotas: 12, tasaMensual: 0.02, anio: 2026, mes: 1 });
    expect(q).toHaveLength(12);
    expect(q[0].interes).toBe(24_000);
    expect(q[0].valor).toBe(113_472); // PMT de 1.2M al 2 % a 12 meses
    expect(q.reduce((s, c) => s + c.capital, 0)).toBe(1_200_000);
    expect(q.every((c) => c.valor === c.capital + c.interes)).toBe(true);
    expect(Math.abs(q[11].valor - q[10].valor)).toBeLessThan(15);
  });
  it('una cuota es el monto completo', () => {
    expect(calendarioCuotas({ monto: 50_000, cuotas: 1, tasaMensual: 0.03, anio: 2026, mes: 5 })[0]).toMatchObject({ capital: 50_000, interes: 1500, valor: 51_500 });
  });
});

describe('cajas de ahorro', () => {
  const tasas = [{ desde: '2026-01-01', tasa_ea: 0.10 }, { desde: '2026-04-09', tasa_ea: 0.1125 }];
  it('tasaVigente toma la más reciente que no pase de la fecha', () => {
    expect(tasaVigente(tasas, '2025-12-31')).toBeNull();
    expect(tasaVigente(tasas, '2026-04-08')).toBe(0.10);
    expect(tasaVigente(tasas, '2026-04-09')).toBe(0.1125);
  });
  it('un año completo a una tasa EA rinde exactamente esa tasa', () => {
    const r = estimarRendimiento({ saldo: 1_000_000, tasas: [{ desde: '2026-01-01', tasa_ea: 0.12 }], desde: '2026-01-01', hasta: '2027-01-01' });
    expect(r.rendimiento).toBeCloseTo(120_000, 0);
    expect(r.sinTasa).toBe(false);
  });
  it('los aportes rinden desde su día y los retiros dejan de rendir', () => {
    const una = [{ desde: '2026-01-01', tasa_ea: 0.12 }];
    const base = estimarRendimiento({ saldo: 1000, tasas: una, desde: '2026-01-01', hasta: '2026-01-31' }).rendimiento;
    const conAporte = estimarRendimiento({ saldo: 1000, flujos: [{ fecha: '2026-01-16', monto: 1000 }], tasas: una, desde: '2026-01-01', hasta: '2026-01-31' }).rendimiento;
    const conRetiro = estimarRendimiento({ saldo: 1000, flujos: [{ fecha: '2026-01-16', monto: -1000 }], tasas: una, desde: '2026-01-01', hasta: '2026-01-31' }).rendimiento;
    expect(conAporte).toBeGreaterThan(base);
    expect(conRetiro).toBeLessThan(base);
    expect(conRetiro).toBeGreaterThan(base * 0.45);
  });
  it('sin tasa vigente no estima y lo avisa', () => {
    expect(estimarRendimiento({ saldo: 1000, tasas: [], desde: '2026-01-01', hasta: '2026-02-01' })).toMatchObject({ rendimiento: 0, sinTasa: true });
  });
});

describe('repartir', () => {
  it('reparte proporcionalmente y la suma siempre da el total', () => {
    expect(repartir(100, [1, 1])).toEqual([50, 50]);
    const r = repartir(100, [1, 1, 1]);
    expect(r).toEqual([33, 33, 34]);
    expect(repartir(1000, [600, 400])).toEqual([600, 400]);
    expect(repartir(7, [3, 3, 3]).reduce((a, b) => a + b, 0)).toBe(7);
  });
});

describe('tasas y formato de entrada', () => {
  it('convierte entre efectiva anual y mensual', () => {
    expect(eaAMensual(0.2859)).toBeCloseTo(0.021176, 5);
    expect(mensualAEa(eaAMensual(0.2859))).toBeCloseTo(0.2859, 10);
  });
  it.each([
    ['1234567', '1.234.567'], ['1.234.567', '1.234.567'], ['12', '12'], ['1000,5', '1.000,5'], ['1000,567', '1.000,56'],
    ['', ''], ['abc', ''], ['-2500000', '-2.500.000'], ['007', '7'], ['1,234,567.5', '1.234.567,5'], ['1234,', '1.234,'],
  ])('formatearEntrada(%s)', (entrada, esperado) => expect(formatearEntrada(entrada)).toBe(esperado));
  it('lo formateado se vuelve a leer igual', () => {
    expect(parseMonto(formatearEntrada('3500000'))).toBe(3500000);
    expect(parseMonto(formatearEntrada('1234567,5'))).toBeCloseTo(1234567.5);
    expect(parseMonto(formatearEntrada('999'))).toBe(999);
  });
});

describe('concepto cada N meses', () => {
  const bimestral = { periodicidad: 'mensual', cada_meses: 2, fecha_pago: '2026-10-05' };
  it('aplicaEnMes alterna desde el mes de referencia, hacia adelante, atrás y cruzando de año', () => {
    const toca = (a, m) => aplicaEnMes(bimestral, a, m);
    expect([toca(2026, 10), toca(2026, 11), toca(2026, 12), toca(2027, 1), toca(2027, 2)]).toEqual([true, false, true, false, true]);
    expect([toca(2026, 8), toca(2026, 9), toca(2025, 12), toca(2025, 11)]).toEqual([true, false, true, false]);
    expect(aplicaEnMes({ ...bimestral, cada_meses: 3 }, 2027, 1)).toBe(true);
    expect(aplicaEnMes({ ...bimestral, cada_meses: 6 }, 2027, 4)).toBe(true);
    expect(aplicaEnMes({ ...bimestral, cada_meses: 6 }, 2027, 3)).toBe(false);
    expect(aplicaEnMes({ periodicidad: 'mensual', cada_meses: 1 }, 2027, 3)).toBe(true);
    expect(aplicaEnMes({ periodicidad: 'mensual', cada_meses: 2, fecha_pago: null }, 2027, 3)).toBe(true); // sin referencia: mensual
  });
  it('describirPago lista los meses de pago', () => {
    expect(describirPago(bimestral)).toBe('día 5 cada 2 meses (oct, dic, feb, abr, jun, ago)');
    expect(describirPago({ ...bimestral, cada_meses: 6 })).toBe('día 5 cada 6 meses (oct, abr)');
    expect(describirPago({ ...bimestral, cada_meses: 5 })).toBe('día 5 cada 5 meses');
    expect(describirPago({ ...bimestral, cada_meses: 1 })).toBe('día 5 de cada mes');
  });
  it('frecuencia ↔ periodicidad + cada_meses', () => {
    expect(desdeFrecuencia('m2')).toEqual({ periodicidad: 'mensual', cada_meses: 2, quincenal: 0 });
    expect(desdeFrecuencia('anual')).toEqual({ periodicidad: 'anual', cada_meses: 1, quincenal: 0 });
    expect(frecuenciaDe({ periodicidad: 'mensual', cada_meses: 3 })).toBe('m3');
    expect(frecuenciaDe({ periodicidad: 'manual', cada_meses: 1 })).toBe('manual');
    expect(frecuenciaDe({})).toBe('m1');
  });
});

describe('concepto inactivo por fecha', () => {
  const baja = { activo: 0, fecha_baja: '2026-10-16', presupuestado: 1, monto_estimado: 100, periodicidad: 'mensual' };
  it('activoEnMes: cuenta hasta el mes anterior al de la baja', () => {
    expect([activoEnMes(baja, 2026, 9), activoEnMes(baja, 2026, 10), activoEnMes(baja, 2026, 11), activoEnMes(baja, 2027, 1)]).toEqual([true, false, false, false]);
    expect(activoEnMes({ activo: 1 }, 2030, 1)).toBe(true);
    expect(activoEnMes({}, 2030, 1)).toBe(true);                                // filas sin el dato se tratan como activas
    expect(activoEnMes({ activo: 0, fecha_baja: null }, 2020, 1)).toBe(false);  // inactivo sin fecha: en ningún mes
  });
  it('el monto previsto es 0 desde el mes de la baja, incluso con ajuste; antes se conserva', () => {
    expect(montoPrevisto({ ...baja, ajuste: null }, 2026, 9)).toBe(100);
    expect(montoPrevisto({ ...baja, ajuste: null }, 2026, 10)).toBe(0);
    expect(montoPrevisto({ ...baja, ajuste: 500 }, 2026, 11)).toBe(0);
  });
  it('un concepto dado de baja no sale en «Por pagar» desde su mes', () => {
    const fila = { ...baja, id: 1, nombre: 'Gym', fecha_pago: '2026-01-05', n_mov: 0, previsto: 100 };
    expect(pendientesDePago([fila], 2026, 10, '2026-10-01')).toEqual([]);
    expect(pendientesDePago([{ ...fila, activo: 1 }], 2026, 10, '2026-10-01')).toHaveLength(1);
  });
});

describe('concepto quincenal (15 y fin de mes)', () => {
  const base = { id: 1, nombre: 'Empleada', activo: 1, quincenal: 1, periodicidad: 'mensual', cada_meses: 1, previsto: 200, n_mov: 0 };
  it('frecuencia ↔ quincenal y descripción', () => {
    expect(desdeFrecuencia('quincenal')).toEqual({ periodicidad: 'mensual', cada_meses: 1, quincenal: 1 });
    expect(frecuenciaDe({ periodicidad: 'mensual', cada_meses: 1, quincenal: 1 })).toBe('quincenal');
    expect(describirPago({ quincenal: 1, periodicidad: 'mensual', fecha_pago: null })).toBe('15 y último día de cada mes');
  });
  it('el previsto es el doble del monto de cada pago', () => {
    const c = { periodicidad: 'mensual', presupuestado: 1, monto_estimado: 100 };
    expect(montoPrevisto({ ...c, quincenal: 1, ajuste: null }, 2026, 10)).toBe(200);
    expect(montoPrevisto({ ...c, quincenal: 0, ajuste: null }, 2026, 10)).toBe(100);
    expect(montoPrevisto({ ...c, quincenal: 1, ajuste: 150 }, 2026, 10)).toBe(150); // el ajuste es el total del mes
  });
  it('Por pagar: faltan 2 − movimientos del mes, con vencimiento el 15 y el último día', () => {
    const p = (n_mov, mes = 10, hoy = '2026-10-01') => pendientesDePago([{ ...base, n_mov }], 2026, mes, hoy).map((x) => [x.vence, x.pago, x.monto_pago]);
    expect(p(0)).toEqual([['2026-10-15', 1, 100], ['2026-10-31', 2, 100]]);
    expect(p(1)).toEqual([['2026-10-31', 2, 100]]);
    expect(p(2)).toEqual([]);
    expect(p(3)).toEqual([]);
    expect(p(0, 2, '2026-02-01').map((x) => x[0])).toEqual(['2026-02-15', '2026-02-28']);
    expect(pendientesDePago([{ ...base }], 2028, 2, '2028-02-01').map((x) => x.vence)).toEqual(['2028-02-15', '2028-02-29']);
    expect(p(0, 11, '2026-10-01').map((x) => x[0])).toEqual(['2026-11-15', '2026-11-30']);
  });
  it('estados por pago y no necesita fecha_pago', () => {
    const r = pendientesDePago([{ ...base, fecha_pago: null }], 2026, 10, '2026-10-12');
    expect(r.map((x) => x.estado)).toEqual(['proximo', 'pendiente']);
    expect(pendientesDePago([{ ...base }], 2026, 10, '2026-10-20').map((x) => x.estado)).toEqual(['vencido', 'pendiente']);
  });
  it('un quincenal inactivo desde el mes no aparece; uno no quincenal sigue como antes', () => {
    expect(pendientesDePago([{ ...base, activo: 0, fecha_baja: '2026-10-05' }], 2026, 10, '2026-10-01')).toEqual([]);
    const normal = { ...base, quincenal: 0, fecha_pago: '2026-01-20', previsto: 80 };
    expect(pendientesDePago([normal], 2026, 10, '2026-10-01').map((x) => [x.vence, x.pago, x.monto_pago])).toEqual([['2026-10-20', 1, 80]]);
  });
});

describe('proyección de pagos de autopréstamos', () => {
  const q = (nombre, numero, vencimiento, capital, interes, pagada = false) => ({ prestamo_id: nombre, nombre, numero, plazo: 3, vencimiento, capital, interes, valor: capital + interes, pagada });
  const cuotas = [
    q('Carro', 1, '2026-09-05', 100, 10, true), q('Carro', 2, '2026-10-05', 100, 8), q('Carro', 3, '2026-11-05', 100, 4),
    q('Viaje', 1, '2026-10-20', 50, 5), q('Viaje', 2, '2026-11-20', 50, 2),
  ];
  const hoy = '2026-10-10';
  it('agrupa por mes, parte del mes actual (o de la cuota vencida más antigua) y calcula el saldo posterior', () => {
    const r = proyectarPagosPrestamos(cuotas, hoy);
    expect(r.map((m) => m.clave)).toEqual(['2026-10', '2026-11']);                // septiembre ya está pagado y es anterior
    expect(r[0]).toMatchObject({ n: 2, capital: 150, interes: 13, total: 163, porPagar: 163, vencidas: 1, estado: 'vencido', saldoDespues: 150 });
    expect(r[1]).toMatchObject({ n: 2, total: 156, estado: 'pendiente', saldoDespues: 0, vencidas: 0 });
    expect(r[0].cuotas.map((c) => c.nombre)).toEqual(['Carro', 'Viaje']);
  });
  it('un mes atrasado sin pagar aparece como vencido aunque sea anterior al actual', () => {
    const r = proyectarPagosPrestamos([q('Carro', 1, '2026-08-05', 100, 10), q('Carro', 2, '2026-10-05', 100, 8)], hoy);
    expect(r.map((m) => [m.clave, m.estado])).toEqual([['2026-08', 'vencido'], ['2026-10', 'vencido']]);
  });
  it('el mes con todo pagado figura como pagado, y sin pendientes no hay proyección', () => {
    const pagado = cuotas.map((c) => (c.vencimiento.startsWith('2026-10') ? { ...c, pagada: true } : c));
    expect(proyectarPagosPrestamos(pagado, hoy)[0]).toMatchObject({ clave: '2026-10', estado: 'pagado', porPagar: 0, total: 163 });
    expect(proyectarPagosPrestamos(cuotas.map((c) => ({ ...c, pagada: true })), hoy)).toEqual([]);
  });
  it('seleccionarCuotasMes: solo el mes o también lo vencido de meses anteriores', () => {
    const pend = cuotas.filter((c) => !c.pagada);
    expect(seleccionarCuotasMes(pend, '2026-11', false).map((c) => c.numero)).toEqual([3, 2]);
    expect(seleccionarCuotasMes(pend, '2026-10', true)).toHaveLength(2);
    expect(seleccionarCuotasMes(pend, '2026-11', true)).toHaveLength(4);
    expect(seleccionarCuotasMes(pend, '2026-09', true)).toEqual([]);
  });
});

describe('conceptos cubiertos con tarjeta', () => {
  const c = { periodicidad: 'mensual', presupuestado: 1, monto_estimado: 100, quincenal: 0 };
  it('el previsto baja por lo que cubren las cuotas, sin pasar de cero', () => {
    expect(montoPrevisto({ ...c, cubierto_tarjeta: 40 }, 2026, 10)).toBe(60);
    expect(montoPrevisto({ ...c, cubierto_tarjeta: 100 }, 2026, 10)).toBe(0);
    expect(montoPrevisto({ ...c, cubierto_tarjeta: 250 }, 2026, 10)).toBe(0);
    expect(montoPrevisto({ ...c, cubierto_tarjeta: null }, 2026, 10)).toBe(100);
    expect(montoPrevisto({ ...c, ajuste: 300, cubierto_tarjeta: 100 }, 2026, 10)).toBe(200); // también sobre un ajuste manual
  });
  it('Por pagar: cubierto del todo no es pendiente; cubierto en parte queda con el saldo', () => {
    const fila = { id: 1, nombre: 'Internet', activo: 1, periodicidad: 'mensual', cada_meses: 1, quincenal: 0, fecha_pago: '2026-01-15', n_mov: 0 };
    const con = (cubierto_tarjeta, previsto) => pendientesDePago([{ ...fila, cubierto_tarjeta, previsto }], 2026, 10, '2026-10-01').map((p) => p.monto_pago);
    expect(con(0, 100)).toEqual([100]);
    expect(con(40, 60)).toEqual([60]);
    expect(con(100, 0)).toEqual([]);
    expect(con(null, 0)).toEqual([]);    // sin monto previsto no hay nada que pagar
  });
  it('Por pagar no muestra obligaciones con previsto 0 (sin monto, ajuste de 0 o quincenales en 0)', () => {
    const fila = { id: 1, nombre: 'Agua', activo: 1, periodicidad: 'mensual', cada_meses: 1, quincenal: 0, fecha_pago: '2026-01-15', n_mov: 0 };
    const lista = (extra) => pendientesDePago([{ ...fila, ...extra }], 2026, 10, '2026-10-01');
    expect(lista({ previsto: 0 })).toEqual([]);
    expect(lista({ previsto: undefined })).toEqual([]);
    expect(lista({ previsto: 50 })).toHaveLength(1);
    expect(lista({ quincenal: 1, previsto: 0 })).toEqual([]);
  });
  it('cubiertosConTarjeta lista solo lo cubierto en el mes y activo', () => {
    const filas = [{ id: 1, nombre: 'Internet', activo: 1, cubierto_tarjeta: 90 }, { id: 2, nombre: 'Luz', activo: 1, cubierto_tarjeta: 0 },
      { id: 3, nombre: 'Gym', activo: 0, fecha_baja: '2026-09-01', cubierto_tarjeta: 50 }];
    expect(cubiertosConTarjeta(filas, 2026, 10)).toEqual([{ id: 1, nombre: 'Internet', cubierto: 90 }]);
  });
});

describe('búsqueda de conceptos', () => {
  it('ignora tildes y mayúsculas', () => {
    expect(normalizar('Educación')).toBe('educacion');
    expect(coincide('Servicios · Energía', 'ENERGIA')).toBe(true);
  });
  it('exige todas las palabras, en cualquier orden', () => {
    expect(coincide('Servicios · Luz', 'luz serv')).toBe(true);
    expect(coincide('Servicios · Luz', 'luz agua')).toBe(false);
  });
  it('una consulta vacía deja pasar todo', () => {
    expect(coincide('Cualquier cosa', '   ')).toBe(true);
    expect(coincide('Cualquier cosa', '')).toBe(true);
  });
});
