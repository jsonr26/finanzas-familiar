import * as repo from '../repo.js';
import { cop, parseMonto, hoyISO, MESES, calendarioCuotas, vencimientoEnMes, eaAMensual, mensualAEa, claveMes, seleccionarCuotasMes } from '../calc.js';
import { NU_TARJETA } from '../referencias.js';
import { esc, el, formulario, confirmar, alerta, intentar } from '../ui.js';
import { periodo } from '../periodo.js';
import { PALETA } from '../colores.js';

const seleccion = new Set();   // cuotas marcadas para pagar (de cualquier préstamo)
const abiertos = new Set();    // préstamos con el calendario completo desplegado
let verTodaLaProyeccion = false;
let detalleId = null;         // préstamo cuyo detalle se está viendo (null = lista de tarjetas)
const colorDe = (p) => PALETA[repo.COLORES_TARJETA[p.id % repo.COLORES_TARJETA.length]];

const fechaCorta = (f) => { const [a, m, d] = f.split('-').map(Number); return `${d} ${MESES[m - 1].slice(0, 3).toLowerCase()} ${a}`; };
const mesesHasta = (f) => { const h = new Date(); const [a, m] = f.split('-').map(Number); return (a - h.getFullYear()) * 12 + (m - 1 - h.getMonth()); };
const cuentasOpc = () => repo.cuentas().map((c) => [c.id, c.nombre]);
const pctTxt = (f, dec = 2) => (f * 100).toFixed(dec).replace('.', ',');           // 0.0212 → «2,12»
const leerTasa = (txt) => { const t = parseMonto(txt || '0'); return Number.isFinite(t) ? t / 100 : NaN; };

/** Resumen en vivo de un calendario: cuota, intereses, total a pagar, última cuota y tasa efectiva anual equivalente. */
function resumenCalendario({ monto, cuotas, tasa, anio, mes, dia }) {
  if (!(monto > 0) || !(cuotas >= 1) || !(tasa >= 0 && tasa < 1) || !anio) return '';
  const q = calendarioCuotas({ monto, cuotas, tasaMensual: tasa, anio, mes });
  const intereses = q.reduce((t, c) => t + c.interes, 0);
  const ultima = q.at(-1);
  return `<dl><dt>Cuota</dt><dd>${cop(q[0].valor)}</dd><dt>Intereses totales</dt><dd>${cop(intereses)}</dd>
    <dt>Total a pagar</dt><dd>${cop(monto + intereses)}</dd><dt>Última cuota</dt><dd>${esc(fechaCorta(vencimientoEnMes(dia, ultima.anio, ultima.mes)))}</dd>
    <dt>Tasa efectiva anual</dt><dd>${pctTxt(mensualAEa(tasa))} %</dd></dl>`;
}

async function nuevo(rerender) {
  const cajas = repo.cajas().filter((c) => c.saldo > 0);
  if (!cajas.length) return alerta('Ninguna caja tiene saldo. Registra aportes en Cajas de ahorro antes de prestar de ellas.');
  const v = await formulario({
    titulo: 'Nuevo autopréstamo',
    campos: [
      { name: 'nombre', label: 'Para qué es (ej. Carro, Matrícula)', type: 'text', required: true },
      { name: 'fecha_inicio', label: 'Fecha del desembolso', type: 'date', value: hoyISO(), required: true },
      ...cajas.map((c) => ({ name: `caja_${c.id}`, label: `Presta «${c.nombre}» (saldo ${cop(c.saldo)})`, type: 'money', placeholder: '0' })),
      { name: 'tasa', label: 'Interés mensual (%) — lo que te pagas a ti mismo', type: 'decimal', value: pctTxt(eaAMensual(NU_TARJETA.ea)), required: true },
      { name: 'plazo', label: 'Número de cuotas', type: 'number', value: 12, min: 1, max: 120, required: true },
      { name: 'primera', label: 'Vence la 1ª cuota', type: 'date', value: hoyISO(), required: true },
      { name: 'cuenta_id', label: 'Cuenta desde la que se paga', type: 'select', options: cuentasOpc(), vacio: '—' },
    ],
    vistaPrevia: (v) => {
      const monto = cajas.reduce((t, c) => { const x = parseMonto(v[`caja_${c.id}`] || '0'); return t + (Number.isFinite(x) ? x : 0); }, 0);
      const [anio, mes] = (v.primera || '').split('-').map(Number);
      return resumenCalendario({ monto, cuotas: Number(v.plazo), tasa: leerTasa(v.tasa), anio, mes, dia: v.primera });
    },
    extra: `<p class="muted">Tasa de partida: la de la tarjeta de crédito de Nu (${pctTxt(NU_TARJETA.ea)} % EA ≈ ${pctTxt(eaAMensual(NU_TARJETA.ea))} % mensual;
      <a href="${NU_TARJETA.url}" target="_blank" rel="noopener">${esc(NU_TARJETA.fuente)}</a>). Cámbiala y el cálculo se actualiza al instante; confírmala en tu extracto.</p>
      <p class="muted">Se registra un retiro en cada caja y se crea el concepto «Autopréstamo …» (grupo Deudas) que recibe los pagos. Cada cuota pagada devuelve su parte (capital + interés) a cada caja.</p>`,
  });
  if (!v) return;
  await intentar(() => {
    const origenes = cajas.map((c) => ({ caja_id: c.id, monto: v[`caja_${c.id}`].trim() ? parseMonto(v[`caja_${c.id}`]) : 0 }));
    const tasa = leerTasa(v.tasa);
    if (origenes.some((o) => !Number.isFinite(o.monto) || o.monto < 0) || !Number.isFinite(tasa)) throw new Error('Montos o interés no válidos.');
    repo.crearAutoprestamo({ nombre: v.nombre, origenes, tasa_mensual: tasa, plazo: Number(v.plazo), fecha_inicio: v.fecha_inicio, primera: v.primera, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null });
    rerender();
  });
}

async function cambiarTasa(p, pendientes, rerender) {
  const saldo = pendientes.reduce((t, q) => t + q.capital, 0);
  const [anio, mes] = pendientes[0].vencimiento.split('-').map(Number);
  const v = await formulario({
    titulo: `Tasa de ${p.nombre}`,
    textoOk: 'Recalcular cuotas',
    campos: [{ name: 'tasa', label: 'Interés mensual (%)', type: 'decimal', value: pctTxt(p.tasa_mensual), required: true }],
    vistaPrevia: (x) => resumenCalendario({ monto: saldo, cuotas: pendientes.length, tasa: leerTasa(x.tasa), anio, mes, dia: pendientes[0].vencimiento }),
    extra: `<p class="muted">Se recalculan las ${pendientes.length} cuotas pendientes sobre el capital que falta (${cop(saldo)}). Lo ya pagado no cambia.</p>`,
  });
  if (!v) return;
  await intentar(() => {
    const t = leerTasa(v.tasa);
    if (!Number.isFinite(t)) throw new Error('Interés no válido.');
    repo.cambiarTasaAutoprestamo(p.id, t);
    rerender();
  });
}

async function pagar(p, pendientes, rerender) {
  const ids = pendientes.filter((q) => seleccion.has(q.id)).map((q) => q.id);
  const total = pendientes.filter((q) => seleccion.has(q.id)).reduce((s, q) => s + q.valor, 0);
  const v = await formulario({
    titulo: `Pagar ${p.nombre}`,
    textoOk: `Registrar pago de ${cop(total)}`,
    campos: [
      { name: 'fecha', label: 'Fecha del pago', type: 'date', value: hoyISO(), required: true },
      { name: 'cuenta_id', label: 'Sale de la cuenta', type: 'select', options: cuentasOpc(), vacio: '—', value: p.cuenta_id },
      { name: 'nota', label: 'Nota', type: 'text', value: `${p.nombre}: ${ids.length} cuota${ids.length === 1 ? '' : 's'}` },
    ],
    extra: (() => {
      const sel = pendientes.filter((q) => seleccion.has(q.id));
      const capital = sel.reduce((s, q) => s + q.capital, 0), interes = sel.reduce((s, q) => s + q.interes, 0);
      return `<p>Se registrará <b>un movimiento de ${cop(total)}</b>:</p>
        <p>• <b>${cop(capital)}</b> de capital vuelve a ${p.origenes.map((o) => `«${esc(o.caja)}»`).join(' y ')} en proporción a lo que prestó cada una.</p>
        ${interes ? `<p>• <b>${cop(interes)}</b> de interés va a la caja de ganancias («${esc(repo.gananciasActual()?.nombre ?? 'Ganancias autopréstamos')}»).</p>` : ''}`;
    })(),
  });
  if (!v) return;
  await intentar(() => {
    repo.pagarCuotasPrestamo({ prestamo_id: p.id, ids, fecha: v.fecha, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null, nota: v.nota });
    ids.forEach((id) => seleccion.delete(id));
    rerender();
  });
}

/**
 * Paga de una vez las cuotas de un mes de TODOS los autopréstamos activos (y, si se deja marcado, las vencidas de
 * meses anteriores). Todo viene preseleccionado: solo se confirma fecha y cuenta de cada préstamo (editables).
 */
export async function pagarMes(anio, mes, rerender) {
  const clave = claveMes(anio, mes);
  const pendientes = repo.cuotasDePrestamosActivos().filter((q) => !q.pagada);
  const candidatas = seleccionarCuotasMes(pendientes, clave, true);
  if (!candidatas.length) return alerta(`No hay cuotas de autopréstamos por pagar hasta ${MESES[mes - 1]} ${anio}.`);
  const hayVencidas = candidatas.some((q) => q.vencimiento.slice(0, 7) < clave);
  const elegidas = (v) => seleccionarCuotasMes(pendientes, clave, hayVencidas ? v.incluir : false);
  const prestamos = [...new Map(candidatas.map((q) => [q.prestamo_id, q])).values()];
  const agrupar = (lista) => [...lista.reduce((m, q) => m.set(q.prestamo_id, [...(m.get(q.prestamo_id) ?? []), q]), new Map())];
  const v = await formulario({
    titulo: `Pagar autopréstamos · ${MESES[mes - 1]} ${anio}`,
    textoOk: 'Registrar pagos',
    campos: [
      { name: 'fecha', label: 'Fecha del pago', type: 'date', value: hoyISO(), required: true },
      ...(hayVencidas ? [{ name: 'incluir', label: 'Incluir las cuotas vencidas de meses anteriores', type: 'checkbox', value: true }] : []),
      ...prestamos.map((q) => ({ name: `cuenta_${q.prestamo_id}`, label: `Sale de la cuenta · «${q.nombre}»`, type: 'select', options: cuentasOpc(), vacio: '—', value: q.cuenta_id })),
    ],
    vistaPrevia: (x) => {
      const lista = elegidas(x);
      if (!lista.length) return '<p class="muted">No hay cuotas seleccionadas.</p>';
      return `<dl>${agrupar(lista).map(([, qs]) => `<dt>${esc(qs[0].nombre)} · ${qs.length} cuota${qs.length === 1 ? '' : 's'} (${qs.map((q) => `${q.numero}/${q.plazo}`).join(', ')})</dt><dd>${cop(qs.reduce((t, q) => t + q.valor, 0))}</dd>`).join('')}
        <dt><b>Total</b> · un movimiento por préstamo</dt><dd>${cop(lista.reduce((t, q) => t + q.valor, 0))}</dd></dl>`;
    },
    extra: '<p class="muted">Cada préstamo registra su propio movimiento; el capital vuelve a las cajas que prestaron y el interés va a la caja de ganancias. Si algo falla, no se registra ninguno.</p>',
  });
  if (!v) return;
  await intentar(() => {
    const pagos = agrupar(elegidas(v)).map(([id, qs]) => ({ prestamo_id: id, ids: qs.map((q) => q.id), cuenta_id: v[`cuenta_${id}`] ? Number(v[`cuenta_${id}`]) : null }));
    repo.pagarCuotasPrestamos({ pagos, fecha: v.fecha });
    pagos.flatMap((p) => p.ids).forEach((i) => seleccion.delete(i));
    periodo.anio = Number(v.fecha.slice(0, 4)); periodo.mes = Number(v.fecha.slice(5, 7));
    rerender();
  });
}

const ESTADO_MES = { pagado: ['ingreso', 'Pagado ✓'], vencido: ['vencido', 'Vencido'], pendiente: ['aviso', 'Pendiente'] };

export default {
  titulo: 'Autopréstamos',
  icono: '🏦',
  render(main, { rerender }) {
    const prestamos = repo.autoprestamos().map((p) => ({ ...p, cuotas: repo.cuotasPrestamo(p.id) }));
    const porCaja = repo.prestamosPorCaja();
    for (const id of [...seleccion]) if (!prestamos.some((p) => p.cuotas.some((q) => q.id === id && !q.movimiento_id))) seleccion.delete(id);
    const activos = prestamos.filter((p) => p.estado === 'activo');
    const sum = (campo) => activos.reduce((s, p) => s + p[campo], 0);
    const termina = activos.map((p) => p.ultima).filter(Boolean).sort().at(-1);
    const hoy = hoyISO();
    const ganancias = repo.gananciasActual();
    const proy = repo.proyeccionPagosPrestamos();
    const hoyClave = hoy.slice(0, 7);
    const debeAhora = proy.filter((m) => m.clave <= hoyClave).reduce((t, m) => t + m.porPagar, 0);
    const vencido = proy.filter((m) => m.clave < hoyClave || m.vencidas).reduce((t, m) => t + (m.clave < hoyClave ? m.porPagar : m.cuotas.filter((q) => !q.pagada && q.vencimiento < hoy).reduce((s, q) => s + q.valor, 0)), 0);
    const filasProy = verTodaLaProyeccion ? proy : proy.slice(0, 24);
    const [aHoy, mHoy] = hoy.split('-').map(Number);
    if (detalleId !== null && !prestamos.some((p) => p.id === detalleId)) detalleId = null;
    const pagados = prestamos.filter((p) => p.estado !== 'activo');
    const sinAnio = (f) => fechaCorta(f).replace(/ \d{4}$/, '');
    /** La tarjeta del préstamo (o su miniatura para el detalle). Activos: lo que falta por devolver; pagados: lo prestado. */
    const dibujo = (p, mini = false) => {
      const vencidas = p.cuotas.filter((q) => !q.movimiento_id && q.vencimiento < hoy).length;
      const activo = p.estado === 'activo';
      if (mini) return `<div class="tj mini" style="--tj:${colorDe(p)}"><b>🏦 ${esc(p.nombre)}</b><span class="tj-num">${esc(p.origenes.map((o) => o.caja).join(' · '))}</span><span class="tj-deuda-mini">${cop(activo ? p.capital_pendiente : p.monto)}</span></div>`;
      const avance = p.n_cuotas ? Math.round((p.pagadas / p.n_cuotas) * 100) : 0;
      const tag = !activo ? '<span class="tj-tag verde">Pagado ✓</span>' : vencidas ? `<span class="tj-tag rojo">${vencidas} vencida${vencidas === 1 ? '' : 's'}</span>` : '';
      return `<div class="tj prestamo ${activo ? '' : 'pagado'}" style="--tj:${colorDe(p)}" data-abrir="${p.id}" role="button" tabindex="0" aria-label="Abrir el detalle de ${esc(p.nombre)}">
        ${tag}
        <div class="tj-top ${tag ? 'con-tag' : ''}"><span class="tj-ico">🏦</span><b>${esc(p.nombre)}</b></div>
        <div class="tj-de">Sale de: ${esc(p.origenes.map((o) => o.caja).join(' · '))}</div>
        <div class="tj-deuda"><small>${activo ? 'Falta por devolver' : 'Prestado'}</small><span>${cop(activo ? p.capital_pendiente : p.monto)}</span></div>
        <div class="tj-pie">${activo
          ? `<div><small>Cuota</small><b>${cop(p.cuota ?? 0)}</b></div>${p.proxima ? `<div><small>Próxima</small><b>${esc(sinAnio(p.proxima))}</b></div>` : ''}<div><small>Interés</small><b>${pctTxt(p.tasa_mensual)} % mes</b></div>`
          : `<div><small>Intereses pagados</small><b>${cop(p.interes_pagado)}</b></div>`}</div>
        <div class="tj-cupo" title="${avance} % pagado"><i style="width:${avance}%"></i></div>
        <div class="tj-avt">${p.pagadas} de ${p.n_cuotas} cuotas pagadas</div></div>`;
    };

    const prestamoHTML = (p) => {
      const pend = p.cuotas.filter((q) => !q.movimiento_id);
      const vencidas = pend.filter((q) => q.vencimiento < hoy).length;
      const avance = p.n_cuotas ? Math.round((p.pagadas / p.n_cuotas) * 100) : 0;
      const m = p.proxima ? mesesHasta(p.ultima) : null;
      return `<section class="card" data-p="${p.id}">
        <div class="tj-detalle">${dibujo(p, true)}
        <div class="kpis kpis-chicos">
          <div class="kpi"><small>Cuota</small><b>${cop(p.cuota ?? 0)}</b> <span class="muted">${p.pagadas}/${p.n_cuotas} pagadas</span></div>
          <div class="kpi gasto"><small>Falta por devolver (capital)</small><b>${cop(p.capital_pendiente)}</b></div>
          <div class="kpi"><small>Total por pagar (con interés)</small><b>${cop(p.valor_pendiente)}</b></div>
          <div class="kpi ahorro"><small>Termina de devolverse</small><b>${p.proxima ? esc(fechaCorta(p.ultima)) : '—'}</b> <span class="muted">${m === null ? '' : m <= 0 ? 'este mes' : `en ${m} mes${m === 1 ? '' : 'es'}`}</span></div>
        </div>
        <div class="tj-botones">${vencidas ? `<span class="tag vencido">${vencidas} vencida${vencidas === 1 ? '' : 's'}</span>` : ''}
          ${pend.length ? '<button class="secondary" data-edit data-tasa>Cambiar tasa</button>' : ''}
          ${p.pagadas ? '' : '<button class="link danger" data-edit data-eliminar>Eliminar</button>'}</div></div>
        <p class="muted">Desembolso ${esc(fechaCorta(p.fecha_inicio))} · ${cop(p.monto)} (${p.origenes.map((o) => `${esc(o.caja)} ${cop(o.monto)}`).join(' · ')}) · ${pctTxt(p.tasa_mensual)} % mensual (${pctTxt(mensualAEa(p.tasa_mensual))} % EA) · ${p.plazo} cuotas</p>
        <div class="progreso est-progreso"><i style="width:${avance}%"></i></div>
        ${pend.length ? `<div class="fila"><button class="link" data-hasta>Seleccionar vencidas</button><button class="link" data-ninguna>Quitar selección</button></div>
          <table><thead><tr><th></th><th>Vence</th><th>Cuota</th><th class="num">Capital</th><th class="num">Interés</th><th class="num">Valor</th></tr></thead>
          <tbody>${pend.slice(0, abiertos.has(p.id) ? undefined : 6).map((q) => `<tr class="${q.vencimiento < hoy ? 'vencida' : ''}">
            <td><input type="checkbox" data-q="${q.id}" ${seleccion.has(q.id) ? 'checked' : ''}></td><td>${esc(fechaCorta(q.vencimiento))}</td>
            <td><span class="chip">${q.numero}/${p.plazo}</span></td><td class="num">${cop(q.capital)}</td><td class="num">${q.interes ? cop(q.interes) : '—'}</td><td class="num"><b>${cop(q.valor)}</b></td></tr>`).join('')}</tbody></table>
          ${pend.length > 6 ? `<button class="link" data-mas>${abiertos.has(p.id) ? 'Ver menos' : `Ver las ${pend.length} cuotas pendientes`}</button>` : ''}
          <div class="barra-pago"><span>Seleccionado: <b data-suma>$ 0</b> <small class="muted" data-n></small></span><span class="sp"></span>
            <button class="primary" data-edit data-pagar disabled>Registrar pago</button></div>`
          : '<p class="muted">Sin cuotas pendientes. 🎉</p>'}
        ${p.pagadas ? `<details><summary>Cuotas pagadas (${p.pagadas})</summary><table><tbody>${p.cuotas.filter((q) => q.movimiento_id).map((q) => `<tr><td>${esc(q.fecha_pago_real)}</td>
          <td><span class="chip">${q.numero}/${p.plazo}</span></td><td class="num">${cop(q.valor)}</td></tr>`).join('')}</tbody></table>
          <p class="muted">Para deshacer un pago, quita su movimiento en la vista Mes: la cuota vuelve a quedar pendiente y las cajas pierden ese aporte.</p></details>` : ''}
      </section>`;
    };

    const detalle = detalleId !== null ? prestamos.find((p) => p.id === detalleId) : null;
    const node = el(detalle
      ? `<div><div class="fila"><button class="link" id="volver">← Todos los autopréstamos</button></div>${prestamoHTML(detalle)}</div>`
      : `<div>
      ${debeAhora > 0 ? `<div class="banner-pago"><span>⏰ Tienes <b>${cop(debeAhora)}</b> de autopréstamos por pagar hasta ${MESES[mHoy - 1]}${vencido > 0 ? ` (incluye <b>${cop(vencido)}</b> ya vencidos)` : ''}.</span>
        <button class="primary" data-edit id="pagar-ahora">Pagar ahora</button></div>` : ''}
      <div class="kpis">
        <div class="kpi"><small>Prestado (activos)</small><b>${cop(sum('monto'))}</b></div>
        <div class="kpi gasto"><small>Falta por devolver</small><b>${cop(sum('capital_pendiente'))}</b></div>
        <div class="kpi ahorro"><small>Intereses por pagarte</small><b>${cop(sum('interes_pendiente'))}</b> <span class="muted">ya cobrados ${cop(sum('interes_pagado'))}</span></div>
        <div class="kpi"><small>Termina todo</small><b>${termina ? esc(fechaCorta(termina)) : '—'}</b></div>
        <div class="kpi ingreso"><small>En la caja de ganancias${ganancias ? ` · ${esc(ganancias.nombre)}` : ''}</small><b>${cop(ganancias?.saldo ?? 0)}</b></div>
      </div>
      <div class="tj-lista">${activos.map((p) => dibujo(p)).join('')}<button class="tj-nueva" data-edit id="nuevo"><span>+</span>Nuevo autopréstamo</button></div>
      ${pagados.length ? `<h3 class="tj-grupo">Pagados (${pagados.length})</h3><div class="tj-lista">${pagados.map((p) => dibujo(p)).join('')}</div>` : ''}
      ${prestamos.length ? '<p class="muted">Haz clic en un autopréstamo para ver sus cuotas, pagarlas o cambiar la tasa.</p>' : '<div class="card"><p class="muted">Aún no hay autopréstamos. Crea uno eligiendo qué caja(s) prestan y con qué interés se devuelve.</p></div>'}
      ${proy.length ? `<div class="card"><div class="fila"><h2>📅 Proyección de pagos por mes</h2><span class="sp"></span><span class="muted">${proy.length} mes${proy.length === 1 ? '' : 'es'} · ${cop(proy.reduce((t, m) => t + m.porPagar, 0))} por pagar en total</span></div>
        <div style="overflow-x:auto"><table><thead><tr><th>Mes</th><th class="num">Cuotas</th><th class="num">Capital</th><th class="num">Interés</th><th class="num">Total del mes</th><th class="num">Por pagar</th><th class="num">Capital después</th><th></th><th></th></tr></thead>
        <tbody>${filasProy.map((m) => `<tr class="${m.estado === 'vencido' ? 'vencida' : ''}" data-mes="${m.clave}"><td><b>${MESES[m.mes - 1]} ${m.anio}</b></td><td class="num">${m.n}</td><td class="num">${cop(m.capital)}</td>
          <td class="num">${cop(m.interes)}</td><td class="num"><b>${cop(m.total)}</b></td><td class="num">${m.porPagar ? cop(m.porPagar) : '—'}</td><td class="num">${cop(m.saldoDespues)}</td>
          <td><span class="tag ${ESTADO_MES[m.estado][0]}">${ESTADO_MES[m.estado][1]}</span></td>
          <td class="num"><button class="link" data-detalle="${m.clave}">Detalle</button>${m.porPagar ? `<button class="link" data-edit data-pagar-mes="${m.clave}">Pagar este mes</button>` : ''}</td></tr>
          <tr hidden data-det="${m.clave}"><td colspan="9"><div class="muted">${m.cuotas.map((q) => `${esc(q.nombre)} · cuota ${q.numero}/${q.plazo} (${esc(fechaCorta(q.vencimiento))}): capital ${cop(q.capital)} + interés ${cop(q.interes)} = <b>${cop(q.valor)}</b>${q.pagada ? ' ✓ pagada' : ''}`).join('<br>')}</div></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${proy.reduce((t, m) => t + m.n, 0)}</td><td class="num">${cop(proy.reduce((t, m) => t + m.capital, 0))}</td><td class="num">${cop(proy.reduce((t, m) => t + m.interes, 0))}</td>
          <td class="num">${cop(proy.reduce((t, m) => t + m.total, 0))}</td><td class="num">${cop(proy.reduce((t, m) => t + m.porPagar, 0))}</td><td colspan="3"></td></tr></tfoot></table></div>
        ${proy.length > 24 ? `<button class="link" id="ver-todo">${verTodaLaProyeccion ? 'Ver solo los primeros 24 meses' : `Ver los ${proy.length} meses`}</button>` : ''}</div>` : ''}
      ${porCaja.length ? `<div class="card"><div class="fila"><h2>🐷 Qué ha prestado cada caja</h2></div>
        <div style="overflow-x:auto"><table><thead><tr><th>Caja</th><th class="num">Prestó</th><th class="num">Capital devuelto</th><th class="num">Falta devolver</th><th>Termina</th></tr></thead>
        <tbody>${porCaja.map((c) => `<tr><td><b>${esc(c.caja)}</b></td><td class="num">${cop(c.prestado)}</td><td class="num">${cop(c.devuelto)}</td>
          <td class="num"><b>${cop(c.pendiente)}</b></td>
          <td>${c.termina ? esc(fechaCorta(c.termina)) : '<span class="pos">✓ al día</span>'}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted">A estas cajas solo vuelve el capital. Los intereses (${cop(sum('interes_pagado'))} cobrados, ${cop(sum('interes_pendiente'))} por cobrar) van a la caja de ganancias.</p></div>` : ''}
    </div>`);

    node.querySelector('#nuevo')?.addEventListener('click', () => nuevo(rerender));
    node.querySelector('#volver')?.addEventListener('click', () => { detalleId = null; rerender(); });
    node.querySelectorAll('[data-abrir]').forEach((t) => {
      const abrir = () => { detalleId = Number(t.dataset.abrir); rerender(); };
      t.onclick = abrir;
      t.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } };
    });
    node.querySelector('#pagar-ahora')?.addEventListener('click', () => pagarMes(aHoy, mHoy, rerender));
    node.querySelectorAll('button[data-pagar-mes]').forEach((b) => (b.onclick = () => { const [a, m] = b.dataset.pagarMes.split('-').map(Number); pagarMes(a, m, rerender); }));
    node.querySelectorAll('button[data-detalle]').forEach((b) => (b.onclick = () => { const f = node.querySelector(`[data-det="${b.dataset.detalle}"]`); f.hidden = !f.hidden; }));
    node.querySelector('#ver-todo')?.addEventListener('click', () => { verTodaLaProyeccion = !verTodaLaProyeccion; rerender(); });
    for (const p of detalle ? [detalle] : []) {
      const sec = node.querySelector(`[data-p="${p.id}"]`);
      const pend = p.cuotas.filter((q) => !q.movimiento_id);
      sec.querySelector('[data-eliminar]')?.addEventListener('click', async () => {
        if (await confirmar(`¿Eliminar «${p.nombre}»? Se devuelve el desembolso a las cajas y se borra su calendario.`, 'Eliminar')) intentar(() => { repo.eliminarAutoprestamo(p.id); rerender(); });
      });
      if (pend.length) {
        sec.querySelector('[data-tasa]').onclick = () => cambiarTasa(p, pend, rerender);
        const actualizar = () => {
          const sel = pend.filter((q) => seleccion.has(q.id));
          sec.querySelector('[data-suma]').textContent = cop(sel.reduce((s, q) => s + q.valor, 0));
          sec.querySelector('[data-n]').textContent = sel.length ? `(${sel.length} cuota${sel.length === 1 ? '' : 's'})` : '';
          sec.querySelector('[data-pagar]').disabled = !sel.length;
        };
        sec.querySelectorAll('input[data-q]').forEach((c) => (c.onchange = () => { if (c.checked) seleccion.add(Number(c.dataset.q)); else seleccion.delete(Number(c.dataset.q)); actualizar(); }));
        sec.querySelector('[data-hasta]').onclick = () => { pend.filter((q) => q.vencimiento <= hoy).forEach((q) => seleccion.add(q.id)); rerender(); };
        sec.querySelector('[data-ninguna]').onclick = () => { pend.forEach((q) => seleccion.delete(q.id)); rerender(); };
        sec.querySelector('[data-mas]')?.addEventListener('click', () => { if (abiertos.has(p.id)) abiertos.delete(p.id); else abiertos.add(p.id); rerender(); });
        sec.querySelector('[data-pagar]').onclick = () => pagar(p, pend, rerender);
        actualizar();
      }
    }
    main.replaceChildren(node);
  },
};
