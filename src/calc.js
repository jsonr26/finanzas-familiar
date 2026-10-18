// Lógica pura (sin DOM ni base de datos) para poder probarla.

export const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const cop = (n) => fmt.format(Math.round(n || 0));

/** Parsea "1.234.567,89" / "1234567.89" / "$ 1,234,567" a número. */
export function parseMonto(txt) {
  let s = String(txt ?? '').trim().replace(/[$\s]/g, '');
  if (!s) return NaN;
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma > -1 && punto > -1) {
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma > -1 || punto > -1) {
    const sep = coma > -1 ? ',' : '.';
    const partes = s.split(sep);
    // un único separador con exactamente 3 dígitos detrás es de miles
    s = partes.length > 2 || partes[1].length === 3 ? partes.join('') : partes.join('.');
  }
  return Number(s);
}

/** Neto = ingresos (sueldo, prima, otro) - descuentos. Los descuentos se almacenan positivos. */
export function neto(lineas) {
  let ingresos = 0, descuentos = 0;
  for (const l of lineas) (l.clase === 'descuento' ? (descuentos += l.monto) : (ingresos += l.monto));
  return { ingresos, descuentos, neto: ingresos - descuentos };
}

/** Agrupa lineas [{clave, monto}] sumando por clave. */
export function sumarPor(items, claveFn) {
  const m = new Map();
  for (const it of items) m.set(claveFn(it), (m.get(claveFn(it)) ?? 0) + it.monto);
  return m;
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const inicioMes = (anio, mes) => `${anio}-${pad2(mes)}-01`;
export const inicioMesSig = (anio, mes) => (mes === 12 ? `${anio + 1}-01-01` : inicioMes(anio, mes + 1));
export const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

/** Frecuencias que se ofrecen en Conceptos y cómo se guardan (periodicidad + cada_meses). */
export const FRECUENCIAS = {
  m1: 'Mensual', quincenal: 'Quincenal (15 y fin de mes)', m2: 'Cada 2 meses', m3: 'Cada 3 meses', m6: 'Cada 6 meses', anual: 'Anual', manual: 'Puntual (fecha única)',
};
export const frecuenciaDe = ({ periodicidad, cada_meses: cada, quincenal }) => (quincenal ? 'quincenal' : !periodicidad || periodicidad === 'mensual' ? `m${cada || 1}` : periodicidad);
export function desdeFrecuencia(clave) {
  if (clave === 'quincenal') return { periodicidad: 'mensual', cada_meses: 1, quincenal: 1 };
  const m = /^m(\d+)$/.exec(clave);
  return m ? { periodicidad: 'mensual', cada_meses: Number(m[1]), quincenal: 0 } : { periodicidad: clave, cada_meses: 1, quincenal: 0 };
}

/** Texto corto de cuándo vence un concepto según su periodicidad. */
export function describirPago({ fecha_pago: f, periodicidad: per, cada_meses: cada = 1, quincenal }) {
  if (quincenal) return '15 y último día de cada mes';
  if (!f) return '';
  const [a, m, d] = f.split('-').map(Number);
  if (per === 'mensual' && cada > 1) {
    // con divisores de 12 se listan los meses (oct, dic, feb…); con otros solo la frecuencia
    const meses = 12 % cada === 0
      ? ` (${Array.from({ length: 12 / cada }, (_, i) => MESES[(m - 1 + i * cada) % 12].slice(0, 3).toLowerCase()).join(', ')})` : '';
    return `día ${d} cada ${cada} meses${meses}`;
  }
  if (per === 'mensual') return `día ${d} de cada mes`;
  if (per === 'anual') return `${d} de ${MESES[m - 1].toLowerCase()} cada año`;
  return `${d} de ${MESES[m - 1].toLowerCase()} de ${a}`;
}

// --- Periodos y saldos -------------------------------------------------------------
export const claveMes = (anio, mes) => `${anio}-${pad2(mes)}`;
export const mesAnterior = (anio, mes) => (mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 });
const mesSiguiente = (anio, mes) => (mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 });
const diasDelMes = (anio, mes) => new Date(anio, mes, 0).getDate();

export function sumarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(a, m - 1, d + n);
  return `${f.getFullYear()}-${pad2(f.getMonth() + 1)}-${pad2(f.getDate())}`;
}

/**
 * Saldo con el que arranca un mes. Si hay un saldo escrito a mano para ese mes manda ese; si no,
 * se encadena desde el primer mes con datos: saldo + neto del mes - salidas (gastos y ahorro) del mes.
 * Los mapas usan claves 'AAAA-MM'; un saldo manual de un mes anterior también reinicia la cadena.
 */
export function saldoInicial({ neto = {}, gasto = {}, manual = {} }, anio, mes) {
  const objetivo = claveMes(anio, mes);
  if (manual[objetivo] !== undefined) return { valor: manual[objetivo], manual: true };
  const previas = [...Object.keys(neto), ...Object.keys(gasto), ...Object.keys(manual)].filter((k) => k < objetivo).sort();
  if (!previas.length) return { valor: 0, manual: false };
  let [a, m] = previas[0].split('-').map(Number);
  let saldo = 0;
  while (claveMes(a, m) < objetivo) {
    const k = claveMes(a, m);
    if (manual[k] !== undefined) saldo = manual[k];
    saldo += (neto[k] ?? 0) - (gasto[k] ?? 0);
    ({ anio: a, mes: m } = mesSiguiente(a, m));
  }
  return { valor: saldo, manual: false };
}

// --- Presupuesto ---------------------------------------------------------------------
/**
 * ¿El concepto se paga en ese mes según su periodicidad y fecha de referencia? Con `cada_meses` > 1 toca el mes
 * de fecha_pago y cada N meses desde él (también hacia atrás); sin fecha de referencia se trata como mensual.
 */
export function aplicaEnMes({ periodicidad, fecha_pago: f, cada_meses: cada = 1 }, anio, mes) {
  if (!periodicidad || periodicidad === 'mensual') {
    if (!(cada > 1) || !f) return true;
    const [a, m] = f.split('-').map(Number);
    return ((((anio * 12 + mes) - (a * 12 + m)) % cada) + cada) % cada === 0;
  }
  if (!f) return false;
  const [a, m] = f.split('-').map(Number);
  return periodicidad === 'anual' ? m === mes : a === anio && m === mes;
}

/**
 * ¿El concepto cuenta en ese mes? Uno dado de baja deja de contar desde el mes de `fecha_baja` en adelante (los
 * meses anteriores conservan su historia); si está inactivo sin fecha, no cuenta en ningún mes.
 */
export function activoEnMes({ activo, fecha_baja: baja }, anio, mes) {
  if (activo === undefined || activo === null || activo) return true;
  return !!baja && claveMes(anio, mes) < baja.slice(0, 7);
}

/** Monto previsto del mes: el ajuste de ese mes; si no, las cuotas de tarjeta que vencen ese mes; si no, el monto base cuando el concepto aplica. */
export function montoPrevisto(c, anio, mes) {
  if (!activoEnMes(c, anio, mes)) return 0;
  if (c.cuotas_mes !== null && c.cuotas_mes !== undefined && (c.ajuste === null || c.ajuste === undefined)) return c.cuotas_mes; // tarjeta o préstamo: cuotas que vencen en el mes
  const base = c.ajuste !== null && c.ajuste !== undefined ? c.ajuste
    : c.presupuestado && aplicaEnMes(c, anio, mes) ? (c.monto_estimado || 0) * (c.quincenal ? 2 : 1) : 0;
  // lo que ya cubren cuotas de tarjeta ligadas al concepto no se vuelve a contar: ese dinero está en «Tarjeta X»
  return Math.max(0, base - (c.cubierto_tarjeta || 0));
}

/** ok < 80 % · alerta 80–100 % · excedido > 100 % · sin = gastado sin presupuesto. En ahorro, llegar a la meta es lo bueno. */
export function estadoPresupuesto(previsto, ejecutado, categoria = 'Gasto') {
  if (!previsto) return ejecutado ? 'sin' : 'vacio';
  const p = ejecutado / previsto;
  if (categoria === 'Ahorro') return p >= 1 ? 'ok' : 'progreso';
  return p > 1 ? 'excedido' : p >= 0.8 ? 'alerta' : 'ok';
}

// --- Pendientes de pago ----------------------------------------------------------------
export function vencimientoEnMes(fechaPago, anio, mes) {
  const dia = Number(fechaPago.slice(8, 10));
  return `${anio}-${pad2(mes)}-${pad2(Math.min(dia, diasDelMes(anio, mes)))}`;
}

/**
 * Conceptos con fecha de pago que aún no tienen ningún movimiento en el mes, con su estado:
 * vencido (ya pasó), proximo (en 7 días o menos) o pendiente. Para meses pasados no se calcula,
 * porque el catálogo no guarda desde cuándo existe cada concepto.
 */
/** Conceptos del mes cuyo pago ya cubren (total o parcialmente) cuotas de tarjeta: [{nombre, cubierto}]. */
export const cubiertosConTarjeta = (filas, anio, mes) => filas
  .filter((f) => (f.cubierto_tarjeta || 0) > 0 && activoEnMes(f, anio, mes))
  .map((f) => ({ id: f.id, nombre: f.nombre, cubierto: f.cubierto_tarjeta }));

export function pendientesDePago(filas, anio, mes, hoy = hoyISO()) {
  if (claveMes(anio, mes) < hoy.slice(0, 7)) return [];
  const limite = sumarDias(hoy, 7);
  const estado = (vence) => (vence < hoy ? 'vencido' : vence <= limite ? 'proximo' : 'pendiente');
  const pagos = [];
  for (const f of filas) {
    if (!activoEnMes(f, anio, mes) || !aplicaEnMes(f, anio, mes)) continue;
    const previsto = f.previsto || 0;
    if (f.quincenal) {
      // dos pagos fijos (15 y último día); faltan 2 − movimientos del mes, siempre los últimos
      const fechas = [`${anio}-${pad2(mes)}-15`, `${anio}-${pad2(mes)}-${pad2(diasDelMes(anio, mes))}`];
      if (previsto <= 0) continue;
      fechas.slice(Math.min(f.n_mov, 2)).forEach((vence, i) => pagos.push({ ...f, vence, pago: Math.min(f.n_mov, 2) + i + 1, monto_pago: previsto / 2, estado: estado(vence) }));
    } else if (f.fecha_pago && f.n_mov === 0 && previsto > 0) { // previsto 0 (sin monto, ajuste de 0 o cubierto del todo con tarjeta): no hay nada que pagar
      const vence = vencimientoEnMes(f.fecha_pago, anio, mes);
      pagos.push({ ...f, vence, pago: 1, monto_pago: previsto, estado: estado(vence) });
    }
  }
  return pagos.sort((a, b) => a.vence.localeCompare(b.vence) || a.nombre.localeCompare(b.nombre));
}

/**
 * Encadena saldos: cada mes parte del saldo final del anterior.
 * meses: [{ ingresos, gastos, ahorro, ... }] → mismos objetos con saldoInicial y saldoFinal.
 */
export function proyectarMeses(inicial, meses) {
  let saldo = inicial;
  return meses.map((m) => {
    const saldoInicial = saldo;
    saldo = saldoInicial + m.ingresos - m.gastos - m.ahorro;
    return { ...m, saldoInicial, saldoFinal: saldo };
  });
}

/**
 * Calendario de cuotas de una compra con tarjeta (sistema francés: cuota fija, interés sobre saldo).
 * Con tasa 0 el capital se reparte parejo. Todo en pesos enteros; la última cuota absorbe el redondeo.
 * La primera cuota vence en (anio, mes) y las siguientes mes a mes.
 */
export function calendarioCuotas({ monto, cuotas, tasaMensual = 0, anio, mes }) {
  const n = Math.max(1, Math.round(cuotas));
  const r = tasaMensual;
  const fija = r > 0 ? Math.round((monto * r) / (1 - (1 + r) ** -n)) : Math.round(monto / n);
  let saldo = monto, a = anio, m = mes;
  const out = [];
  for (let k = 1; k <= n; k++) {
    const interes = Math.round(saldo * r);
    const capital = k === n ? saldo : Math.min(saldo, fija - interes);
    out.push({ numero: k, anio: a, mes: m, capital, interes, valor: capital + interes });
    saldo -= capital;
    ({ anio: a, mes: m } = mesSiguiente(a, m));
  }
  return out;
}

// --- Cajas de ahorro ---------------------------------------------------------------------
/** Tasa efectiva anual vigente en una fecha: la de la fila con `desde` más reciente que no pase de ella (o null). */
export function tasaVigente(tasas, fecha) {
  let vigente = null;
  for (const t of tasas) if (t.desde <= fecha && (!vigente || t.desde > vigente.desde)) vigente = t;
  return vigente ? vigente.tasa_ea : null;
}

/**
 * Rendimiento estimado entre `desde` (incluido) y `hasta` (excluido), con interés compuesto diario a la
 * tasa EA vigente cada día (como pagan las cajitas). Los flujos [{fecha, monto}] (aportes +, retiros −)
 * se aplican al comenzar su día. Es una estimación informativa: no descuenta impuestos ni redondeos del banco.
 * @returns {{rendimiento:number, saldoFinal:number, sinTasa:boolean}}
 */
export function estimarRendimiento({ saldo, flujos = [], tasas = [], desde, hasta }) {
  let s = saldo, ganado = 0, sinTasa = false;
  const porDia = new Map();
  for (const f of flujos) porDia.set(f.fecha, (porDia.get(f.fecha) ?? 0) + f.monto);
  for (let dia = desde; dia < hasta; dia = sumarDias(dia, 1)) {
    s += porDia.get(dia) ?? 0;
    const ea = tasaVigente(tasas, dia);
    if (ea === null) { sinTasa = true; continue; }
    const interes = s * ((1 + ea) ** (1 / 365) - 1);
    s += interes; ganado += interes;
  }
  return { rendimiento: ganado, saldoFinal: s, sinTasa };
}

/** Reparte `total` en pesos enteros proporcionalmente a `pesos`; la última parte absorbe el redondeo. */
export function repartir(total, pesos) {
  const suma = pesos.reduce((t, p) => t + p, 0);
  let acum = 0;
  return pesos.map((p, i) => {
    if (i === pesos.length - 1) return total - acum;
    const v = Math.round((total * p) / suma);
    acum += v;
    return v;
  });
}

// --- Tasas y formato de entrada ------------------------------------------------------------
/** Tasa efectiva anual (fracción) → mensual equivalente. */
export const eaAMensual = (ea) => (1 + ea) ** (1 / 12) - 1;
/** Tasa mensual (fracción) → efectiva anual equivalente. */
export const mensualAEa = (m) => (1 + m) ** 12 - 1;

/**
 * Da formato de miles (1.234.567) mientras se escribe un monto. El punto es separador de miles y la coma
 * es el decimal (máx. 2); admite un «-» inicial. Si pegan varias comas (1,234,567.5) se toman como miles.
 */
export function formatearEntrada(txt) {
  let t = String(txt ?? '');
  const neg = t.trim().startsWith('-');
  if ((t.match(/,/g) ?? []).length > 1) t = t.replace(/,/g, '').replace('.', ',');
  const [entero, ...dec] = t.replace(/[^\d,]/g, '').split(',');
  const miles = entero.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + (dec.length ? `${miles},${dec.join('').slice(0, 2)}` : miles);
}

// --- Proyección de pagos de autopréstamos -------------------------------------------------------
/**
 * Agrupa por mes las cuotas de los autopréstamos activos: cuántas vencen, capital, interés, total del mes, lo que
 * falta por pagar, cuántas están vencidas y el capital que queda pendiente DESPUÉS de ese mes (suponiendo pagado todo
 * lo anterior). Empieza en el mes actual o en el de la cuota pendiente más antigua (si es anterior).
 * cuotas: [{prestamo_id, nombre, numero, plazo, vencimiento, capital, interes, valor, pagada}]
 */
export function proyectarPagosPrestamos(cuotas, hoy = hoyISO()) {
  const pend = cuotas.filter((q) => !q.pagada);
  if (!pend.length) return [];
  const inicio = [hoy.slice(0, 7), ...pend.map((q) => q.vencimiento.slice(0, 7))].sort()[0];
  const porMes = new Map();
  for (const q of cuotas) {
    const k = q.vencimiento.slice(0, 7);
    if (k < inicio) continue;
    porMes.set(k, [...(porMes.get(k) ?? []), q]);
  }
  const suma = (lista, campo) => lista.reduce((t, q) => t + q[campo], 0);
  return [...porMes.keys()].sort().map((k) => {
    const lista = porMes.get(k).sort((a, b) => a.nombre.localeCompare(b.nombre) || a.numero - b.numero);
    const faltan = lista.filter((q) => !q.pagada);
    const vencidas = faltan.filter((q) => q.vencimiento < hoy).length;
    const [anio, mes] = k.split('-').map(Number);
    return {
      clave: k, anio, mes, cuotas: lista, n: lista.length, capital: suma(lista, 'capital'), interes: suma(lista, 'interes'), total: suma(lista, 'valor'),
      porPagar: suma(faltan, 'valor'), vencidas, estado: !faltan.length ? 'pagado' : vencidas ? 'vencido' : 'pendiente',
      saldoDespues: suma(pend.filter((q) => q.vencimiento.slice(0, 7) > k), 'capital'),
    };
  });
}

/** Cuotas pendientes que se pagan «el mes»: las de ese mes y, si se pide, también las vencidas de meses anteriores. */
export const seleccionarCuotasMes = (pendientes, clave, incluirVencidas = true) =>
  pendientes.filter((q) => (incluirVencidas ? q.vencimiento.slice(0, 7) <= clave : q.vencimiento.slice(0, 7) === clave));

/** Minúsculas y sin tildes, para buscar sin distinguir «Café» de «cafe». */
export const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** ¿El texto contiene todas las palabras de la consulta (en cualquier orden, sin importar tildes ni mayúsculas)? */
export function coincide(texto, consulta) {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return true;
  const t = normalizar(texto);
  return palabras.every((w) => t.includes(w));
}
