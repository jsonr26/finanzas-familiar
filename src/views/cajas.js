import * as repo from '../repo.js';
import { cop, parseMonto, hoyISO, MESES, inicioMesSig, sumarDias, tasaVigente, iconoCaja } from '../calc.js';
import { esc, el, formulario, confirmar, intentar } from '../ui.js';
import { periodo } from '../periodo.js';
import { PALETA, NOMBRE_COLOR } from '../colores.js';

const TIPOS = { aporte: 'Aporte', retiro: 'Retiro', rendimiento: 'Rendimiento' };
const pct = (f) => `${(f * 100).toFixed(2).replace('.', ',').replace(/,?0+$/, '')} %`;
const ultimoDia = (anio, mes) => sumarDias(inicioMesSig(anio, mes), -1);
const todosAbiertos = new Set(); // cajas con el detalle desplegado
let abierta = null;               // id de la caja cuyo detalle se está viendo (null = lista de cajas)
const colorDe = (c) => PALETA[c.color] ?? PALETA[repo.COLORES_TARJETA[c.id % repo.COLORES_TARJETA.length]];

async function editarCaja(c = {}, rerender) {
  const v = await formulario({
    titulo: c.id ? 'Editar caja' : 'Nueva caja de ahorro',
    campos: [
      { name: 'nombre', label: 'Nombre (ej. Cajita viaje)', type: 'text', value: c.nombre, required: true },
      { name: 'banco', label: 'Banco o entidad (ej. Nu Colombia)', type: 'text', value: c.banco },
      { name: 'meta', label: 'Meta de ahorro (opcional, para ver el avance)', type: 'money', value: c.meta || '' },
      { name: 'color', label: 'Color de la caja', type: 'select', options: Object.entries(NOMBRE_COLOR), vacio: 'Automático', value: c.color },
      ...(c.id ? [{ name: 'activo', label: 'Activa', type: 'checkbox', value: !!c.activo }] : []),
    ],
    extra: '<p class="muted">Las cajas son informativas: sus aportes y retiros no afectan Mes, Presupuesto ni Cuentas.</p>',
  });
  if (!v) return;
  await intentar(() => { repo.guardarCaja({ ...v, meta: v.meta.trim() ? parseMonto(v.meta) : null, id: c.id, activo: c.id ? v.activo : true }); rerender(); });
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
    if (abierta !== null && !cajas.some((c) => c.id === abierta)) abierta = null;
    const gananciasId = repo.gananciasActual()?.id;
    const icono = (c) => (c.id === gananciasId ? '💰' : iconoCaja(c.nombre));
    const prest = (c) => (c.prestado && c.prestado.pendiente > 0.5 ? c.prestado : null);
    const pctRec = (p) => (p.prestado > 0 ? Math.round((p.devuelto / p.prestado) * 100) : 0);
    const pctMeta = (c) => (c.meta > 0 ? Math.min(100, Math.round((c.saldo / c.meta) * 100)) : null);
    const dibujo = (c, mini = false) => {
      if (mini) return `<div class="tj mini" style="--tj:${colorDe(c)}"><b>${icono(c)} ${esc(c.nombre)}</b><span class="tj-deuda-mini">${cop(c.saldo)}</span></div>`;
      const p = prest(c), pm = pctMeta(c);
      return `<div class="tj caja" style="--tj:${colorDe(c)}" data-abrir="${c.id}" role="button" tabindex="0" aria-label="Abrir el detalle de ${esc(c.nombre)}">
        <div class="tj-top"><span class="tj-ico">${icono(c)}</span><b>${esc(c.nombre)}</b></div>
        <div class="tj-deuda"><small>Saldo</small><span>${cop(c.saldo)}</span></div>
        <div class="tj-pie"><div><small>Tasa EA</small><b>${c.vigente ? pct(c.vigente) : '—'}</b></div>
          <div><small>Rinde en ${MESES[mes - 1].toLowerCase()}</small><b>${c.est.sinTasa ? '—' : cop(c.est.rendimiento)}</b></div>
          ${c.banco ? `<div><small>Banco</small><b>${esc(c.banco)}</b></div>` : ''}</div>
        ${p ? `<div class="tj-prest"><small>Prestado a la familia · ${pctRec(p)} % recuperado</small><b>${cop(p.pendiente)} por recuperar</b></div>` : ''}
        ${pm !== null ? `<div class="tj-cupo" title="Meta: ${pm} % de ${cop(c.meta)}"><i style="width:${pm}%"></i></div>` : ''}</div>`;
    };

    const cajaHTML = (c) => `<section class="card" data-c="${c.id}">
      <div class="tj-detalle">${dibujo(c, true)}
        <div class="kpis kpis-chicos">
          <div class="kpi ahorro"><small>Saldo${c.banco ? ` · ${esc(c.banco)}` : ''}</small><b>${cop(c.saldo)}</b></div>
          <div class="kpi"><small>Tasa vigente ${c.tasas[0]?.verificada ? `<span class="muted">· confirmada ${esc(c.tasas[0].verificada)}</span>` : ''}</small>
            <b>${c.vigente ? `${pct(c.vigente)} EA` : '—'}</b> <button class="link" data-edit data-tasa>${c.vigente ? 'cambiar' : 'agregar tasa'}</button></div>
          <div class="kpi"><small>Rendimiento de ${MESES[mes - 1]} (estimado)</small>
            <b>${c.est.sinTasa ? '—' : cop(c.est.rendimiento)}</b>
            <span class="muted">registrado ${cop(c.est.registrado)}</span></div>
          ${pctMeta(c) !== null ? `<div class="kpi"><small>Meta · ${pctMeta(c)} %</small><b>${cop(Math.max(0, c.meta - c.saldo))}</b> <span class="muted">por juntar de ${cop(c.meta)}</span></div>` : ''}
          ${prest(c) ? `<div class="kpi"><small>Prestado a la familia · ${pctRec(prest(c))} % recuperado</small><b>${cop(prest(c).pendiente)}</b> <span class="muted">por recuperar de ${cop(prest(c).prestado)}</span></div>` : ''}
        </div>
        <div class="tj-botones"><button class="secondary" data-edit data-mov="aporte">+ Aporte</button>
          <button class="secondary" data-edit data-mov="retiro">− Retiro</button>
          <button class="link" data-edit data-editar>Editar caja</button></div></div>
      ${prest(c) ? `<p class="muted">🏦 Termina de devolverse el ${esc(prest(c).termina ?? '')}. Ver Autopréstamos.</p>` : ''}
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

    const detalle = abierta !== null ? cajas.find((c) => c.id === abierta) : null;
    const node = el(detalle
      ? `<div><div class="fila"><button class="link" id="volver">← Todas las cajas</button></div>${cajaHTML(detalle)}</div>`
      : `<div>
      <div class="kpis">
        <div class="kpi ahorro"><small>Total ahorrado en cajas</small><b>${cop(sum((c) => c.saldo))}</b></div>
        <div class="kpi"><small>Aportes − retiros</small><b>${cop(sum((c) => c.aportes - c.retiros))}</b></div>
        <div class="kpi ingreso"><small>Rendimientos registrados</small><b>${cop(sum((c) => c.rendimientos))}</b></div>
        <div class="kpi"><small>Rinde al año (estimado)</small><b>${cop(anualEstimado)}</b> <span class="muted">con el saldo y la tasa de hoy</span></div>
      </div>
      <div class="tj-lista">${cajas.map((c) => dibujo(c)).join('')}<button class="tj-nueva" data-edit id="nueva"><span>+</span>Nueva caja</button></div>
      <p class="muted">${cajas.length ? 'Haz clic en una caja para ver sus movimientos, tasas y rendimiento. ' : 'Aún no hay cajas. Crea una (por ejemplo, una Cajita de Nu) y anota sus aportes y la tasa EA. '}Informativo: las cajas llevan su propio saldo y no afectan Mes, Presupuesto ni Cuentas. El rendimiento es una estimación con interés compuesto diario sobre la tasa EA anotada; el valor real lo define el banco.</p>
    </div>`);
    node.querySelector('#nueva')?.addEventListener('click', () => editarCaja({}, rerender));
    node.querySelector('#volver')?.addEventListener('click', () => { abierta = null; rerender(); });
    node.querySelectorAll('[data-abrir]').forEach((t) => {
      const abrir = () => { abierta = Number(t.dataset.abrir); rerender(); };
      t.onclick = abrir;
      t.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } };
    });
    for (const c of detalle ? [detalle] : []) {
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
