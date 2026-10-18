import * as repo from '../repo.js';
import { cop, neto, pendientesDePago, estadoPresupuesto, claveMes, MESES } from '../calc.js';
import { esc, el, intentar } from '../ui.js';
import { periodo } from '../periodo.js';
import { pagarMes } from './prestamos.js';
import { pagarMesTarjeta } from './tarjetas.js';
import { editarMovimiento } from './mes.js';

const URGENCIA = { vencido: ['r', 'Vencido'], proximo: ['w', 'Esta semana'] };
const diasHasta = (vence) => Math.round((new Date(`${vence}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
const cuando = (p) => { const d = diasHasta(p.vence); return d < 0 ? `hace ${-d} d` : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`; };

/** Panel de inicio del mes consultado: cifras clave, lo que hay que pagar pronto y el avance del presupuesto por grupo. */
export default {
  titulo: 'Inicio',
  icono: '🏠',
  periodo: true,
  render(main, { rerender, ir }) {
    const { anio, mes } = periodo;
    const n = neto(repo.ingresosMes(anio, mes));
    const movs = repo.movimientosMes(anio, mes);
    const gastado = movs.filter((m) => m.categoria !== 'Ahorro').reduce((s, m) => s + m.monto, 0);
    const ahorrado = movs.filter((m) => m.categoria === 'Ahorro').reduce((s, m) => s + m.monto, 0);
    const saldo = repo.saldoAnterior(anio, mes) + n.neto - gastado - ahorrado;

    const todos = pendientesDePago(repo.gastosMes(anio, mes), anio, mes);
    const urgentes = todos.filter((p) => p.estado !== 'pendiente');
    const prestamos = repo.proyeccionPagosPrestamos().filter((m) => m.clave <= claveMes(anio, mes)).reduce((t, m) => t + m.porPagar, 0);

    const filas = repo.presupuestoMes(anio, mes).filter((f) => f.categoria !== 'Ahorro');
    const porGrupo = new Map();
    for (const f of filas) {
      const g = f.grupo ?? 'Sin grupo', x = porGrupo.get(g) ?? { previsto: 0, ejecutado: 0 };
      x.previsto += f.previsto; x.ejecutado += f.ejecutado; porGrupo.set(g, x);
    }
    const grupos = [...porGrupo].filter(([, x]) => x.previsto || x.ejecutado).sort((a, b) => b[1].previsto - a[1].previsto).slice(0, 8);
    const prev = grupos.reduce((s, [, x]) => s + x.previsto, 0), ejec = grupos.reduce((s, [, x]) => s + x.ejecutado, 0);

    const fila = (p) => `<div class="fila-pago"><span class="pill ${URGENCIA[p.estado][0]}">${URGENCIA[p.estado][1]}</span>
      <span class="fp-nombre">${esc(p.nombre)}${p.quincenal ? ` <span class="muted">· ${p.pago}ª quincena</span>` : ''}</span>
      <span class="muted">${cuando(p)}</span><span class="sp"></span><b class="num">${cop(p.monto_pago)}</b>
      <button class="secondary" data-edit data-pagar="${p.id}-${p.pago}">Pagar</button></div>`;

    const node = el(`<div>
      <div class="kpis">
        <div class="kpi ingreso"><small>Ingresos netos</small><b>${cop(n.neto)}</b></div>
        <div class="kpi gasto"><small>Gastos de ${MESES[mes - 1].toLowerCase()}</small><b>${cop(gastado)}</b></div>
        <div class="kpi saldo"><small>Saldo disponible</small><b class="${saldo < 0 ? 'neg' : 'pos'}">${cop(saldo)}</b></div>
      </div>
      <section class="card"><div class="fila"><h2>🗓️ Por pagar pronto</h2>${urgentes.length ? `<span class="pill w">${urgentes.length} pendiente${urgentes.length === 1 ? '' : 's'}</span>` : ''}<span class="sp"></span>
        <button class="link" id="ver-mes">Ver todo en Mes</button></div>
        ${urgentes.length ? urgentes.slice(0, 6).map(fila).join('') : '<p class="muted">No hay pagos vencidos ni que venzan esta semana.</p>'}
        ${urgentes.length > 6 ? `<p class="muted">y ${urgentes.length - 6} más en Mes.</p>` : ''}
        ${todos.length > urgentes.length ? `<p class="muted">Después de esta semana quedan ${todos.length - urgentes.length} pago${todos.length - urgentes.length === 1 ? '' : 's'} por registrar.</p>` : ''}
        ${prestamos > 0 ? `<div class="fila-pago"><span class="pill w">Cuotas</span><span class="fp-nombre">Autopréstamos hasta ${MESES[mes - 1].toLowerCase()}</span><span class="sp"></span><b class="num">${cop(prestamos)}</b>
          <button class="secondary" data-edit id="pagar-prestamos">Pagar…</button></div>` : ''}
      </section>
      <section class="card"><div class="fila"><h2>🎯 Presupuesto del mes</h2><span class="sp"></span>
        <span class="muted">${prev ? `${Math.round((ejec / prev) * 100)} % usado · ${cop(ejec)} de ${cop(prev)}` : ''}</span><button class="link" id="ver-presupuesto">Ver presupuesto</button></div>
        ${grupos.length ? grupos.map(([g, x]) => {
          const pct = x.previsto ? Math.round((x.ejecutado / x.previsto) * 100) : null;
          return `<div class="fila-grupo"><span>${esc(g)}</span><span class="muted">${pct !== null ? `${pct} %` : 'sin presupuesto'}</span><b>${cop(x.ejecutado)} <span class="muted">de ${cop(x.previsto)}</span></b>
            <div class="progreso est-${estadoPresupuesto(x.previsto, x.ejecutado)}"><i style="width:${x.previsto ? Math.min(100, pct) : 100}%"></i></div></div>`;
        }).join('') : '<p class="muted">Aún no hay presupuesto ni gastos este mes. Define el monto estimado de tus conceptos o registra un movimiento con «Agregar».</p>'}
      </section>
    </div>`);

    node.querySelector('#ver-mes').onclick = () => ir('mes');
    node.querySelector('#ver-presupuesto').onclick = () => ir('presupuesto');
    node.querySelector('#pagar-prestamos')?.addEventListener('click', () => pagarMes(anio, mes, rerender));
    node.querySelectorAll('button[data-pagar]').forEach((b) => (b.onclick = () => {
      const p = urgentes.find((x) => `${x.id}-${x.pago}` === b.dataset.pagar);
      const tarjeta = repo.tarjetaDeConcepto(p.id);
      if (tarjeta) return pagarMesTarjeta(tarjeta, anio, mes, rerender);
      editarMovimiento({ concepto_id: p.id, monto: p.monto_pago || undefined }, rerender);
    }));
    main.replaceChildren(node);
  },
};
