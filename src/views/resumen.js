import * as repo from '../repo.js';
import { cop, MESES } from '../calc.js';
import { esc, el } from '../ui.js';
import { periodo } from '../periodo.js';

const W = 720, H = 220, PAD = { l: 8, r: 8, t: 10, b: 24 };

/** Barras por mes: ingresos, gastos y ahorro. Colores del tema (variables CSS) para que sirva en claro y oscuro. */
function grafico(meses) {
  const max = Math.max(1, ...meses.flatMap((m) => [m.ingresos, m.gastos, m.ahorro]));
  const ancho = (W - PAD.l - PAD.r) / 12, alto = H - PAD.t - PAD.b;
  const barra = (v, i, k, color, titulo) => {
    const h = Math.max(0, (v / max) * alto), w = ancho / 4;
    return `<rect x="${PAD.l + i * ancho + ancho * 0.12 + k * (w + 1)}" y="${PAD.t + alto - h}" width="${w}" height="${h}" rx="2" fill="${color}"><title>${esc(titulo)}</title></rect>`;
  };
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos, gastos y ahorro por mes" style="width:100%;height:auto">
    <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + alto}" y2="${PAD.t + alto}" stroke="var(--line)"/>
    ${meses.map((m, i) => `${barra(m.ingresos, i, 0, 'var(--c-ingreso)', `${MESES[i]} · ingresos ${cop(m.ingresos)}`)}
      ${barra(m.gastos, i, 1, 'var(--c-fijo)', `${MESES[i]} · gastos ${cop(m.gastos)}`)}
      ${barra(m.ahorro, i, 2, 'var(--c-ahorro)', `${MESES[i]} · ahorro ${cop(m.ahorro)}`)}
      <text x="${PAD.l + i * ancho + ancho / 2}" y="${H - 7}" text-anchor="middle" font-size="11" fill="var(--muted)">${MESES[i].slice(0, 3)}</text>`).join('')}
  </svg>
  <div class="leyenda"><span><i style="background:var(--c-ingreso)"></i>Ingresos</span><span><i style="background:var(--c-fijo)"></i>Gastos</span><span><i style="background:var(--c-ahorro)"></i>Ahorro</span></div>`;
}

export default {
  titulo: 'Resumen anual',
  icono: '📊',
  render(main, { rerender }) {
    const anio = periodo.anio;
    const r = repo.resumenAnual(anio);
    const hoy = new Date();
    const corte = anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12; // último mes a considerar para saldos
    const t = r.total;
    const tasa = t.ingresos > 0 ? Math.round((t.ahorro / t.ingresos) * 100) : 0;
    const saldoCierre = r.meses[corte - 1].saldoFinal;
    const deudaTarjetas = repo.tarjetas().reduce((s, x) => s + x.pendiente, 0);
    const cuentas = repo.saldosCuentas(anio, corte);
    const hayDatos = r.meses.some((m) => m.ingresos || m.gastos || m.ahorro);
    const maxGrupo = r.grupos[0]?.[1] || 1;

    const node = el(`<div>
      <div class="fila"><h2>Resumen ${anio}</h2><span class="sp"></span>
        <button class="secondary" id="ant">‹ ${anio - 1}</button><button class="secondary" id="sig">${anio + 1} ›</button></div>
      <div class="kpis">
        <div class="kpi ingreso"><small>Ingresos netos</small><b>${cop(t.ingresos)}</b></div>
        <div class="kpi gasto"><small>Gastos</small><b>${cop(t.gastos)}</b> <span class="muted">de ${cop(t.previsto)} presup.</span></div>
        <div class="kpi ahorro"><small>Ahorro (${tasa} % de los ingresos)</small><b>${cop(t.ahorro)}</b></div>
        <div class="kpi saldo"><small>Saldo al cierre de ${MESES[corte - 1]}</small><b class="${saldoCierre < 0 ? 'neg' : 'pos'}">${cop(saldoCierre)}</b></div>
        <div class="kpi"><small>Deuda en tarjetas</small><b>${cop(deudaTarjetas)}</b></div>
      </div>
      ${hayDatos ? '' : `<div class="card"><p class="muted">Aún no hay ingresos ni movimientos en ${anio}. Regístralos en la vista <b>Mes</b>.</p></div>`}
      <div class="card"><div class="fila"><h2>📈 Mes a mes</h2></div>${grafico(r.meses)}</div>
      <div class="card"><table><thead><tr><th>Mes</th><th class="num">Ingresos</th><th class="num">Gastos</th><th class="num">Presupuesto</th>
        <th class="num">Ahorro</th><th class="num">Saldo de cierre</th></tr></thead>
        <tbody>${r.meses.map((m) => `<tr class="${m.ingresos || m.gastos || m.ahorro ? '' : 'baja'}"><td>${MESES[m.mes - 1]}</td><td class="num">${cop(m.ingresos)}</td>
          <td class="num">${cop(m.gastos)}</td><td class="num ${m.previsto && m.gastos > m.previsto ? 'neg' : ''}">${m.previsto ? cop(m.previsto) : '—'}</td>
          <td class="num">${cop(m.ahorro)}</td><td class="num ${m.saldoFinal < 0 ? 'neg' : ''}"><b>${cop(m.saldoFinal)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${cop(t.ingresos)}</td><td class="num">${cop(t.gastos)}</td><td class="num">${cop(t.previsto)}</td><td class="num">${cop(t.ahorro)}</td><td></td></tr></tfoot></table></div>
      <div class="dos-col">
        <div class="card"><div class="fila"><h2>🗂️ Dónde se va el gasto</h2></div>
          ${r.grupos.length ? r.grupos.slice(0, 8).map(([g, v]) => `<div class="fila-grupo"><span>${esc(g)}</span><span class="muted">${t.gastos ? Math.round((v / t.gastos) * 100) : 0} %</span><b>${cop(v)}</b>
            <div class="progreso est-progreso"><i style="width:${Math.round((v / maxGrupo) * 100)}%"></i></div></div>`).join('') : '<p class="muted">Sin gastos registrados.</p>'}</div>
        <div class="card"><div class="fila"><h2>⚠️ Más se pasaron del presupuesto</h2></div>
          ${r.excedidos.length ? `<table><tbody>${r.excedidos.map((c) => `<tr><td>${esc(c.nombre)}</td><td class="num muted">${cop(c.ejecutado)} de ${cop(c.previsto)}</td><td class="num neg"><b>+${cop(c.exceso)}</b></td></tr>`).join('')}</tbody></table>`
            : '<p class="muted">Ningún concepto superó su presupuesto en el año. 👍</p>'}</div>
      </div>
      ${cuentas.cuentas.length ? `<div class="card"><div class="fila"><h2>🏛️ Cuentas al cierre de ${MESES[corte - 1]}</h2></div>
        <table><tbody>${cuentas.cuentas.map((c) => `<tr><td>${esc(c.nombre)}</td><td class="num"><b>${cop(c.calculado)}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>`);

    node.querySelector('#ant').onclick = () => { periodo.anio = anio - 1; rerender(); };
    node.querySelector('#sig').onclick = () => { periodo.anio = anio + 1; rerender(); };
    main.replaceChildren(node);
  },
};
