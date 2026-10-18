import * as repo from '../repo.js';
import { cop, parseMonto, hoyISO, MESES, claveMes, calendarioCuotas, mensualAEa } from '../calc.js';
import { esc, el, formulario, confirmar, alerta, intentar } from '../ui.js';
import { periodo } from '../periodo.js';

// Cuotas marcadas para pagar; se conserva al re-renderizar (las pagadas dejan de existir como pendientes).
const seleccion = new Set();
const verPagadas = new Set(); // tarjetas con el historial de pagos desplegado

const cuentasOpc = () => repo.cuentas().map((c) => [c.id, c.nombre]);
/** Conceptos que una compra puede cubrir (más los que ya cubre, aunque ya no estén disponibles), con su monto estimado como sugerencia. */
const conceptosItems = (actuales = []) => {
  const lista = repo.conceptosCubribles().map((c) => ({ id: c.id, label: c.grupo ? `${c.grupo} · ${c.nombre}` : c.nombre, sugerido: c.monto_estimado || '' }));
  const extra = actuales.filter((id) => !lista.some((x) => x.id === id)).map((id) => repo.conceptos().find((c) => c.id === id)).filter(Boolean)
    .map((c) => ({ id: c.id, label: c.nombre, sugerido: c.monto_estimado || '' }));
  return [...lista, ...extra];
};
const AYUDA_CUBRE = '<p class="muted">Si esta compra paga algo que ya tienes como «por pagar» (el Internet, un seguro…), marca los conceptos y cuánto de la compra le corresponde a cada uno: en los meses en que venzan sus cuotas, esa parte se da por cubierta con la tarjeta y no se cuenta dos veces.</p>';

/** Línea en vivo: cuánto de la compra está asignado a conceptos y cuánto queda sin asignar. */
function resumenCubre(lista, monto) {
  if (!lista?.length) return '';
  const asignado = lista.reduce((t, x) => { const m = parseMonto(x.monto); return t + (Number.isFinite(m) ? m : 0); }, 0);
  const resto = (Number.isFinite(monto) ? monto : 0) - asignado;
  return `<p style="margin:6px 0 0">Asignado a conceptos: <b>${cop(asignado)}</b> · ${resto < 0 ? `<b class="neg">pasa por ${cop(-resto)} del valor de la compra</b>` : `sin asignar: <b>${cop(resto)}</b>`}</p>`;
}
const leerCubre = (lista) => (lista ?? []).map((x) => {
  const monto = parseMonto(x.monto);
  if (!Number.isFinite(monto)) throw new Error('Indica el monto de la compra que cubre cada concepto marcado.');
  return { concepto_id: x.id, monto };
});

async function nuevaTarjeta(rerender) {
  const v = await formulario({
    titulo: 'Nueva tarjeta',
    campos: [
      { name: 'nombre', label: 'Nombre (ej. Visa Bancolombia)', type: 'text', required: true },
      { name: 'cuenta_id', label: 'Cuenta desde la que se paga', type: 'select', options: cuentasOpc(), vacio: '—' },
      { name: 'fecha_pago', label: 'Fecha de pago (el día de cada mes)', type: 'date' },
    ],
    extra: '<p class="muted">Se crea el concepto «Tarjeta …» (grupo Deudas) que recibe los pagos y aparece en Presupuesto y «Por pagar».</p>',
  });
  if (!v) return;
  await intentar(() => { repo.crearTarjeta({ ...v, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null }); rerender(); });
}

async function nuevaCompra(tarjetaId, rerender) {
  const lista = repo.tarjetas();
  if (!lista.length) return alerta('Primero crea una tarjeta.');
  const v = await formulario({
    titulo: 'Nueva compra con tarjeta',
    campos: [
      { name: 'tarjeta_id', label: 'Tarjeta', type: 'select', options: lista.map((t) => [t.id, t.nombre]), value: tarjetaId ?? lista[0].id },
      { name: 'fecha', label: 'Fecha de la compra', type: 'date', value: hoyISO(), required: true },
      { name: 'descripcion', label: 'Descripción', type: 'text', required: true },
      { name: 'monto', label: 'Valor financiado', type: 'money', required: true },
      { name: 'num_cuotas', label: 'Número de cuotas', type: 'number', value: 1, min: 1, max: 120, required: true },
      { name: 'tasa', label: 'Interés mensual (%) — 0 si no tiene', type: 'decimal', value: '0' },
      { name: 'primera', label: 'Vence la 1ª cuota (mes del primer cobro)', type: 'date', value: hoyISO(), required: true },
      { name: 'cubre', label: 'Conceptos que cubre (opcional)', type: 'lista-monto', items: conceptosItems() },
    ],
    vistaPrevia: (x) => resumenCubre(x.cubre, parseMonto(x.monto || '0')),
    extra: `<p class="muted">Si la compra ya va avanzada, registra el saldo pendiente y las cuotas que faltan.</p>${AYUDA_CUBRE}`,
  });
  if (!v) return;
  await intentar(() => {
    const monto = parseMonto(v.monto), tasa = parseMonto(v.tasa || '0');
    if (!Number.isFinite(monto) || !Number.isFinite(tasa)) throw new Error('Monto o interés no válidos.');
    repo.guardarCompra({ ...v, tarjeta_id: Number(v.tarjeta_id), monto, num_cuotas: Number(v.num_cuotas), tasa_mensual: tasa / 100, cubre: leerCubre(v.cubre) });
    rerender();
  });
}

const pctTxt = (f) => (f * 100).toFixed(2).replace('.', ',');
const leerTasa = (txt) => { const t = parseMonto(txt || '0'); return Number.isFinite(t) ? t / 100 : NaN; };

/** Resumen en vivo del calendario que quedaría al editar una compra (lo que falta, si ya hay cuotas pagadas). */
function resumenCompra({ monto, cuotas, tasa, anio, mes }) {
  if (!(monto > 0) || !(cuotas >= 1) || !(tasa >= 0 && tasa < 1) || !anio) return '';
  const q = calendarioCuotas({ monto, cuotas, tasaMensual: tasa, anio, mes });
  const intereses = q.reduce((t, c) => t + c.interes, 0);
  const u = q.at(-1);
  return `<dl><dt>Cuota</dt><dd>${cop(q[0].valor)}</dd><dt>Intereses</dt><dd>${cop(intereses)}</dd><dt>Total a pagar</dt><dd>${cop(monto + intereses)}</dd>
    <dt>Última cuota</dt><dd>${MESES[u.mes - 1].slice(0, 3)} ${u.anio}</dd><dt>Tasa efectiva anual</dt><dd>${pctTxt(mensualAEa(tasa))} %</dd></dl>`;
}

async function editarCompra(c, rerender) {
  const conPagos = c.pagadas > 0;
  const sig = (a, m) => (m === 12 ? [a + 1, 1] : [a, m + 1]);
  // mes desde el que se recalculan las pendientes: la primera pendiente o el mes siguiente a la última cuota
  const [aIni, mIni] = conPagos ? (c.proxima ? [Math.floor(c.proxima / 100), c.proxima % 100] : sig(Math.floor(c.ultima / 100), c.ultima % 100)) : [0, 0];
  const v = await formulario({
    titulo: `Editar compra · ${c.descripcion}`,
    textoOk: 'Guardar y recalcular',
    campos: [
      { name: 'descripcion', label: 'Descripción', type: 'text', value: c.descripcion, required: true },
      { name: 'fecha', label: 'Fecha de la compra', type: 'date', value: c.fecha, required: true },
      { name: 'monto', label: 'Valor financiado (total de la compra)', type: 'money', value: c.monto, required: true },
      { name: 'num_cuotas', label: 'Número de cuotas (total, incluidas las ya pagadas)', type: 'number', value: c.num_cuotas, min: 1, max: 120, required: true },
      { name: 'tasa', label: 'Interés mensual (%) — rige hacia adelante', type: 'decimal', value: pctTxt(c.tasa_mensual), required: true },
      { name: 'cubre', label: 'Conceptos que cubre (opcional)', type: 'lista-monto', items: conceptosItems(c.cubre.map((x) => x.concepto_id)), value: c.cubre.map((x) => ({ id: x.concepto_id, monto: x.monto })) },
      ...(conPagos ? [] : [{ name: 'primera', label: 'Vence la 1ª cuota', type: 'date', value: `${String(Math.floor(c.proxima / 100))}-${String(c.proxima % 100).padStart(2, '0')}-01`, required: true }]),
    ],
    vistaPrevia: (x) => {
      const monto = parseMonto(x.monto || '0') - (conPagos ? c.capital_pagado : 0);
      const cuotas = Number(x.num_cuotas) - c.pagadas;
      const [anio, mes] = conPagos ? [aIni, mIni] : (x.primera || '').split('-').map(Number);
      return resumenCompra({ monto, cuotas, tasa: leerTasa(x.tasa), anio, mes }) + resumenCubre(x.cubre, parseMonto(x.monto || '0'));
    },
    extra: AYUDA_CUBRE + (conPagos
      ? `<p class="muted">Ya hay ${c.pagadas} cuota${c.pagadas === 1 ? '' : 's'} pagada${c.pagadas === 1 ? '' : 's'} (${cop(c.capital_pagado)} de capital): <b>no cambian</b>. Se recalculan solo las pendientes sobre lo que falta. Para corregir una cuota ya pagada, quita primero su pago en la vista Mes.</p>`
      : '<p class="muted">Se rehace todo el calendario de cuotas con estos datos.</p>'),
  });
  if (!v) return;
  await intentar(() => {
    const monto = parseMonto(v.monto), tasa = leerTasa(v.tasa);
    if (!Number.isFinite(monto) || !Number.isFinite(tasa)) throw new Error('Monto o interés no válidos.');
    repo.actualizarCompra({ id: c.id, fecha: v.fecha, descripcion: v.descripcion, monto, num_cuotas: Number(v.num_cuotas), tasa_mensual: tasa, primera: v.primera, cubre: leerCubre(v.cubre) });
    rerender();
  });
}

async function editarTarjeta(t, rerender) {
  const concepto = repo.conceptos().find((x) => x.id === t.concepto_id);
  const v = await formulario({
    titulo: `Editar ${t.nombre}`,
    campos: [
      { name: 'nombre', label: 'Nombre', type: 'text', value: t.nombre, required: true },
      { name: 'cuenta_id', label: 'Cuenta desde la que se paga', type: 'select', options: cuentasOpc(), vacio: '—', value: t.cuenta_id },
      { name: 'fecha_pago', label: 'Fecha de pago (el día de cada mes)', type: 'date', value: concepto?.fecha_pago },
    ],
    extra: '<p class="muted">El concepto «Tarjeta …» se renombra con ella.</p>',
  });
  if (!v) return;
  await intentar(() => { repo.actualizarTarjeta({ id: t.id, nombre: v.nombre, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null, fecha_pago: v.fecha_pago }); rerender(); });
}

async function pagar(t, pendientes, rerender) {
  const ids = [...seleccion].filter((id) => pendientes.some((q) => q.id === id));
  const total = pendientes.filter((q) => ids.includes(q.id)).reduce((s, q) => s + q.valor, 0);
  const v = await formulario({
    titulo: `Pagar ${t.nombre}`,
    textoOk: `Registrar pago de ${cop(total)}`,
    campos: [
      { name: 'fecha', label: 'Fecha del pago', type: 'date', value: hoyISO(), required: true },
      { name: 'cuenta_id', label: 'Sale de la cuenta', type: 'select', options: cuentasOpc(), vacio: '—', value: t.cuenta_id },
      { name: 'nota', label: 'Nota', type: 'text', value: `${t.nombre}: ${ids.length} ítem${ids.length === 1 ? '' : 's'}` },
    ],
    extra: `<p>Se registrará <b>un movimiento de ${cop(total)}</b> en «${esc(t.concepto)}» y esas ${ids.length} cuota${ids.length === 1 ? '' : 's'} quedarán pagadas.</p>`,
  });
  if (!v) return;
  await intentar(() => {
    const r = repo.pagarCuotas({ ids, fecha: v.fecha, concepto_id: t.concepto_id, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null, nota: v.nota });
    ids.forEach((id) => seleccion.delete(id));
    periodo.anio = Number(v.fecha.slice(0, 4)); periodo.mes = Number(v.fecha.slice(5, 7));
    rerender();
    return r;
  });
}

/**
 * Pago de una tarjeta desde «Por pagar» de Mes: cuotas que vencen en el mes (más las vencidas de meses anteriores,
 * si se deja marcado), preseleccionadas. Registra lo mismo que pagar desde Tarjetas (`repo.pagarCuotas`).
 */
export async function pagarMesTarjeta(t, anio, mes, rerender) {
  const clave = claveMes(anio, mes);
  const pendientes = repo.cuotasPendientes(t.id);
  const delMes = pendientes.filter((q) => claveMes(q.anio, q.mes) === clave);
  const vencidas = pendientes.filter((q) => claveMes(q.anio, q.mes) < clave);
  if (!delMes.length && !vencidas.length) return alerta(`«${t.nombre}» no tiene cuotas por pagar hasta ${MESES[mes - 1]} ${anio}. Si pagas otra cosa, hazlo desde Tarjetas.`);
  const elegidas = (v) => (vencidas.length && v.incluir === false ? delMes : [...vencidas, ...delMes]);
  const v = await formulario({
    titulo: `Pagar ${t.nombre} · ${MESES[mes - 1]} ${anio}`,
    textoOk: 'Registrar pago',
    campos: [
      { name: 'fecha', label: 'Fecha del pago', type: 'date', value: hoyISO(), required: true },
      ...(vencidas.length ? [{ name: 'incluir', label: `Incluir ${vencidas.length} cuota${vencidas.length === 1 ? '' : 's'} vencida${vencidas.length === 1 ? '' : 's'} de meses anteriores`, type: 'checkbox', value: true }] : []),
      { name: 'cuenta_id', label: 'Sale de la cuenta', type: 'select', options: cuentasOpc(), vacio: '—', value: t.cuenta_id },
    ],
    vistaPrevia: (x) => {
      const lista = elegidas(x);
      if (!lista.length) return '<p class="muted">No hay cuotas seleccionadas.</p>';
      return `<dl>${lista.map((q) => `<dt>${esc(q.descripcion)} · cuota ${q.numero}/${q.num_cuotas} <span class="muted">(${MESES[q.mes - 1]} ${q.anio})</span></dt><dd>${cop(q.valor)}</dd>`).join('')}
        <dt><b>Total</b> · un movimiento en «${esc(t.nombre)}»</dt><dd><b>${cop(lista.reduce((s, q) => s + q.valor, 0))}</b></dd></dl>`;
    },
  });
  if (!v) return;
  const lista = elegidas(v);
  await intentar(() => {
    repo.pagarCuotas({ ids: lista.map((q) => q.id), fecha: v.fecha, concepto_id: t.concepto_id, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null,
      nota: `${t.nombre}: ${lista.length} ítem${lista.length === 1 ? '' : 's'}` });
    lista.forEach((q) => seleccion.delete(q.id));
    rerender();
  });
}

export default {
  titulo: 'Tarjetas',
  periodo: true,
  icono: '💳',
  render(main, { rerender }) {
    const { anio, mes } = periodo;
    const clave = claveMes(anio, mes);
    const tarjetas = repo.tarjetas().map((t) => ({
      ...t,
      concepto: repo.conceptos().find((c) => c.id === t.concepto_id)?.nombre ?? t.nombre,
      pendientes: repo.cuotasPendientes(t.id),
    }));
    const todas = tarjetas.flatMap((t) => t.pendientes);
    for (const id of [...seleccion]) if (!todas.some((q) => q.id === id)) seleccion.delete(id);

    const cuotaFila = (q) => `<tr class="${claveMes(q.anio, q.mes) < clave ? 'vencida' : ''}">
      <td><input type="checkbox" data-q="${q.id}" ${seleccion.has(q.id) ? 'checked' : ''}></td>
      <td>${MESES[q.mes - 1].slice(0, 3)} ${q.anio}</td>
      <td>${esc(q.descripcion)} <span class="muted">· ${esc(q.fecha_compra)}</span></td>
      <td><span class="chip">${q.numero}/${q.num_cuotas}</span></td>
      <td class="num">${cop(q.capital)}</td><td class="num">${q.interes ? cop(q.interes) : '—'}</td><td class="num"><b>${cop(q.valor)}</b></td></tr>`;

    const tarjetaHTML = (t) => {
      const delMes = t.pendientes.filter((q) => claveMes(q.anio, q.mes) <= clave).reduce((s, q) => s + q.valor, 0);
      const compras = repo.comprasTarjeta(t.id);
      return `<section class="card tarjeta" data-t="${t.id}">
        <div class="fila"><h2>💳 ${esc(t.nombre)}</h2><span class="sp"></span>
          <button class="link" data-edit data-tarjeta="${t.id}">Editar tarjeta</button>
          <button class="secondary" data-edit data-compra="${t.id}">+ Compra</button></div>
        <div class="kpis kpis-chicos">
          <div class="kpi"><small>Deuda pendiente</small><b>${cop(t.pendiente)}</b></div>
          <div class="kpi gasto"><small>Por pagar hasta ${MESES[mes - 1]} ${anio}</small><b>${cop(delMes)}</b></div>
        </div>
        ${t.pendientes.length ? `<div class="fila"><button class="link" data-hasta="${t.id}">Seleccionar lo vencido hasta ${MESES[mes - 1].toLowerCase()}</button>
            <button class="link" data-ninguna="${t.id}">Quitar selección</button></div>
          <table><thead><tr><th></th><th>Cobro</th><th>Compra</th><th>Cuota</th><th class="num">Capital</th><th class="num">Interés</th><th class="num">Valor</th></tr></thead>
          <tbody>${t.pendientes.map(cuotaFila).join('')}</tbody></table>
          <div class="barra-pago"><span>Seleccionado: <b data-suma="${t.id}">$ 0</b> <small class="muted" data-n="${t.id}"></small></span><span class="sp"></span>
            <button class="primary" data-edit data-pagar="${t.id}" disabled>Registrar pago</button></div>`
          : '<p class="muted">Sin cuotas pendientes. 🎉</p>'}
        ${compras.length ? `<details><summary>Compras (${compras.length})</summary><table><tbody>${compras.map((c) => `<tr>
          <td>${esc(c.fecha)}</td><td>${esc(c.descripcion)}${c.cubre.length ? ` <span class="tag ahorro" title="Sus cuotas cubren estos conceptos en los meses en que vencen">→ ${esc(c.cubre.map((x) => x.nombre).join(', '))}</span>` : ''}</td>
          <td class="num">${cop(c.monto)}${c.tasa_mensual ? ` <span class="muted">· ${(c.tasa_mensual * 100).toFixed(2).replace(/\.?0+$/, '')} % mes</span>` : ''}</td>
          <td>${c.pagadas}/${c.n} cuotas pagadas</td>
          <td class="num" data-edit><button class="link" data-editar-compra="${c.id}">Editar</button>${c.pagadas ? '' : `<button class="link danger" data-quitar="${c.id}">Quitar</button>`}</td></tr>`).join('')}</tbody></table></details>` : ''}
        <details data-pag="${t.id}" ${verPagadas.has(t.id) ? 'open' : ''}><summary>Pagos realizados</summary><div data-pagadas="${t.id}"></div></details>
      </section>`;
    };

    const node = el(`<div>
      <div class="fila"><span class="sp"></span>
        <button class="secondary" data-edit id="nueva-tarjeta">+ Nueva tarjeta</button></div>
      ${tarjetas.map(tarjetaHTML).join('') || '<div class="card"><p class="muted">Aún no hay tarjetas. Crea una y registra sus compras (con cuotas e intereses) para decidir qué pagar cada mes.</p></div>'}
    </div>`);
    node.querySelector('#nueva-tarjeta').onclick = () => nuevaTarjeta(rerender);

    const actualizarSuma = (t) => {
      const sel = t.pendientes.filter((q) => seleccion.has(q.id));
      node.querySelector(`[data-suma="${t.id}"]`).textContent = cop(sel.reduce((s, q) => s + q.valor, 0));
      node.querySelector(`[data-n="${t.id}"]`).textContent = sel.length ? `(${sel.length} cuota${sel.length === 1 ? '' : 's'})` : '';
      node.querySelector(`[data-pagar="${t.id}"]`).disabled = !sel.length;
    };
    for (const t of tarjetas) {
      node.querySelector(`[data-compra="${t.id}"]`).onclick = () => nuevaCompra(t.id, rerender);
      node.querySelector(`[data-tarjeta="${t.id}"]`).onclick = () => editarTarjeta(t, rerender);
      const comprasDe = repo.comprasTarjeta(t.id);
      node.querySelectorAll(`[data-t="${t.id}"] button[data-editar-compra]`).forEach((b) => (b.onclick = () => editarCompra(comprasDe.find((c) => c.id === Number(b.dataset.editarCompra)), rerender)));
      if (t.pendientes.length) {
        const sec = node.querySelector(`[data-t="${t.id}"]`);
        sec.querySelectorAll('input[data-q]').forEach((c) => (c.onchange = () => {
          const id = Number(c.dataset.q);
          if (c.checked) seleccion.add(id); else seleccion.delete(id);
          actualizarSuma(t);
        }));
        const marcar = (fn) => { t.pendientes.forEach((q) => (fn(q) ? seleccion.add(q.id) : seleccion.delete(q.id))); rerender(); };
        sec.querySelector(`[data-hasta="${t.id}"]`).onclick = () => marcar((q) => seleccion.has(q.id) || claveMes(q.anio, q.mes) <= clave);
        sec.querySelector(`[data-ninguna="${t.id}"]`).onclick = () => marcar(() => false);
        sec.querySelector(`[data-pagar="${t.id}"]`).onclick = () => pagar(t, t.pendientes, rerender);
        actualizarSuma(t);
      }
      node.querySelectorAll(`[data-t="${t.id}"] button[data-quitar]`).forEach((b) => (b.onclick = async () => {
        if (await confirmar('¿Quitar esta compra y todas sus cuotas?', 'Quitar')) intentar(() => { repo.eliminarCompra(Number(b.dataset.quitar)); rerender(); });
      }));
      // El historial de pagos se carga solo al desplegarlo.
      const det = node.querySelector(`[data-pag="${t.id}"]`);
      const cargar = () => {
        const pagadas = repo.cuotasPagadas(t.id);
        node.querySelector(`[data-pagadas="${t.id}"]`).innerHTML = pagadas.length
          ? `<table><tbody>${pagadas.map((q) => `<tr><td>${esc(q.fecha_pago)}</td><td>${esc(q.descripcion)}</td><td><span class="chip">${q.numero}/${q.num_cuotas}</span></td><td class="num">${cop(q.valor)}</td></tr>`).join('')}</tbody></table>
            <p class="muted">Para deshacer un pago, quita su movimiento en la vista Mes: las cuotas vuelven a quedar pendientes.</p>`
          : '<p class="muted">Aún no hay pagos.</p>';
      };
      det.ontoggle = () => { if (det.open) { verPagadas.add(t.id); cargar(); } else verPagadas.delete(t.id); };
      if (det.open) cargar();
    }
    main.replaceChildren(node);
  },
};
