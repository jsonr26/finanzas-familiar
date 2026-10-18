import * as repo from '../repo.js';
import { cop, neto, parseMonto, pad2, hoyISO, claveMes, pendientesDePago, cubiertosConTarjeta, estadoPresupuesto, MESES } from '../calc.js';
import { esc, el, formulario, confirmar, alerta, intentar } from '../ui.js';
import { periodo } from '../periodo.js';
import { pagarMes } from './prestamos.js';
import { pagarMesTarjeta } from './tarjetas.js';

const CLASES = [['sueldo', 'Sueldo'], ['prima', 'Prima'], ['otro', 'Otro ingreso'], ['descuento', 'Descuento']];
const ESTADO_PAGO = { vencido: 'Vencido', proximo: 'Próximo', pendiente: 'Pendiente' };
const nombresPersonas = () => repo.personas().map((p) => [p.id, p.nombre]);
const nombresCuentas = () => repo.cuentas().map((c) => [c.id, c.nombre]);
let ultimaCuenta = ''; // la última cuenta usada en un movimiento se ofrece por defecto

// Filtro de la lista de movimientos; se conserva al re-renderizar.
const filtro = { q: '', grupo: '', persona: '', cuenta: '' };
const SIN_CUENTA = '__sin__';

async function editarIngreso(x, rerender) {
  const conceptos = repo.conceptos({ soloActivos: true }).filter((c) => c.tipo === 'ingreso' || c.tipo === 'descuento');
  if (!conceptos.length) return intentar(() => { throw new Error('Primero crea conceptos de tipo Ingreso o Descuento.'); });
  const v = await formulario({
    titulo: x.id ? 'Editar ingreso' : 'Nuevo ingreso / descuento',
    campos: [
      { name: 'concepto_id', label: 'Concepto', type: 'buscar', required: true, options: conceptos.map((c) => [c.id, c.nombre]), value: x.concepto_id },
      { name: 'clase', label: 'Clase', type: 'select', options: CLASES, value: x.clase ?? 'sueldo' },
      { name: 'persona_id', label: 'Persona', type: 'select', options: nombresPersonas(), vacio: '—', value: x.persona_id },
      { name: 'cuenta_id', label: 'Cuenta donde entra', type: 'select', options: nombresCuentas(), vacio: '—', value: x.cuenta_id },
      { name: 'quincena', label: 'Quincena', type: 'select', options: [['1', 'Primera'], ['2', 'Segunda']], value: x.quincena ?? 1 },
      { name: 'monto', label: 'Monto', type: 'money', value: x.monto, required: true },
      { name: 'nota', label: 'Nota', type: 'text', value: x.nota },
    ],
  });
  if (!v) return;
  const monto = parseMonto(v.monto);
  await intentar(() => {
    if (!(monto > 0)) throw new Error('El monto debe ser un número mayor que cero.');
    repo.guardarIngreso({ ...v, id: x.id, ...periodo, concepto_id: Number(v.concepto_id), quincena: Number(v.quincena),
      persona_id: v.persona_id ? Number(v.persona_id) : null, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null, monto });
    rerender();
  });
}

const AVISO_TARJETA = 'Este concepto es una tarjeta: sus pagos se registran pagando las cuotas (desde «Por pagar» o desde Tarjetas) para que la deuda de la tarjeta baje. No se puede crear aquí un movimiento suelto.';
/** Un movimiento nuevo (o que cambia a este concepto) no puede ser de una tarjeta; los ya existentes se pueden seguir editando. */
const bloqueaTarjeta = (x, conceptoId) => Number(conceptoId) !== Number(x.concepto_id ?? 0) || !x.id
  ? !!repo.tarjetaDeConcepto(Number(conceptoId)) : false;

export async function editarMovimiento(x, rerender) {
  const conceptos = repo.conceptos({ soloActivos: true }).filter((c) => c.tipo.startsWith('gasto'));
  if (!conceptos.length) return intentar(() => { throw new Error('Primero crea conceptos de gasto.'); });
  const hoy = new Date();
  const enMesActual = hoy.getMonth() + 1 === periodo.mes && hoy.getFullYear() === periodo.anio;
  const porDefecto = enMesActual ? hoyISO() : `${periodo.anio}-${pad2(periodo.mes)}-${pad2(Math.min(hoy.getDate(), 28))}`;
  const v = await formulario({
    titulo: x.id ? 'Editar movimiento' : 'Nuevo movimiento',
    otro: x.id ? '' : 'Guardar y agregar otro',
    campos: [
      { name: 'fecha', label: 'Fecha', type: 'date', value: x.fecha ?? porDefecto, required: true },
      { name: 'concepto_id', label: 'Concepto', type: 'buscar', required: true, options: conceptos.map((c) => [c.id, c.grupo ? `${c.grupo} · ${c.nombre}` : c.nombre]), value: x.concepto_id },
      { name: 'monto', label: 'Monto', type: 'money', value: x.monto, required: true },
      { name: 'persona_id', label: 'Pagó', type: 'select', options: nombresPersonas(), vacio: '—', value: x.persona_id },
      { name: 'cuenta_id', label: 'Sale de la cuenta', type: 'select', options: nombresCuentas(), vacio: '—', value: x.cuenta_id ?? (x.id ? null : ultimaCuenta) },
      { name: 'nota', label: 'Nota', type: 'text', value: x.nota },
    ],
    vistaPrevia: (c) => (bloqueaTarjeta(x, c.concepto_id) ? `<p class="err">💳 ${AVISO_TARJETA}</p>` : ''),
  });
  if (!v) return;
  if (bloqueaTarjeta(x, v.concepto_id)) return alerta(AVISO_TARJETA);
  const monto = parseMonto(v.monto);
  if (!x.id) ultimaCuenta = v.cuenta_id;
  const guardado = await intentar(() => {
    if (!Number.isFinite(monto) || monto === 0) throw new Error('El monto debe ser un número distinto de cero.');
    repo.guardarMovimiento({ ...v, id: x.id, concepto_id: Number(v.concepto_id), persona_id: v.persona_id ? Number(v.persona_id) : null, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null, monto });
    rerender();
    return true;
  });
  // «Guardar y agregar otro»: se reabre el formulario conservando fecha y quién pagó.
  if (guardado && v.__otro) editarMovimiento({ fecha: v.fecha, persona_id: v.persona_id ? Number(v.persona_id) : null }, rerender);
}

const barraPresupuesto = (previsto, ejecutado) => {
  const estado = estadoPresupuesto(previsto, ejecutado);
  const pct = previsto ? Math.min(100, Math.round((ejecutado / previsto) * 100)) : ejecutado ? 100 : 0;
  return `<div class="progreso est-${estado}"><i style="width:${pct}%"></i></div>`;
};

export default {
  titulo: 'Mes',
  periodo: true,
  icono: '📅',
  render(main, { rerender }) {
    const { anio, mes } = periodo;
    const ingresos = repo.ingresosMes(anio, mes);
    const movs = repo.movimientosMes(anio, mes);
    const saldoAnt = repo.saldoAnteriorInfo(anio, mes);
    const n = neto(ingresos);
    const gastado = movs.filter((m) => m.categoria !== 'Ahorro').reduce((s, m) => s + m.monto, 0);
    const ahorrado = movs.filter((m) => m.categoria === 'Ahorro').reduce((s, m) => s + m.monto, 0);
    const saldo = saldoAnt.valor + n.neto - gastado - ahorrado;
    const pres = repo.resumenPresupuesto(anio, mes);
    const filasGasto = repo.gastosMes(anio, mes);
    const pendientes = pendientesDePago(filasGasto, anio, mes);
    const cubiertos = cubiertosConTarjeta(filasGasto, anio, mes);
    const mostrarPendientes = claveMes(anio, mes) >= hoyISO().slice(0, 7);
    const prestamosHasta = repo.proyeccionPagosPrestamos().filter((m) => m.clave <= claveMes(anio, mes));
    const prestamosPorPagar = prestamosHasta.reduce((t, m) => t + m.porPagar, 0);
    const prestamosAnteriores = prestamosHasta.filter((m) => m.clave < claveMes(anio, mes)).reduce((t, m) => t + m.porPagar, 0);
    const totalPendiente = pendientes.reduce((s, p) => s + p.monto_pago, 0);

    const porGrupo = new Map();
    for (const m of movs) if (m.categoria !== 'Ahorro') porGrupo.set(m.grupo ?? 'Sin grupo', (porGrupo.get(m.grupo ?? 'Sin grupo') ?? 0) + m.monto);
    const grupos = [...porGrupo].sort((a, b) => b[1] - a[1]);
    const gruposMov = [...new Set(movs.map((m) => m.grupo).filter(Boolean))].sort();
    const cuentasMov = [...new Set(movs.map((m) => m.cuenta).filter(Boolean))].sort();
    const haySinCuenta = movs.some((m) => !m.cuenta);
    if (filtro.cuenta && filtro.cuenta !== SIN_CUENTA ? !cuentasMov.includes(filtro.cuenta) : filtro.cuenta === SIN_CUENTA && !haySinCuenta) filtro.cuenta = ''; // la cuenta filtrada no tiene movimientos en este mes
    const personasMov = [...new Set(movs.map((m) => m.persona).filter(Boolean))].sort();

    const node = el(`<div>
      <div class="kpis">
        <div class="kpi"><small>Saldo anterior <span class="chip">${saldoAnt.manual ? 'manual' : 'automático'}</span> <button class="link" id="saldo" data-edit>editar</button></small><b>${cop(saldoAnt.valor)}</b></div>
        <div class="kpi ingreso"><small>Ingresos</small><b>${cop(n.ingresos)}</b></div>
        <div class="kpi descuento"><small>Descuentos</small><b>${cop(n.descuentos)}</b></div>
        <div class="kpi gasto"><small>Gastado</small><b>${cop(gastado)}</b></div>
        <div class="kpi ahorro"><small>Ahorrado</small><b>${cop(ahorrado)}</b></div>
        <div class="kpi saldo"><small>Saldo del mes</small><b class="${saldo < 0 ? 'neg' : 'pos'}">${cop(saldo)}</b></div>
        <div class="kpi presupuesto"><small>Presupuesto de gastos</small><b>${cop(pres.ejecutado)}</b> <span class="muted">de ${cop(pres.previsto)}</span>
          ${barraPresupuesto(pres.previsto, pres.ejecutado)}</div>
      </div>
      ${mostrarPendientes ? `<div class="card"><div class="fila"><h2>⏰ Por pagar</h2>
        <span class="muted">${pendientes.length ? `${pendientes.length} · ${cop(totalPendiente)} estimados` : ''}</span></div>
        ${prestamosPorPagar > 0 ? `<p class="fila-prestamos">🏦 Autopréstamos hasta ${MESES[mes - 1].toLowerCase()}: <b>${cop(prestamosPorPagar)}</b>${prestamosAnteriores > 0 ? ` <span class="muted">(incluye ${cop(prestamosAnteriores)} de meses anteriores)</span>` : ''}
          <button class="link" data-edit data-pagar-prestamos>Pagar…</button></p>` : ''}
        ${cubiertos.length ? `<p class="fila-prestamos">💳 Cubierto con tarjeta este mes: ${cubiertos.map((c) => `${esc(c.nombre)} <b>${cop(c.cubierto)}</b>`).join(' · ')} <span class="muted">(se paga con la tarjeta)</span></p>` : ''}
        ${pendientes.length ? `<table><thead><tr><th>Vence</th><th>Concepto</th><th>Responsable</th><th class="num">Estimado</th><th></th><th></th></tr></thead>
        <tbody>${pendientes.map((p) => `<tr><td>${esc(p.vence)}</td><td>${esc(p.nombre)}${p.quincenal ? ` <span class="chip">${p.pago}ª quincena</span>` : ''}${p.grupo ? ` <span class="muted">· ${esc(p.grupo)}</span>` : ''}</td>
          <td>${esc(p.responsable ?? '')}</td><td class="num">${p.monto_pago ? cop(p.monto_pago) : '—'}</td>
          <td><span class="tag ${p.estado}">${ESTADO_PAGO[p.estado]}</span></td>
          <td class="num" data-edit><button class="link" data-pagar="${p.id}-${p.pago}">Registrar pago</button></td></tr>`).join('')}</tbody></table>`
          : '<p class="muted">Todo lo que tiene fecha de pago ya tiene su movimiento este mes. ✅</p>'}</div>` : ''}
      <div class="card"><div class="fila"><h2>💵 Ingresos y descuentos</h2><span class="sp"></span>
        ${ingresos.length ? '' : '<button class="secondary" id="copiar-ing" data-edit>Copiar del mes anterior</button>'}
        <button class="primary" id="nuevo-ing" data-edit>+ Agregar</button></div>
        <table><thead><tr><th>Quinc.</th><th>Concepto</th><th>Persona · cuenta</th><th>Clase</th><th class="num">Monto</th><th></th></tr></thead>
        <tbody>${ingresos.map((i) => `<tr><td><span class="chip">${i.quincena}ª</span></td><td>${esc(i.concepto)}${i.nota ? ` <span class="muted">· ${esc(i.nota)}</span>` : ''}</td>
          <td>${esc(i.persona ?? '')}${i.cuenta ? ` <span class="muted">· ${esc(i.cuenta)}</span>` : ''}</td><td><span class="tag ${i.clase}">${esc(CLASES.find((c) => c[0] === i.clase)[1])}</span></td>
          <td class="num ${i.clase === 'descuento' ? 'neg' : ''}">${i.clase === 'descuento' ? '−' : ''}${cop(i.monto)}</td>
          <td class="num" data-edit><button class="link" data-ing="editar" data-id="${i.id}">Editar</button>
            <button class="link danger" data-ing="borrar" data-id="${i.id}">Quitar</button></td></tr>`).join('')
          || '<tr><td colspan="6" class="muted">Sin ingresos registrados este mes.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="4">Neto</td><td class="num">${cop(n.neto)}</td><td></td></tr></tfoot></table></div>
      ${grupos.length ? `<div class="card"><div class="fila"><h2>🗂️ Gasto por grupo</h2></div>
        <table><tbody>${grupos.map(([g, t]) => `<tr><td>${esc(g)}</td><td class="num">${cop(t)}</td><td class="num muted">${gastado ? Math.round((t / gastado) * 100) : 0} %</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="card"><div class="fila"><h2>🧾 Movimientos</h2><span class="sp"></span>
        <button class="primary" id="nuevo-mov" data-edit>+ Agregar</button></div>
        ${movs.length ? `<div class="barra">
          <input type="search" id="f-q" placeholder="🔍  Buscar concepto o nota…" value="${esc(filtro.q)}">
          <select id="f-grupo"><option value="">Todos los grupos</option>${gruposMov.map((g) => `<option ${g === filtro.grupo ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
          <select id="f-persona"><option value="">Quien pagó: todos</option>${personasMov.map((p) => `<option ${p === filtro.persona ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
          ${cuentasMov.length ? `<select id="f-cuenta"><option value="">Cuenta: todas</option>${cuentasMov.map((c) => `<option ${c === filtro.cuenta ? 'selected' : ''}>${esc(c)}</option>`).join('')}${haySinCuenta ? `<option value="${SIN_CUENTA}" ${filtro.cuenta === SIN_CUENTA ? 'selected' : ''}>Sin cuenta</option>` : ''}</select>` : ''}
        </div>` : ''}
        <table><thead><tr><th>Fecha</th><th>Concepto</th><th>Pagó · cuenta</th><th class="num">Monto</th><th></th></tr></thead>
        <tbody id="movs">${movs.map((m) => `<tr data-mov-fila data-q="${esc((m.concepto + ' ' + (m.nota ?? '') + ' ' + (m.grupo ?? '')).toLowerCase())}"
            data-grupo="${esc(m.grupo ?? '')}" data-persona="${esc(m.persona ?? '')}" data-cuenta="${esc(m.cuenta ?? SIN_CUENTA)}" data-monto="${m.monto}">
          <td>${esc(m.fecha)}</td><td>${esc(m.concepto)}${m.categoria === 'Ahorro' ? ' <span class="tag ahorro">🐷</span>' : ''}${m.nota ? ` <span class="muted">· ${esc(m.nota)}</span>` : ''}</td>
          <td>${esc(m.persona ?? '')}${m.cuenta ? ` <span class="muted">· ${esc(m.cuenta)}</span>` : ''}</td><td class="num">${cop(m.monto)}</td>
          <td class="num" data-edit><button class="link" data-mov="editar" data-id="${m.id}">Editar</button>
            <button class="link danger" data-mov="borrar" data-id="${m.id}">Quitar</button></td></tr>`).join('')
          || '<tr><td colspan="5" class="muted">Sin movimientos este mes.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="3" id="total-etiqueta">Total</td><td class="num" id="total-mov">${cop(gastado + ahorrado)}</td><td></td></tr></tfoot></table></div>
    </div>`);
    node.querySelector('#nuevo-ing').onclick = () => editarIngreso({}, rerender);
    node.querySelector('#nuevo-mov').onclick = () => editarMovimiento({}, rerender);
    node.querySelector('#copiar-ing')?.addEventListener('click', () => intentar(() => { repo.copiarIngresos(anio, mes); rerender(); }));
    node.querySelector('[data-pagar-prestamos]')?.addEventListener('click', () => pagarMes(anio, mes, rerender));
    node.querySelectorAll('button[data-pagar]').forEach((b) => (b.onclick = () => {
      const p = pendientes.find((x) => `${x.id}-${x.pago}` === b.dataset.pagar);
      const tarjeta = repo.tarjetaDeConcepto(p.id);
      if (tarjeta) return pagarMesTarjeta(tarjeta, anio, mes, rerender);
      editarMovimiento({ concepto_id: p.id, monto: p.monto_pago || undefined }, rerender);
    }));
    node.querySelector('#saldo').onclick = async () => {
      const v = await formulario({
        titulo: `Saldo anterior · ${anio}-${pad2(mes)}`,
        campos: [{ name: 'saldo', label: 'Saldo', type: 'money', value: saldoAnt.manual ? saldoAnt.valor : '', placeholder: `Automático: ${cop(saldoAnt.valor)}` }],
        extra: '<p class="muted">Déjalo vacío para usar el saldo que arrastran los meses anteriores.</p>',
      });
      if (!v) return;
      await intentar(() => {
        if (!v.saldo.trim()) repo.quitarSaldoAnterior(anio, mes);
        else {
          const s = parseMonto(v.saldo);
          if (!Number.isFinite(s)) throw new Error('Monto no válido.');
          repo.guardarSaldoAnterior(anio, mes, s);
        }
        rerender();
      });
    };

    // Filtro de movimientos: oculta filas y recalcula el total sin re-renderizar (así no se pierde el foco).
    const aplicarFiltro = () => {
      const filas = [...node.querySelectorAll('[data-mov-fila]')];
      let total = 0, visibles = 0;
      for (const f of filas) {
        const ok = (!filtro.q || f.dataset.q.includes(filtro.q.toLowerCase())) && (!filtro.grupo || f.dataset.grupo === filtro.grupo)
          && (!filtro.persona || f.dataset.persona === filtro.persona) && (!filtro.cuenta || f.dataset.cuenta === filtro.cuenta);
        f.hidden = !ok;
        if (ok) { total += Number(f.dataset.monto); visibles++; }
      }
      const filtrado = filtro.q || filtro.grupo || filtro.persona || filtro.cuenta;
      node.querySelector('#total-mov').textContent = cop(total);
      node.querySelector('#total-etiqueta').textContent = filtrado ? `Total filtrado (${visibles} de ${filas.length})` : 'Total';
    };
    node.querySelector('#f-q')?.addEventListener('input', (e) => { filtro.q = e.target.value.trim(); aplicarFiltro(); });
    node.querySelector('#f-grupo')?.addEventListener('change', (e) => { filtro.grupo = e.target.value; aplicarFiltro(); });
    node.querySelector('#f-persona')?.addEventListener('change', (e) => { filtro.persona = e.target.value; aplicarFiltro(); });
    node.querySelector('#f-cuenta')?.addEventListener('change', (e) => { filtro.cuenta = e.target.value; aplicarFiltro(); });
    aplicarFiltro();

    const acciones = (attr, lista, editar, borrar, texto) => node.querySelectorAll(`button[${attr}]`).forEach((b) => (b.onclick = async () => {
      const id = Number(b.dataset.id);
      if (b.getAttribute(attr) === 'editar') return editar(lista.find((x) => x.id === id), rerender);
      if (await confirmar(texto, 'Quitar')) intentar(() => { borrar(id); rerender(); });
    }));
    acciones('data-ing', ingresos, editarIngreso, repo.eliminarIngreso, '¿Quitar esta línea de ingresos?');
    acciones('data-mov', movs, editarMovimiento, repo.eliminarMovimiento, '¿Quitar este movimiento?');
    main.replaceChildren(node);
  },
};
