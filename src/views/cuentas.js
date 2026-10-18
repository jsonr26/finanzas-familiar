import * as repo from '../repo.js';
import { cop, parseMonto, MESES } from '../calc.js';
import { esc, el, formulario, confirmar, alerta, intentar } from '../ui.js';
import { periodo } from '../periodo.js';

async function editar(c = {}, rerender) {
  const v = await formulario({
    titulo: c.id ? 'Editar cuenta' : 'Nueva cuenta',
    campos: [
      { name: 'nombre', label: 'Nombre (ej. Banco de Sindy)', type: 'text', value: c.nombre, required: true },
      { name: 'persona_id', label: 'Titular', type: 'select', options: repo.personas().map((p) => [p.id, p.nombre]), vacio: '—', value: c.persona_id },
      { name: 'saldo_inicial', label: 'Saldo inicial (antes del primer ingreso registrado)', type: 'money', value: c.saldo_inicial || '' },
      ...(c.id ? [{ name: 'activo', label: 'Activa', type: 'checkbox', value: !!c.activo }] : []),
    ],
  });
  if (!v) return;
  await intentar(() => {
    const saldo = v.saldo_inicial.trim() ? parseMonto(v.saldo_inicial) : 0;
    if (!Number.isFinite(saldo)) throw new Error('Saldo inicial no válido.');
    repo.guardarCuenta({ ...v, id: c.id, persona_id: v.persona_id ? Number(v.persona_id) : null, saldo_inicial: saldo, activo: c.id ? v.activo : true });
    rerender();
  });
}

async function saldoReal(c, anio, mes, rerender) {
  const v = await formulario({
    titulo: `Saldo real · ${c.nombre}`,
    campos: [{ name: 'saldo', label: `Saldo del banco al cierre de ${MESES[mes - 1]} ${anio}`, type: 'money', value: c.real ?? '', placeholder: `Calculado: ${cop(c.calculado)}` }],
    extra: '<p class="muted">Déjalo vacío para borrar la anotación.</p>',
  });
  if (!v) return;
  await intentar(() => {
    const s = v.saldo.trim() ? parseMonto(v.saldo) : null;
    if (s !== null && !Number.isFinite(s)) throw new Error('Saldo no válido.');
    repo.guardarSaldoReal(c.id, anio, mes, s);
    rerender();
  });
}

export default {
  titulo: 'Cuentas',
  periodo: true,
  icono: '🏛️',
  render(main, { rerender }) {
    const { anio, mes } = periodo;
    const r = repo.saldosCuentas(anio, mes);
    const sig = mes === 12 ? { a: anio + 1, m: 1 } : { a: anio, m: mes + 1 };
    const saldoMes = repo.saldoAnteriorInfo(sig.a, sig.m).valor; // saldo de cierre según la vista Mes
    const hayAjuste = Math.round(r.total) !== Math.round(saldoMes);
    const sinCuenta = r.sinCuenta.ingresos || r.sinCuenta.gastos;
    const dif = (d) => (d === null ? '<span class="muted">—</span>' : Math.round(d) === 0 ? '<span class="pos">✓ cuadra</span>' : `<b class="neg">${cop(d)}</b>`);

    const node = el(`<div>
      <div class="fila"><span class="sp"></span>
        <button class="primary" data-edit id="nueva">+ Nueva cuenta</button></div>
      <div class="card">
        <p class="muted">Saldo calculado = saldo inicial + ingresos netos − gastos, acumulados hasta el cierre de ${MESES[mes - 1]} ${anio}.
          Anota el saldo real del banco para ver si falta registrar algo.</p>
        <table><thead><tr><th>Cuenta</th><th class="num">Saldo inicial</th><th class="num">Ingresos</th><th class="num">Gastos</th>
          <th class="num">Calculado</th><th class="num">Saldo real</th><th class="num">Diferencia</th><th></th></tr></thead>
        <tbody>${r.cuentas.map((c) => `<tr class="${c.activo ? '' : 'baja'}">
          <td><b>${esc(c.nombre)}</b>${c.persona ? ` <span class="muted">· ${esc(c.persona)}</span>` : ''}${c.activo ? '' : ' <span class="tag">Inactiva</span>'}</td>
          <td class="num">${cop(c.saldo_inicial)}</td><td class="num">${cop(c.ingresos)}</td><td class="num">${cop(c.gastos)}</td>
          <td class="num"><b>${cop(c.calculado)}</b></td>
          <td class="num">${c.real === null ? '<span class="muted">—</span>' : cop(c.real)} <button class="link" data-edit data-real="${c.id}">${c.real === null ? 'anotar' : 'editar'}</button></td>
          <td class="num">${dif(c.diferencia)}</td>
          <td class="num" data-edit><button class="link" data-editar="${c.id}">Editar</button>
            ${c.persona_id ? `<button class="link" data-asignar="${c.id}" title="Asigna a esta cuenta los ingresos y movimientos de ${esc(c.persona)} que no tienen cuenta">Asignar registros</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="8" class="muted">Aún no hay cuentas. Crea la de cada banco (por ejemplo, Banco de Sindy y Banco de Jeisson).</td></tr>'}
        ${sinCuenta ? `<tr><td><b>Sin cuenta asignada</b> <span class="tag aviso">revisar</span></td><td class="num">—</td><td class="num">${cop(r.sinCuenta.ingresos)}</td>
          <td class="num">${cop(r.sinCuenta.gastos)}</td><td class="num"><b>${cop(r.sinCuenta.ingresos - r.sinCuenta.gastos)}</b></td><td colspan="3"></td></tr>` : ''}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${cop(r.cuentas.reduce((s, c) => s + c.saldo_inicial, 0))}</td>
          <td class="num">${cop(r.cuentas.reduce((s, c) => s + c.ingresos, 0) + r.sinCuenta.ingresos)}</td>
          <td class="num">${cop(r.cuentas.reduce((s, c) => s + c.gastos, 0) + r.sinCuenta.gastos)}</td>
          <td class="num">${cop(r.total)}</td><td colspan="3"></td></tr></tfoot></table>
        ${hayAjuste ? `<p class="muted">Saldo de cierre según la vista Mes: <b>${cop(saldoMes)}</b>. La diferencia (${cop(r.total - saldoMes)}) viene de los saldos iniciales de las cuentas o de un saldo anterior fijado a mano en Mes.</p>`
          : '<p class="pos">✓ El total de las cuentas coincide con el saldo de cierre de la vista Mes.</p>'}
      </div>
    </div>`);
    node.querySelector('#nueva').onclick = () => editar({}, rerender);
    const porId = (id) => r.cuentas.find((c) => c.id === Number(id));
    node.querySelectorAll('button[data-editar]').forEach((b) => (b.onclick = () => editar(porId(b.dataset.editar), rerender)));
    node.querySelectorAll('button[data-real]').forEach((b) => (b.onclick = () => saldoReal(porId(b.dataset.real), anio, mes, rerender)));
    node.querySelectorAll('button[data-asignar]').forEach((b) => (b.onclick = async () => {
      const c = porId(b.dataset.asignar);
      if (!(await confirmar(`¿Asignar a «${c.nombre}» todos los ingresos y movimientos de ${c.persona} que no tienen cuenta?`, 'Asignar'))) return;
      await intentar(async () => { const n = repo.asignarCuentaPorPersona(c.id); rerender(); await alerta(`Se asignaron ${n} registro${n === 1 ? '' : 's'}.`); });
    }));
    main.replaceChildren(node);
  },
};
