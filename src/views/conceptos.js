import * as repo from '../repo.js';
import { describirPago, parseMonto, cop, FRECUENCIAS, frecuenciaDe, desdeFrecuencia, MESES } from '../calc.js';
import { esc, el, formulario, confirmar, alerta, intentar } from '../ui.js';
import * as storage from '../storage.js';

const CATEGORIAS = [['Gasto', 'Gasto'], ['Ahorro', 'Ahorro']];

async function editar(c = {}, rerender) {
  const esGasto = (t) => t === 'gasto_fijo' || t === 'gasto_variable';
  const v = await formulario({
    titulo: c.id ? 'Editar concepto' : 'Nuevo concepto',
    campos: [
      { name: 'tipo', label: 'Tipo', type: 'select', options: Object.entries(repo.TIPOS), value: c.tipo ?? 'gasto_fijo' },
      { name: 'nombre', label: 'Nombre', type: 'text', value: c.nombre, required: true },
      { name: 'grupo', label: 'Grupo', type: 'buscar', options: repo.grupos().map((g) => [g, g]), vacio: '—', value: c.grupo, agregar: 'Nuevo grupo…' },
      { name: 'categoria', label: 'Categoría (si eliges una caja de ahorro, siempre es Ahorro)', type: 'select', options: CATEGORIAS, value: c.categoria ?? 'Gasto' },
      { name: 'caja_id', label: 'Caja de ahorro donde se abona el pago', type: 'select', vacio: '—', value: c.caja_id,
        options: repo.cajas(false).filter((x) => x.activo || x.id === c.caja_id).map((x) => [x.id, x.nombre]) },
      { name: 'frecuencia', label: 'Frecuencia', type: 'select', options: Object.entries(FRECUENCIAS), value: frecuenciaDe({ periodicidad: c.periodicidad ?? 'mensual', cada_meses: c.cada_meses, quincenal: c.quincenal }) },
      { name: 'fecha_pago', label: 'Fecha de pago (mensual: el día; cada 2/3/6 meses: uno de los pagos; anual: día y mes; quincenal: no hace falta)', type: 'date', value: c.fecha_pago },
      { name: 'monto_estimado', label: 'Monto estimado para el presupuesto (ingresos, descuentos y gastos)', type: 'money', value: c.monto_estimado || '' },
      { name: 'responsable_id', label: 'Responsable del pago', type: 'select', options: repo.personas().map((p) => [p.id, p.nombre]), vacio: '—', value: c.responsable_id },
      { name: 'presupuestado', label: 'Presupuestado', type: 'checkbox', value: c.id ? c.presupuestado : true },
      { name: 'notas', label: 'Notas (detalle del concepto)', type: 'textarea', value: c.notas, placeholder: 'Ej. contrato, número de cuenta, condiciones…' },
      ...(c.id ? [
        { name: 'activo', label: 'Activo', type: 'checkbox', value: !!c.activo },
        { name: 'fecha_baja', label: 'Inactivo desde (si lo desmarcas; vacío = hoy). Desde ese mes deja de contar en presupuesto, proyección y pendientes', type: 'date', value: c.fecha_baja },
      ] : []),
    ],
  });
  if (!v) return;
  await intentar(() => {
    const monto = v.monto_estimado.trim() ? parseMonto(v.monto_estimado) : 0;
    if (!Number.isFinite(monto) || monto < 0) throw new Error('El monto estimado debe ser un número válido (0 o mayor).');
    repo.guardarConcepto({
      ...v, ...desdeFrecuencia(v.frecuencia), id: c.id, monto_estimado: monto, caja_id: v.caja_id ? Number(v.caja_id) : null,
      ...(c.id ? { activo: v.activo, fecha_baja: v.fecha_baja || undefined } : {}),
      responsable_id: v.responsable_id ? Number(v.responsable_id) : null,
    });
    rerender();
  });
}

const ICONO_TIPO = { ingreso: '💵', descuento: '✂️', gasto_fijo: '📌', gasto_variable: '🛒' };
let verBajas = false;

const filaConcepto = (c) => {
  const meta = [describirPago(c) && `${c.quincenal ? '⏱️' : c.periodicidad === 'mensual' ? (c.cada_meses > 1 ? '🔂' : '🔁') : c.periodicidad === 'anual' ? '📅' : '📍'} ${describirPago(c)}`,
    c.monto_estimado > 0 && `💰 ${cop(c.monto_estimado)}`,
    c.caja && `🐷 abona a «${c.caja}»`,
    c.responsable && `👤 ${c.responsable}`].filter(Boolean).join(' · ');
  return `<div class="item ${c.activo ? '' : 'baja'}" data-q="${esc((c.nombre + ' ' + (c.grupo ?? '') + ' ' + (c.notas ?? '')).toLowerCase())}">
    <div class="item-main"><b>${esc(c.nombre)}</b>${meta ? `<small>${esc(meta)}</small>` : ''}${c.notas ? `<span class="nota">${esc(c.notas)}</span>` : ''}</div>
    <div class="item-tags">
      ${c.categoria === 'Ahorro' ? '<span class="tag ahorro">🐷 Ahorro</span>' : ''}
      ${c.presupuestado ? '' : '<span class="tag aviso">Sin presupuesto</span>'}
      ${c.activo ? '' : `<span class="tag" title="No cuenta en presupuesto, proyección ni pendientes desde ese mes">De baja${c.fecha_baja ? ` desde ${MESES[Number(c.fecha_baja.slice(5, 7)) - 1].slice(0, 3).toLowerCase()} ${c.fecha_baja.slice(0, 4)}` : ''}</span>`}
    </div>
    <div class="item-actions" data-edit>
      <button class="icon" title="Editar" data-a="editar" data-id="${c.id}">✏️</button>
      <button class="icon" title="${c.activo ? 'Dar de baja' : 'Reactivar'}" data-a="${c.activo ? 'baja' : 'reactivar'}" data-id="${c.id}">${c.activo ? '⏸' : '▶️'}</button>
      <button class="icon danger" title="Eliminar" data-a="eliminar" data-id="${c.id}">🗑</button>
    </div></div>`;
};

function seccion(tipo, nombre, lista) {
  const grupos = [...new Set(lista.map((c) => c.grupo ?? ''))].sort((a, b) => (a === '' ) - (b === '') || a.localeCompare(b));
  const cuerpo = grupos.map((g) => `<div class="grupo" >
      ${grupos.length > 1 || g ? `<div class="grupo-titulo">${esc(g || 'Sin grupo')}</div>` : ''}
      ${lista.filter((c) => (c.grupo ?? '') === g).map(filaConcepto).join('')}</div>`).join('');
  return `<section class="card seccion ${tipo}">
    <header><span>${ICONO_TIPO[tipo]}</span><h2>${esc(nombre)}</h2><span class="n">${lista.length}</span><span class="sp"></span>
      <button class="secondary" data-edit data-nuevo="${tipo}">+ Agregar</button></header>
    ${cuerpo || '<div class="vacio">Aún no hay conceptos de este tipo.</div>'}</section>`;
}

// Texto con el que debe abrirse la lista (lo fija la paleta global al elegir un concepto).
let busquedaInicial = '';
export const buscarConcepto = (t) => { busquedaInicial = t; };

export default {
  titulo: 'Conceptos',
  icono: '🏷️',
  render(main, { rerender }) {
    const lista = repo.conceptos().filter((c) => verBajas || c.activo);
    const todos = repo.conceptos();
    const personas = repo.personas(false);
    const node = el(`<div>
      <div class="barra">
        <input type="search" id="buscar" placeholder="🔍  Buscar concepto o grupo…">
        <label><input type="checkbox" id="bajas" ${verBajas ? 'checked' : ''}> Mostrar inactivos (${todos.filter((c) => !c.activo).length})</label>
        <span class="sp" style="flex:1"></span>
        <button class="primary" data-edit id="nuevo">+ Nuevo concepto</button>
      </div>
      ${Object.entries(repo.TIPOS).map(([t, n]) => seccion(t, n, lista.filter((c) => c.tipo === t))).join('')}
      <section class="card"><div class="fila"><h2>👥 Personas</h2><span class="sp"></span>
        <button class="secondary" data-edit id="nueva-persona">+ Nueva persona</button></div>
        <div class="personas">${personas.map((p) => `<span class="persona"><i>${esc(p.nombre.trim()[0]?.toUpperCase() ?? '?')}</i>${esc(p.nombre)}</span>`).join('') || '<span class="muted">Sin personas.</span>'}</div></section>
      <section class="card peligro"><div class="fila"><h2>⚠️ Zona de peligro</h2></div>
        <p class="muted">Borra <b>todos</b> los datos (movimientos, ingresos, conceptos, personas, cuentas, tarjetas, cajas, préstamos y presupuesto) y deja la app vacía.
          Antes se guarda una copia en la carpeta <code>backups</code>.</p>
        <button class="secondary danger-btn" data-edit id="borrar-todo">Borrar todos los datos…</button></section>
    </div>`);

    node.querySelector('#borrar-todo').onclick = async () => {
      const v = await formulario({
        titulo: 'Borrar todos los datos',
        textoOk: 'Borrar todo',
        campos: [{ name: 'confirmacion', label: 'Escribe BORRAR para confirmar', type: 'text', required: true }],
        extra: '<p>Se eliminarán <b>todos</b> los registros de esta carpeta. Se guardará antes una copia en <code>backups</code>, pero la app quedará vacía.</p>',
      });
      if (!v) return;
      if (v.confirmacion.trim() !== 'BORRAR') return alerta('No se borró nada: la palabra de confirmación no coincide.');
      await intentar(async () => {
        const copia = await storage.respaldarAhora('antes-de-borrar');
        repo.borrarTodo();
        rerender();
        await alerta(`Listo, la app quedó vacía. La copia anterior está en backups/${copia}.`);
      });
    };
    node.querySelector('#nuevo').onclick = () => editar({}, rerender);
    node.querySelectorAll('[data-nuevo]').forEach((b) => (b.onclick = () => editar({ tipo: b.dataset.nuevo }, rerender)));
    node.querySelector('#bajas').onchange = (e) => { verBajas = e.target.checked; rerender(); };
    const filtrar = (texto) => {
      const q = texto.trim().toLowerCase();
      node.querySelectorAll('.item').forEach((i) => (i.hidden = q && !i.dataset.q.includes(q)));
      node.querySelectorAll('.grupo').forEach((g) => (g.hidden = q && ![...g.querySelectorAll('.item')].some((i) => !i.hidden)));
    };
    node.querySelector('#buscar').oninput = (e) => filtrar(e.target.value);
    if (busquedaInicial) { node.querySelector('#buscar').value = busquedaInicial; filtrar(busquedaInicial); busquedaInicial = ''; }
    node.querySelector('#nueva-persona').onclick = async () => {
      const v = await formulario({ titulo: 'Nueva persona', campos: [{ name: 'nombre', label: 'Nombre', type: 'text', required: true }] });
      if (v?.nombre.trim()) await intentar(() => { repo.crearPersona(v.nombre.trim()); rerender(); });
    };
    node.querySelectorAll('button[data-a]').forEach((b) => (b.onclick = async () => {
      const id = Number(b.dataset.id);
      const c = todos.find((x) => x.id === id);
      switch (b.dataset.a) {
        case 'editar': return editar(c, rerender);
        case 'baja': {
          const deuda = repo.deudaPendienteConcepto(id);
          if (deuda > 0 && !(await confirmar(`«${c.nombre}» todavía tiene ${cop(deuda)} en cuotas sin pagar. Si lo das de baja, esas cuotas dejan de aparecer en el presupuesto desde este mes. ¿Continuar?`, 'Dar de baja'))) return;
          return intentar(() => { repo.darDeBaja(id); rerender(); });
        }
        case 'reactivar': return intentar(() => { repo.reactivar(id); rerender(); });
        case 'eliminar':
          if (await confirmar(`¿Eliminar «${c.nombre}»? Esta acción no se puede deshacer.`, 'Eliminar'))
            return intentar(() => { repo.eliminarConcepto(id); rerender(); });
      }
    }));
    main.replaceChildren(node);
  },
};
