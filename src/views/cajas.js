import * as repo from '../repo.js';
import { cop, parseMonto, hoyISO, MESES, inicioMesSig, sumarDias, tasaVigente } from '../calc.js';
import { esc, el, formulario, confirmar, intentar } from '../ui.js';
import { periodo } from '../periodo.js';

const TIPOS = { aporte: 'Aporte', retiro: 'Retiro', rendimiento: 'Rendimiento' };
const pct = (f) => `${(f * 100).toFixed(2).replace('.', ',').replace(/,?0+$/, '')} %`;
const ultimoDia = (anio, mes) => sumarDias(inicioMesSig(anio, mes), -1);
const todosAbiertos = new Set(); // cajas con el detalle desplegado

async function editarCaja(c = {}, rerender) {
  const v = await formulario({
    titulo: c.id ? 'Editar caja' : 'Nueva caja de ahorro',
    campos: [
      { name: 'nombre', label: 'Nombre (ej. Cajita viaje)', type: 'text', value: c.nombre, required: true },
      { name: 'banco', label: 'Banco o entidad (ej. Nu Colombia)', type: 'text', value: c.banco },
      ...(c.id ? [{ name: 'activo', label: 'Activa', type: 'checkbox', value: !!c.activo }] : []),
    ],
    extra: '<p class="muted">Las cajas son informativas: sus aportes y retiros no afectan Mes, Presupuesto ni Cuentas.</p>',
  });
  if (!v) return;
  await intentar(() => { repo.guardarCaja({ ...v, id: c.id, activo: c.id ? v.activo : true }); rerender(); });
}

async function editarMov(x, rerender) {
  const v = await formulario({
    titulo: x.id ? 'Editar movimiento' : `Nuevo ${TIPOS[x.tipo].toLowerCase()}`,
    campos: [
      { name: 'tipo', label: 'Tipo', type: 'select', options: Object.entries(TIPOS), value: x.tipo },
      { name: 'fecha', label: 'Fecha', type: 'date', value: x.fecha ?? hoyISO(), required: true },
      { name: 'monto', label: 'Monto', type: 'money', value: x.monto, required: true },
      { name: 'nota', label: 'Nota', type: 'text', value: x.nota },
    ],
  });
  if (!v) return;
  await intentar(() => {
    const monto = parseMonto(v.monto);
    if (!(monto > 0)) throw new Error('El monto debe ser un número mayor que cero.');
    repo.guardarCajaMov({ ...v, id: x.id, caja_id: x.caja_id, monto });
    rerender();
  });
}

async function nuevaTasa(c, rerender) {
  const v = await formulario({
    titulo: `Tasa de ${c.nombre}`,
    campos: [
      { name: 'desde', label: 'Rige desde', type: 'date', value: hoyISO(), required: true },
      { name: 'tasa', label: 'Tasa efectiva anual (%)', type: 'decimal', placeholder: 'ej. 11,25', required: true },
      { name: 'verificada', label: 'Confirmada con el banco el', type: 'date', value: hoyISO() },
    ],
    extra: '<p class="muted">Anota la tasa que ves en la app de tu banco; cambia con el tiempo. Cada cambio queda en el historial y la estimación usa la vigente en cada día.</p>',
  });
  if (!v) return;
  await intentar(() => {
    const t = parseMonto(v.tasa);
    if (!Number.isFinite(t)) throw new Error('Tasa no válida.');
    repo.guardarCajaTasa({ caja_id: c.id, desde: v.desde, tasa_ea: t / 100, verificada: v.verificada });
    rerender();
  });
}

export default {
  titulo: 'Cajas de ahorro',
  periodo: true,
  icono: '🐷',
  render(main, { rerender }) {
    const { anio, mes } = periodo;
    const porCaja = new Map(repo.prestamosPorCaja().map((p) => [p.caja_id, p]));
    const cajas = repo.cajas().map((c) => {
      const tasas = repo.cajaTasas(c.id);
      return { ...c, prestado: porCaja.get(c.id) ?? null, tasas, vigente: tasaVigente(tasas, hoyISO()), est: repo.estimarCajaMes(c.id, anio, mes), movs: repo.cajaMovs(c.id) };
    });
    const sum = (f) => cajas.reduce((s, c) => s + f(c), 0);
    const anualEstimado = sum((c) => (c.vigente ? c.saldo * c.vigente : 0));

    const cajaHTML = (c) => `<section class="card" data-c="${c.id}">
      <div class="fila"><h2>🐷 ${esc(c.nombre)}</h2>${c.banco ? `<span class="muted">${esc(c.banco)}</span>` : ''}<span class="sp"></span>
        <button class="secondary" data-edit data-mov="aporte">+ Aporte</button>
        <button class="secondary" data-edit data-mov="retiro">− Retiro</button>
        <button class="link" data-edit data-editar>Editar</button></div>
      <div class="kpis kpis-chicos">
        <div class="kpi ahorro"><small>Saldo</small><b>${cop(c.saldo)}</b></div>
        <div class="kpi"><small>Tasa vigente ${c.tasas[0]?.verificada ? `<span class="muted">· confirmada ${esc(c.tasas[0].verificada)}</span>` : ''}</small>
          <b>${c.vigente ? `${pct(c.vigente)} EA` : '—'}</b> <button class="link" data-edit data-tasa>${c.vigente ? 'cambiar' : 'agregar tasa'}</button></div>
        <div class="kpi"><small>Rendimiento de ${MESES[mes - 1]} (estimado)</small>
          <b>${c.est.sinTasa ? '—' : cop(c.est.rendimiento)}</b>
          <span class="muted">registrado ${cop(c.est.registrado)}</span></div>
      </div>
      ${c.prestado && c.prestado.pendiente > 0.5 ? `<p class="muted">🏦 Prestado a la familia: <b>${cop(c.prestado.pendiente)}</b> por devolver (termina ${esc(c.prestado.termina ?? '')}). Ver Autopréstamos.</p>` : ''}
      ${c.est.sinTasa ? '<p class="muted">Agrega la tasa EA para estimar el rendimiento de este mes.</p>' : `<div class="fila"><span class="muted">Si el banco ya abonó el rendimiento, anótalo (editable):</span>
        ${c.est.registrado ? `<span class="pos">✓ ya registraste ${cop(c.est.registrado)} este mes</span>` : `<button class="secondary" data-edit data-rend="${Math.round(c.est.rendimiento)}">Registrar ${cop(c.est.rendimiento)} como rendimiento de ${MESES[mes - 1].toLowerCase()}</button>`}
        <button class="link" data-edit data-mov="rendimiento">Anotar otro valor</button></div>`}
      <details data-d="${c.id}" ${todosAbiertos.has(c.id) ? 'open' : ''}><summary>Movimientos (${c.movs.length}) e historial de tasas</summary>
        <table><thead><tr><th>Fecha</th><th>Tipo</th><th class="num">Monto</th><th>Nota</th><th></th></tr></thead>
        <tbody>${c.movs.map((m) => `<tr><td>${esc(m.fecha)}</td><td><span class="tag ${m.tipo === 'retiro' ? 'descuento' : m.tipo === 'aporte' ? 'ahorro' : 'ingreso'}">${TIPOS[m.tipo]}</span></td>
          <td class="num ${m.tipo === 'retiro' ? 'neg' : ''}">${m.tipo === 'retiro' ? '−' : ''}${cop(m.monto)}</td><td class="muted">${esc(m.nota ?? '')}</td>
          <td class="num" data-edit>${m.movimiento_id ? '<span class="muted" title="Lo genera el pago de un concepto; se edita desde ese movimiento en la vista Mes">desde un pago</span>'
            : m.autoprestamo_id || m.cuota_id ? '<span class="muted" title="Lo genera un autopréstamo; se gestiona desde esa vista">autopréstamo</span>'
            : `<button class="link" data-me="${m.id}">Editar</button><button class="link danger" data-mq="${m.id}">Quitar</button>`}</td></tr>`).join('')
          || '<tr><td colspan="5" class="muted">Aún no hay movimientos.</td></tr>'}</tbody></table>
        <h3 style="margin-top:16px">Tasas EA</h3>
        <table><tbody>${c.tasas.map((t) => `<tr><td>desde ${esc(t.desde)}</td><td class="num"><b>${pct(t.tasa_ea)}</b></td><td class="muted">${t.verificada ? `confirmada ${esc(t.verificada)}` : ''}</td>
          <td class="num" data-edit><button class="link danger" data-tq="${t.id}">Quitar</button></td></tr>`).join('') || '<tr><td class="muted">Sin tasas registradas.</td></tr>'}</tbody></table>
      </details></section>`;

    const node = el(`<div>
      <div class="fila"><span class="sp"></span>
        <button class="primary" data-edit id="nueva">+ Nueva caja</button></div>
      <div class="kpis">
        <div class="kpi ahorro"><small>Total ahorrado en cajas</small><b>${cop(sum((c) => c.saldo))}</b></div>
        <div class="kpi"><small>Aportes − retiros</small><b>${cop(sum((c) => c.aportes - c.retiros))}</b></div>
        <div class="kpi ingreso"><small>Rendimientos registrados</small><b>${cop(sum((c) => c.rendimientos))}</b></div>
        <div class="kpi"><small>Rinde al año (estimado)</small><b>${cop(anualEstimado)}</b> <span class="muted">con el saldo y la tasa de hoy</span></div>
      </div>
      <p class="muted">Informativo: las cajas llevan su propio saldo y no afectan Mes, Presupuesto ni Cuentas. El rendimiento es una estimación con interés compuesto diario sobre la tasa EA anotada; el valor real lo define el banco.</p>
      ${cajas.map(cajaHTML).join('') || '<div class="card"><p class="muted">Aún no hay cajas. Crea una (por ejemplo, una Cajita de Nu) y anota sus aportes y la tasa EA.</p></div>'}
    </div>`);
    node.querySelector('#nueva').onclick = () => editarCaja({}, rerender);
    for (const c of cajas) {
      const sec = node.querySelector(`[data-c="${c.id}"]`);
      sec.querySelector('[data-editar]').onclick = () => editarCaja(c, rerender);
      sec.querySelector('[data-tasa]').onclick = () => nuevaTasa(c, rerender);
      sec.querySelectorAll('button[data-mov]').forEach((b) => (b.onclick = () => editarMov({ caja_id: c.id, tipo: b.dataset.mov, fecha: b.dataset.mov === 'rendimiento' ? ultimoDia(anio, mes) : undefined }, rerender)));
      sec.querySelector('[data-rend]')?.addEventListener('click', (e) => intentar(() => {
        repo.guardarCajaMov({ caja_id: c.id, fecha: ultimoDia(anio, mes), tipo: 'rendimiento', monto: Number(e.currentTarget.dataset.rend), nota: 'Estimado' });
        rerender();
      }));
      sec.querySelectorAll('[data-me]').forEach((b) => (b.onclick = () => editarMov(c.movs.find((m) => m.id === Number(b.dataset.me)), rerender)));
      sec.querySelectorAll('[data-mq]').forEach((b) => (b.onclick = async () => {
        if (await confirmar('¿Quitar este movimiento?', 'Quitar')) intentar(() => { repo.eliminarCajaMov(Number(b.dataset.mq)); rerender(); });
      }));
      sec.querySelectorAll('[data-tq]').forEach((b) => (b.onclick = async () => {
        if (await confirmar('¿Quitar esta tasa del historial?', 'Quitar')) intentar(() => { repo.eliminarCajaTasa(Number(b.dataset.tq)); rerender(); });
      }));
      sec.querySelector(`[data-d="${c.id}"]`).ontoggle = (e) => (e.target.open ? todosAbiertos.add(c.id) : todosAbiertos.delete(c.id));
    }
    main.replaceChildren(node);
  },
};
