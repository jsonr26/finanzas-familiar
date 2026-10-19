import * as repo from '../repo.js';
import { cop, neto, parseMonto, pad2, hoyISO, claveMes, pendientesDePago, cubiertosConTarjeta, estadoPresupuesto, MESES, haceTiempo, iconoGrupo, sumarDias, mesAnterior } from '../calc.js';
import { esc, el, formulario, confirmar, alerta, intentar, camposHTML, enlazarFormulario } from '../ui.js';
import { periodo } from '../periodo.js';
import { pagarMes } from './prestamos.js';
import { pagarMesTarjeta } from './tarjetas.js';

const CLASES = [['sueldo', 'Sueldo'], ['prima', 'Prima'], ['otro', 'Otro ingreso'], ['descuento', 'Descuento']];
const ESTADO_PAGO = { vencido: 'Vencido', proximo: 'Próximo', pendiente: 'Pendiente' };
const nombresPersonas = () => repo.personas().map((p) => [p.id, p.nombre]);
const nombresCuentas = () => repo.cuentas().map((c) => [c.id, c.nombre]);
let ultimaCuenta = ''; // la última cuenta usada en un movimiento se ofrece por defecto

// Estado de la vista (sobrevive a los re-render)
let pestana = 'movimientos';          // movimientos | ingresos | porpagar
let verDetalle = false;               // cifras secundarias del resumen
let verMas = false;                   // campos extra de la barra de registro rápido
const ultima = { fecha: null, persona: '' };   // lo último usado en la barra, para el siguiente registro
let pendienteRapido = null;           // { concepto_id, monto } que pasa «Por pagar» a la barra
let enfocar = null;                   // 'concepto' | 'monto': dónde dejar el cursor tras guardar
let atajoPuesto = false;

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

const corta = (f) => { const [, m, d] = f.split('-').map(Number); return `${d} ${MESES[m - 1].slice(0, 3).toLowerCase()}`; };
const etiquetaDia = (f) => {
  const hoy = hoyISO();
  const dia = f === hoy ? 'Hoy' : f === sumarDias(hoy, -1) ? 'Ayer' : new Date(`${f}T00:00:00`).toLocaleDateString('es-CO', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return `${dia} · ${corta(f)}`;
};
const tonoGrupo = (g) => `d${1 + ([...String(g ?? '')].reduce((s, c) => s + c.charCodeAt(0), 0) % 4)}`;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export default {
  titulo: 'Mes',
  periodo: true,
  icono: '📅',
  render(main, { rerender }) {
    const { anio, mes } = periodo;
    const clave = claveMes(anio, mes);
    const ingresos = repo.ingresosMes(anio, mes);
    const movs = repo.movimientosMes(anio, mes);
    const saldoAnt = repo.saldoAnteriorInfo(anio, mes);
    const saldoBase = repo.saldoBaseCuentas();
    const n = neto(ingresos);
    const gastado = movs.filter((m) => m.categoria !== 'Ahorro').reduce((s, m) => s + m.monto, 0);
    const ahorrado = movs.filter((m) => m.categoria === 'Ahorro').reduce((s, m) => s + m.monto, 0);
    const saldo = saldoAnt.valor + n.neto - gastado - ahorrado;
    const pres = repo.resumenPresupuesto(anio, mes);
    const filasGasto = repo.gastosMes(anio, mes);
    const pendientes = pendientesDePago(filasGasto, anio, mes);
    const cubiertos = cubiertosConTarjeta(filasGasto, anio, mes);
    const mostrarPendientes = clave >= hoyISO().slice(0, 7);
    const prestamosHasta = repo.proyeccionPagosPrestamos().filter((m) => m.clave <= clave);
    const prestamosPorPagar = prestamosHasta.reduce((t, m) => t + m.porPagar, 0);
    const prestamosAnteriores = prestamosHasta.filter((m) => m.clave < clave).reduce((t, m) => t + m.porPagar, 0);
    const totalPendiente = pendientes.reduce((s, p) => s + p.monto_pago, 0);
    const urgentes = pendientes.filter((p) => p.estado !== 'pendiente').length;

    const porGrupo = new Map();
    for (const m of movs) if (m.categoria !== 'Ahorro') porGrupo.set(m.grupo ?? 'Sin grupo', (porGrupo.get(m.grupo ?? 'Sin grupo') ?? 0) + m.monto);
    const grupos = [...porGrupo].sort((a, b) => b[1] - a[1]);
    const gruposMov = [...new Set(movs.map((m) => m.grupo).filter(Boolean))].sort();
    const cuentasMov = [...new Set(movs.map((m) => m.cuenta).filter(Boolean))].sort();
    const haySinCuenta = movs.some((m) => !m.cuenta);
    if (filtro.cuenta && filtro.cuenta !== SIN_CUENTA ? !cuentasMov.includes(filtro.cuenta) : filtro.cuenta === SIN_CUENTA && !haySinCuenta) filtro.cuenta = ''; // la cuenta filtrada no tiene movimientos en este mes
    if (filtro.grupo && !gruposMov.includes(filtro.grupo)) filtro.grupo = '';
    const personasMov = [...new Set(movs.map((m) => m.persona).filter(Boolean))].sort();

    // --- Último registro anotado (en cualquier mes) ---
    const ult = repo.ultimoRegistro();
    const ultEnMes = !!ult && (ult.tipo === 'movimiento' ? ult.fecha.startsWith(clave) : ult.anio === anio && ult.mes === mes);
    const franjaUlt = ult ? (() => {
      const hace = haceTiempo(ult.creado_en);
      const cuando = ult.tipo === 'movimiento' ? corta(ult.fecha) : `${MESES[ult.mes - 1].toLowerCase()} ${ult.anio}`;
      const monto = ult.tipo === 'ingreso' && ult.clase === 'descuento' ? `− ${cop(ult.monto)}` : cop(ult.monto);
      return `<div class="ult"><span>✓ Último registro</span><b>${esc(ult.concepto)} · ${monto}</b>
        <span>${ult.tipo === 'ingreso' ? 'ingreso · ' : ''}${cuando}${ult.cuenta ? ` · ${esc(ult.cuenta)}` : ''}${hace ? ` · ${hace}` : ''}</span><span class="sp"></span>
        ${ultEnMes ? '<button class="link" data-edit id="ult-editar">Editar</button><button class="link" data-edit id="ult-deshacer">Deshacer</button>' : '<button class="link" id="ult-ir">Ir a ese mes</button>'}</div>`;
    })() : '';

    // --- Barra de registro rápido ---
    const hoyD = new Date();
    const enMesActual = hoyD.getMonth() + 1 === mes && hoyD.getFullYear() === anio;
    const fechaPorDefecto = enMesActual ? hoyISO() : `${anio}-${pad2(mes)}-${pad2(Math.min(hoyD.getDate(), 28))}`;
    const pre = pendienteRapido; pendienteRapido = null;
    const conceptosGasto = repo.conceptos({ soloActivos: true }).filter((c) => c.tipo.startsWith('gasto'));
    const conceptosIng = repo.conceptos({ soloActivos: true }).filter((c) => c.tipo === 'ingreso' || c.tipo === 'descuento');
    const fechaRapida = ultima.fecha && ultima.fecha.startsWith(clave) ? ultima.fecha : fechaPorDefecto;
    const camposMov = [
      { name: 'fecha', label: 'Fecha', type: 'date', value: fechaRapida, required: true },
      { name: 'concepto_id', label: 'Concepto', type: 'buscar', required: true, options: conceptosGasto.map((c) => [c.id, c.grupo ? `${c.grupo} · ${c.nombre}` : c.nombre]), value: pre?.concepto_id },
      { name: 'monto', label: 'Monto', type: 'money', value: pre?.monto, required: true },
      { name: 'cuenta_id', label: 'Cuenta', type: 'select', options: nombresCuentas(), vacio: '—', value: ultimaCuenta },
      ...(verMas ? [{ name: 'persona_id', label: 'Pagó', type: 'select', options: nombresPersonas(), vacio: '—', value: ultima.persona },
        { name: 'nota', label: 'Nota', type: 'text' }] : []),
    ];
    const camposIng = [
      { name: 'concepto_id', label: 'Concepto', type: 'buscar', required: true, options: conceptosIng.map((c) => [c.id, c.nombre]) },
      { name: 'clase', label: 'Clase', type: 'select', options: CLASES, value: 'sueldo' },
      { name: 'quincena', label: 'Quincena', type: 'select', options: [['1', 'Primera'], ['2', 'Segunda']], value: 1 },
      { name: 'monto', label: 'Monto', type: 'money', required: true },
      { name: 'cuenta_id', label: 'Cuenta', type: 'select', options: nombresCuentas(), vacio: '—' },
      ...(verMas ? [{ name: 'persona_id', label: 'Persona', type: 'select', options: nombresPersonas(), vacio: '—' }, { name: 'nota', label: 'Nota', type: 'text' }] : []),
    ];
    const esIng = pestana === 'ingresos';
    const campos = esIng ? camposIng : camposMov;
    const hayConceptos = (esIng ? conceptosIng : conceptosGasto).length > 0;
    const barraHTML = pestana === 'porpagar' ? '' : hayConceptos ? `<form class="rapido" id="rapido" method="dialog" data-edit>
        <div class="rapido-t"><b>${esIng ? 'Registrar ingreso o descuento' : 'Registrar movimiento'}</b><span class="muted">Enter guarda y deja listo el siguiente</span><span class="sp"></span>
          <button type="button" class="link" id="mas-campos">${verMas ? '− Menos campos' : '+ Más campos'}</button><kbd title="Atajo: pulsa N para ir a la barra">N</kbd></div>
        <div class="rapido-campos">${camposHTML(campos)}<button class="primary" id="guardar-rapido">Guardar</button></div>
        <div class="previa" hidden></div><p class="err" hidden></p></form>`
      : `<div class="card"><p class="muted">Primero crea conceptos de ${esIng ? 'tipo Ingreso o Descuento' : 'gasto'} en la vista Conceptos para poder registrar aquí.</p></div>`;

    // --- Pestañas ---
    const tabs = [['movimientos', 'Movimientos', movs.length, false], ['ingresos', 'Ingresos y descuentos', ingresos.length, false],
      ...(mostrarPendientes ? [['porpagar', 'Por pagar', pendientes.length + (prestamosPorPagar > 0 ? 1 : 0), urgentes > 0]] : [])];
    if (!tabs.some((t) => t[0] === pestana)) pestana = 'movimientos';

    // --- Contenido de cada pestaña ---
    const filaMov = (m) => {
      const ultima_ = ult?.tipo === 'movimiento' && ult.id === m.id;
      const sub = [m.grupo, m.persona, m.cuenta].filter(Boolean).map(esc).join(' · ');
      return `<div class="mv ${ultima_ ? 'nuevo' : ''}" data-mov-fila data-dia="${m.fecha}" data-q="${esc((m.concepto + ' ' + (m.nota ?? '') + ' ' + (m.grupo ?? '')).toLowerCase())}"
          data-grupo="${esc(m.grupo ?? '')}" data-persona="${esc(m.persona ?? '')}" data-cuenta="${esc(m.cuenta ?? SIN_CUENTA)}" data-monto="${m.monto}">
        <div class="dot ${m.categoria === 'Ahorro' ? 'd3' : tonoGrupo(m.grupo)}">${iconoGrupo(m.grupo, m.categoria)}</div>
        <div class="tx"><b>${esc(m.concepto)}${ultima_ ? '<span class="badge">último</span>' : ''}${m.nota ? ` <span class="muted">· ${esc(m.nota)}</span>` : ''}</b><span>${sub}</span></div>
        <span class="acc" data-edit><button class="link" data-mov="editar" data-id="${m.id}">Editar</button><button class="link danger" data-mov="borrar" data-id="${m.id}">Quitar</button></span>
        <span class="mo">${cop(m.monto)}</span></div>`;
    };
    const tabMovimientos = () => {
      if (!movs.length) return '<div class="vacio-mes"><p class="muted">Aún no hay movimientos en este mes. Usa la barra de arriba para registrar el primero.</p></div>';
      const dias = [...new Set(movs.map((m) => m.fecha))];
      return `<div class="fichas"><input type="search" id="f-q" placeholder="🔍  Buscar concepto o nota…" value="${esc(filtro.q)}">
          ${['', ...gruposMov].map((g) => `<button type="button" class="ficha ${g === filtro.grupo ? 'on' : ''}" data-grupo="${esc(g)}">${g ? esc(g) : 'Todos'}</button>`).join('')}
          <select id="f-persona"><option value="">Quien pagó: todos</option>${personasMov.map((p) => `<option ${p === filtro.persona ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
          ${cuentasMov.length ? `<select id="f-cuenta"><option value="">Cuenta: todas</option>${cuentasMov.map((c) => `<option ${c === filtro.cuenta ? 'selected' : ''}>${esc(c)}</option>`).join('')}${haySinCuenta ? `<option value="${SIN_CUENTA}" ${filtro.cuenta === SIN_CUENTA ? 'selected' : ''}>Sin cuenta</option>` : ''}</select>` : ''}</div>
        <div class="feed" id="movs">${dias.map((f) => `<div class="dia" data-dia="${f}"><b>${etiquetaDia(f)}</b><span class="sp"></span><span class="dia-res"></span></div>${movs.filter((m) => m.fecha === f).map(filaMov).join('')}`).join('')}</div>
        <div class="feed-total"><span id="total-etiqueta">Total</span><b id="total-mov">${cop(gastado + ahorrado)}</b></div>`;
    };
    const filaIng = (i) => {
      const ultima_ = ult?.tipo === 'ingreso' && ult.id === i.id;
      const sub = [i.persona, i.cuenta].filter(Boolean).map(esc).join(' · ');
      return `<div class="mv ${ultima_ ? 'nuevo' : ''}">
        <div class="dot ${i.clase === 'descuento' ? 'd2' : 'd3'}">${i.clase === 'descuento' ? '➖' : '💵'}</div>
        <div class="tx"><b>${esc(i.concepto)}${ultima_ ? '<span class="badge">último</span>' : ''} <span class="tag ${i.clase}">${esc(CLASES.find((c) => c[0] === i.clase)[1])}</span>${i.nota ? ` <span class="muted">· ${esc(i.nota)}</span>` : ''}</b><span>${sub}</span></div>
        <span class="acc" data-edit><button class="link" data-ing="editar" data-id="${i.id}">Editar</button><button class="link danger" data-ing="borrar" data-id="${i.id}">Quitar</button></span>
        <span class="mo ${i.clase === 'descuento' ? 'neg' : ''}">${i.clase === 'descuento' ? '−' : ''}${cop(i.monto)}</span></div>`;
    };
    const tabIngresos = () => {
      if (!ingresos.length) {
        const ant = mesAnterior(anio, mes);
        const hayAnterior = repo.ingresosMes(ant.anio, ant.mes).length > 0;
        return `<div class="vacio-mes"><p class="muted">Sin ingresos registrados este mes. Usa la barra de arriba${hayAnterior ? ' o copia los del mes anterior' : ''}.</p>
          ${hayAnterior ? '<button class="secondary" id="copiar-ing" data-edit>Copiar del mes anterior</button>' : ''}</div>`;
      }
      return `<div class="feed">${[1, 2].map((q) => { const l = ingresos.filter((i) => i.quincena === q); return l.length
        ? `<div class="dia"><b>${q}ª quincena</b><span class="sp"></span><span>neto ${cop(neto(l).neto)}</span></div>${l.map(filaIng).join('')}` : ''; }).join('')}</div>
        <div class="feed-total"><span>Neto del mes</span><b>${cop(n.neto)}</b></div>`;
    };
    const tabPorPagar = () => `${prestamosPorPagar > 0 ? `<div class="fila-pago"><span class="pill w">Cuotas</span><span class="fp-nombre">🏦 Autopréstamos hasta ${MESES[mes - 1].toLowerCase()}</span>
        ${prestamosAnteriores > 0 ? `<span class="muted">incluye ${cop(prestamosAnteriores)} de meses anteriores</span>` : ''}<span class="sp"></span><b class="num">${cop(prestamosPorPagar)}</b>
        <button class="secondary" data-edit data-pagar-prestamos>Pagar…</button></div>` : ''}
      ${cubiertos.length ? `<p class="muted">💳 Cubierto con tarjeta este mes: ${cubiertos.map((c) => `${esc(c.nombre)} <b>${cop(c.cubierto)}</b>`).join(' · ')} (se paga con la tarjeta)</p>` : ''}
      ${pendientes.length ? pendientes.map((p) => `<div class="fila-pago"><span class="pill ${p.estado === 'vencido' ? 'r' : p.estado === 'proximo' ? 'w' : 'n'}">${ESTADO_PAGO[p.estado]}</span>
        <span class="fp-nombre">${esc(p.nombre)}${p.quincenal ? ` <span class="chip">${p.pago}ª quincena</span>` : ''}${p.grupo ? ` <span class="muted">· ${esc(p.grupo)}</span>` : ''}</span>
        <span class="muted">vence ${corta(p.vence)}${p.responsable ? ` · ${esc(p.responsable)}` : ''}</span><span class="sp"></span><b class="num">${p.monto_pago ? cop(p.monto_pago) : '—'}</b>
        <button class="secondary" data-edit data-pagar="${p.id}-${p.pago}">Registrar</button></div>`).join('')
        : '<p class="muted">Todo lo que tiene fecha de pago ya tiene su movimiento este mes. ✅</p>'}
      ${pendientes.length ? `<p class="muted">${plural(pendientes.length, 'pendiente', 'pendientes')} · ${cop(totalPendiente)} estimados.</p>` : ''}`;
    const contenido = pestana === 'ingresos' ? tabIngresos() : pestana === 'porpagar' ? tabPorPagar() : tabMovimientos();

    const pctPres = pres.previsto ? Math.round((pres.ejecutado / pres.previsto) * 100) : null;
    const node = el(`<div>
      <div class="res-mes">
        <div class="big"><small>Saldo del mes</small><b class="${saldo < 0 ? 'neg' : 'pos'}">${cop(saldo)}</b></div>
        <div class="chips-res">
          <div class="c"><small>Ingresos</small><b>${cop(n.neto)}</b></div>
          <div class="c"><small>Gastado</small><b>${cop(gastado)}</b></div>
          <div class="c"><small>Ahorro</small><b>${cop(ahorrado)}</b></div>
          <div class="c"><small>Presupuesto usado</small><b>${pctPres === null ? '—' : `${pctPres} %`}</b></div>
          <button class="link" id="detalle-btn">${verDetalle ? 'Ocultar detalle ▴' : 'Ver detalle ▾'}</button>
        </div>
      </div>
      ${verDetalle ? `<div class="kpis">
        <div class="kpi"><small>Saldo anterior <span class="chip">${saldoAnt.manual ? 'manual' : 'automático'}</span> <button class="link" id="saldo" data-edit>editar</button></small><b>${cop(saldoAnt.valor)}</b>${!saldoAnt.manual && saldoBase ? ` <small class="muted">incluye ${cop(saldoBase)} de saldos iniciales de cuentas</small>` : ''}</div>
        <div class="kpi ingreso"><small>Ingresos</small><b>${cop(n.ingresos)}</b></div>
        <div class="kpi descuento"><small>Descuentos</small><b>${cop(n.descuentos)}</b></div>
        <div class="kpi presupuesto"><small>Presupuesto de gastos</small><b>${cop(pres.ejecutado)}</b> <span class="muted">de ${cop(pres.previsto)}</span>
          ${barraPresupuesto(pres.previsto, pres.ejecutado)}</div></div>
        ${grupos.length ? `<div class="card"><div class="fila"><h2>🗂️ Gasto por grupo</h2></div>
          <table><tbody>${grupos.map(([g, t]) => `<tr><td>${esc(g)}</td><td class="num">${cop(t)}</td><td class="num muted">${gastado ? Math.round((t / gastado) * 100) : 0} %</td></tr>`).join('')}</tbody></table></div>` : ''}` : ''}
      ${barraHTML}
      ${franjaUlt}
      <div class="tabs-mes">${tabs.map(([k, t, c, alerta_]) => `<button type="button" class="tab ${k === pestana ? 'on' : ''}" data-tab="${k}">${t}<span class="${alerta_ ? 'alerta' : ''}">${c}</span></button>`).join('')}</div>
      <div class="tab-contenido">${contenido}</div>
    </div>`);

    // --- Eventos ---
    node.querySelector('#detalle-btn').onclick = () => { verDetalle = !verDetalle; rerender(); };
    node.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { pestana = b.dataset.tab; rerender(); }));
    node.querySelector('#copiar-ing')?.addEventListener('click', () => intentar(() => { repo.copiarIngresos(anio, mes); rerender(); }));
    node.querySelector('[data-pagar-prestamos]')?.addEventListener('click', () => pagarMes(anio, mes, rerender));
    node.querySelectorAll('button[data-pagar]').forEach((b) => (b.onclick = () => {
      const p = pendientes.find((x) => `${x.id}-${x.pago}` === b.dataset.pagar);
      const tarjeta = repo.tarjetaDeConcepto(p.id);
      if (tarjeta) return pagarMesTarjeta(tarjeta, anio, mes, rerender);
      pendienteRapido = { concepto_id: p.id, monto: p.monto_pago || undefined };   // pasa a la barra: ahí se confirma el monto
      pestana = 'movimientos'; enfocar = 'monto';
      rerender();
    }));
    node.querySelector('#saldo')?.addEventListener('click', async () => {
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
    });

    // Último registro: editar, deshacer o ir a su mes
    node.querySelector('#ult-ir')?.addEventListener('click', () => { periodo.anio = ult.anio; periodo.mes = ult.mes; rerender(); });
    node.querySelector('#ult-editar')?.addEventListener('click', () => (ult.tipo === 'movimiento'
      ? editarMovimiento(movs.find((m) => m.id === ult.id), rerender) : editarIngreso(ingresos.find((i) => i.id === ult.id), rerender)));
    node.querySelector('#ult-deshacer')?.addEventListener('click', async () => {
      if (await confirmar(`¿Quitar el último registro (${ult.concepto})?`, 'Quitar')) intentar(() => { (ult.tipo === 'movimiento' ? repo.eliminarMovimiento : repo.eliminarIngreso)(ult.id); rerender(); });
    });

    // Barra de registro rápido
    const form = node.querySelector('#rapido');
    if (form) {
      const { preparar } = enlazarFormulario(form, campos, esIng ? null : (c) => (bloqueaTarjeta({}, c.concepto_id) ? `<p class="err">💳 ${AVISO_TARJETA}</p>` : ''));
      form.querySelector('#mas-campos').onclick = () => { verMas = !verMas; rerender(); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const r = preparar();
        if (!r.ok) return;
        const v = r.out;
        if (!esIng && bloqueaTarjeta({}, v.concepto_id)) return alerta(AVISO_TARJETA);
        const monto = parseMonto(v.monto);
        const guardado = await intentar(() => {
          if (esIng) {
            if (!(monto > 0)) throw new Error('El monto debe ser un número mayor que cero.');
            repo.guardarIngreso({ anio, mes, concepto_id: Number(v.concepto_id), clase: v.clase, quincena: Number(v.quincena), monto, nota: v.nota,
              persona_id: v.persona_id ? Number(v.persona_id) : null, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null });
          } else {
            if (!Number.isFinite(monto) || monto === 0) throw new Error('El monto debe ser un número distinto de cero.');
            repo.guardarMovimiento({ fecha: v.fecha, concepto_id: Number(v.concepto_id), monto, nota: v.nota,
              persona_id: v.persona_id ? Number(v.persona_id) : null, cuenta_id: v.cuenta_id ? Number(v.cuenta_id) : null });
            ultima.fecha = v.fecha; ultimaCuenta = v.cuenta_id; ultima.persona = v.persona_id ?? '';
          }
          enfocar = 'concepto';
          rerender();
          return true;
        });
        return guardado;
      };
    }
    if (enfocar) {
      const donde = enfocar; enfocar = null;
      setTimeout(() => node.querySelector(donde === 'monto' ? '#rapido [name=monto]' : '#rapido [data-bq-in]')?.focus(), 0);
    }

    // Filtro de movimientos: oculta filas y recalcula subtotales y total sin re-renderizar (así no se pierde el foco).
    const aplicarFiltro = () => {
      const filas = [...node.querySelectorAll('[data-mov-fila]')];
      if (!filas.length) return;
      let total = 0, visibles = 0;
      const porDia = new Map();
      for (const f of filas) {
        const ok = (!filtro.q || f.dataset.q.includes(filtro.q.toLowerCase())) && (!filtro.grupo || f.dataset.grupo === filtro.grupo)
          && (!filtro.persona || f.dataset.persona === filtro.persona) && (!filtro.cuenta || f.dataset.cuenta === filtro.cuenta);
        f.hidden = !ok;
        if (ok) { total += Number(f.dataset.monto); visibles++; const d = porDia.get(f.dataset.dia) ?? { n: 0, t: 0 }; d.n++; d.t += Number(f.dataset.monto); porDia.set(f.dataset.dia, d); }
      }
      node.querySelectorAll('.dia[data-dia]').forEach((h) => {
        const d = porDia.get(h.dataset.dia);
        h.hidden = !d;
        if (d) h.querySelector('.dia-res').textContent = `${plural(d.n, 'movimiento', 'movimientos')} · ${cop(d.t)}`;
      });
      const filtrado = filtro.q || filtro.grupo || filtro.persona || filtro.cuenta;
      node.querySelector('#total-mov').textContent = cop(total);
      node.querySelector('#total-etiqueta').textContent = filtrado ? `Total filtrado (${visibles} de ${filas.length})` : 'Total';
    };
    node.querySelector('#f-q')?.addEventListener('input', (e) => { filtro.q = e.target.value.trim(); aplicarFiltro(); });
    node.querySelectorAll('.ficha[data-grupo]').forEach((b) => (b.onclick = () => {
      filtro.grupo = b.dataset.grupo;
      node.querySelectorAll('.ficha').forEach((x) => x.classList.toggle('on', x.dataset.grupo === filtro.grupo));
      aplicarFiltro();
    }));
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

// Atajo «N»: lleva el cursor a la barra de registro rápido (si hay una en pantalla y no se está escribiendo).
if (!atajoPuesto) {
  atajoPuesto = true;
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target?.closest?.('input, textarea, select, dialog, [contenteditable]')) return;
    const campo = document.querySelector('#rapido [data-bq-in]');
    if (campo) { e.preventDefault(); campo.focus(); }
  });
}
