import * as repo from '../repo.js';
import { cop, MESES, parseMonto, montoPrevisto, estadoPresupuesto, coincide } from '../calc.js';
import { esc, el, formulario, alerta, intentar } from '../ui.js';
import { periodo } from '../periodo.js';

const ETIQUETA = { ok: 'En orden', alerta: 'Cerca del tope', excedido: 'Excedido', sin: 'Sin presupuesto', progreso: 'En camino', vacio: '' };

/** Ajusta el monto de un concepto solo para el mes consultado; vacío = volver al monto base. */
async function ajustar(f, rerender) {
  const { anio, mes } = periodo;
  const base = montoPrevisto({ ...f, ajuste: null }, anio, mes);
  const v = await formulario({
    titulo: `${f.nombre} · ${anio}-${String(mes).padStart(2, '0')}`,
    campos: [{ name: 'monto', label: 'Presupuesto de este mes', type: 'money', value: f.ajuste ?? '', placeholder: `Base: ${cop(base)}` }],
    extra: `<p class="muted">Solo cambia este mes. Déjalo vacío para volver al monto base (${cop(base)}); el base se edita en Conceptos.</p>`,
  });
  if (!v) return;
  await intentar(() => {
    const monto = v.monto.trim() ? parseMonto(v.monto) : null;
    if (monto !== null && (!Number.isFinite(monto) || monto < 0)) throw new Error('El monto debe ser un número válido (0 o mayor).');
    repo.guardarAjuste(anio, mes, f.id, monto);
    rerender();
  });
}

// Un ingreso es una meta (llegar o pasar es bueno), igual que el ahorro; gastos y descuentos tienen tope.
const semantica = (f) => (f.tipo === 'ingreso' || f.categoria === 'Ahorro' ? 'Ahorro' : 'Gasto');

let filtroQ = ''; // filtro por nombre o grupo; se conserva al re-renderizar

function filaPresupuesto(f) {
  const estado = estadoPresupuesto(f.previsto, f.ejecutado, semantica(f));
  const pct = f.previsto ? Math.round((f.ejecutado / f.previsto) * 100) : null;
  const dif = f.previsto - f.ejecutado;
  return `<tr data-q="${esc(`${f.grupo ?? ''} ${f.nombre}`)}">
    <td>${esc(f.nombre)}${f.categoria === 'Ahorro' ? ' <span class="tag ahorro">🐷 Ahorro</span>' : ''}${f.ajuste !== null ? ' <span class="chip" title="Ajustado solo para este mes">ajustado</span>' : ''}${f.cubierto ? ` <span class="tag ahorro" title="Ese valor se paga con cuotas de tarjeta y se cuenta en «Tarjeta X»">💳 ${cop(f.cubierto)} con tarjeta</span>` : ''}</td>
    <td class="num">${f.previsto ? cop(f.previsto) : '—'}</td>
    <td class="num">${cop(f.ejecutado)}</td>
    <td class="celda-progreso"><div class="progreso est-${estado}"><i style="width:${f.previsto ? Math.min(100, pct) : f.ejecutado ? 100 : 0}%"></i></div>
      <small class="muted">${pct !== null ? `${pct} % · ` : ''}${ETIQUETA[estado]}</small></td>
    <td class="num ${f.previsto && (semantica(f) === 'Ahorro' ? false : dif < 0) ? 'neg' : ''}">${f.previsto ? cop(dif) : ''}</td>
    <td class="num" data-edit><button class="link" data-ajustar="${f.id}">Ajustar</button></td></tr>`;
}

export default {
  titulo: 'Presupuesto',
  periodo: true,
  icono: '🎯',
  render(main, { rerender }) {
    const { anio, mes } = periodo;
    const filas = repo.presupuestoMes(anio, mes);
    const suma = (lista, k) => lista.reduce((s, f) => s + f[k], 0);
    const gastos = filas.filter((f) => f.categoria !== 'Ahorro');
    const ahorros = filas.filter((f) => f.categoria === 'Ahorro');
    const disponible = suma(gastos, 'previsto') - suma(gastos, 'ejecutado');

    const grupos = new Map();
    for (const f of filas) grupos.set(f.grupo ?? '', [...(grupos.get(f.grupo ?? '') ?? []), f]);
    const orden = [...grupos.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));

    const ingFilas = repo.presupuestoIngresosMes(anio, mes);
    const ingresosF = ingFilas.filter((f) => f.tipo === 'ingreso');
    const descuentosF = ingFilas.filter((f) => f.tipo === 'descuento');
    const netoPrev = suma(ingresosF, 'previsto') - suma(descuentosF, 'previsto');
    const netoReal = suma(ingresosF, 'ejecutado') - suma(descuentosF, 'ejecutado');
    const proy = repo.proyeccion(anio, mes, 6);
    const negativo = proy.find((p) => p.saldoFinal < 0);

    const node = el(`<div>
      <div class="fila"><input type="search" id="f-q" placeholder="🔍  Buscar concepto o grupo…" value="${esc(filtroQ)}"><span class="sp"></span>
        <button class="secondary" id="copiar" data-edit title="Copia los ajustes del mes anterior a los conceptos que aún no tienen ajuste este mes">Copiar ajustes del mes anterior</button></div>
      <div class="kpis">
        <div class="kpi ingreso"><small>Ingresos netos: presupuesto / real</small><b>${cop(netoReal)}</b> <span class="muted">de ${cop(netoPrev)}</span></div>
        <div class="kpi gasto"><small>Presupuesto de gastos</small><b>${cop(suma(gastos, 'previsto'))}</b></div>
        <div class="kpi"><small>Ejecutado</small><b>${cop(suma(gastos, 'ejecutado'))}</b></div>
        <div class="kpi saldo"><small>Disponible</small><b class="${disponible < 0 ? 'neg' : 'pos'}">${cop(disponible)}</b></div>
        <div class="kpi ahorro"><small>Ahorro: meta / hecho</small><b>${cop(suma(ahorros, 'ejecutado'))}</b> <span class="muted">de ${cop(suma(ahorros, 'previsto'))}</span></div>
      </div>
      <section class="card"><div class="fila"><h2>📈 Proyección</h2><span class="sp"></span>
        <span class="muted">próximos 6 meses, con lo presupuestado</span></div>
        ${negativo ? `<p class="neg">⚠️ El saldo quedaría negativo en ${MESES[negativo.mes - 1]} ${negativo.anio}.</p>` : ''}
        <table><thead><tr><th>Mes</th><th class="num">Saldo inicial</th><th class="num">Ingresos</th><th class="num">Gastos</th><th class="num">Ahorro</th><th class="num">Saldo final</th></tr></thead>
        <tbody>${proy.map((p) => `<tr><td>${MESES[p.mes - 1]} ${p.anio}${p.origen === 'presupuesto' ? ' <span class="chip" title="Ingresos tomados del presupuesto">presupuesto</span>' : p.origen === 'repetido' ? ' <span class="chip" title="Sin presupuesto ni ingresos registrados: se repite el último mes con ingresos">estimado</span>' : ''}</td>
          <td class="num">${cop(p.saldoInicial)}</td><td class="num">${cop(p.ingresos)}</td><td class="num">${cop(p.gastos)}</td><td class="num">${cop(p.ahorro)}</td>
          <td class="num ${p.saldoFinal < 0 ? 'neg' : 'pos'}"><b>${cop(p.saldoFinal)}</b></td></tr>`).join('')}</tbody></table>
        <p class="muted">El primer mes usa lo mayor entre presupuestado y ejecutado por concepto. Si no hay ingresos presupuestados, se repiten los del último mes registrado. Ajusta cualquier concepto de un mes con «Ajustar».</p></section>
      ${ingFilas.length ? `<section class="card"><div class="fila"><h2>💵 Ingresos y descuentos</h2><span class="sp"></span>
          <span class="muted">Neto: ${cop(netoReal)} de ${cop(netoPrev)}</span></div>
          <table><thead><tr><th>Concepto</th><th class="num">Presupuesto</th><th class="num">Real</th><th>Avance</th><th class="num">Diferencia</th><th></th></tr></thead>
          <tbody>${ingFilas.map(filaPresupuesto).join('')}</tbody></table></section>` : ''}
      ${orden.map((g) => {
        const lista = grupos.get(g);
        return `<section class="card"><div class="fila"><h2>${esc(g || 'Sin grupo')}</h2><span class="sp"></span>
          <span class="muted">${cop(suma(lista, 'ejecutado'))} de ${cop(suma(lista, 'previsto'))}</span></div>
          <table><thead><tr><th>Concepto</th><th class="num">Presupuesto</th><th class="num">Ejecutado</th><th>Avance</th><th class="num">Diferencia</th><th></th></tr></thead>
          <tbody>${lista.map(filaPresupuesto).join('')}</tbody></table></section>`;
      }).join('') || `<div class="card"><p class="muted">Aún no hay presupuesto para este mes. Define el <b>monto estimado</b> de cada ingreso, descuento y gasto en la vista
        <b>Conceptos</b> (marcándolo como «Presupuestado») y aparecerá aquí, junto con lo que vayas registrando en <b>Mes</b>.</p></div>`}
    </div>`);
    node.querySelectorAll('button[data-ajustar]').forEach((b) => (b.onclick = () => ajustar([...filas, ...ingFilas].find((f) => f.id === Number(b.dataset.ajustar)), rerender)));
    // Filtro: oculta filas (y las tarjetas de grupo que quedan vacías) sin re-renderizar, para no perder el foco.
    const aplicarFiltro = () => {
      for (const tr of node.querySelectorAll('tr[data-q]')) tr.hidden = !coincide(tr.dataset.q, filtroQ);
      for (const sec of node.querySelectorAll('section.card')) {
        const filasSec = sec.querySelectorAll('tr[data-q]');
        if (filasSec.length) sec.hidden = ![...filasSec].some((tr) => !tr.hidden);
      }
    };
    node.querySelector('#f-q').addEventListener('input', (e) => { filtroQ = e.target.value; aplicarFiltro(); });
    aplicarFiltro();
    node.querySelector('#copiar').onclick = () => intentar(async () => {
      const n = repo.copiarAjustes(anio, mes);
      rerender();
      await alerta(n ? `Se copiaron ${n} ajuste${n === 1 ? '' : 's'} del mes anterior.` : 'No había ajustes nuevos para copiar del mes anterior.');
    });
    main.replaceChildren(node);
  },
};
