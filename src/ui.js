// Utilidades de interfaz (solo dependen de calc.js, que es lógica pura).
import { formatearEntrada, coincide, esExpresion, evaluarExpresion, formatoDinero } from './calc.js';
import { abrirCalculadora } from './calculadora.js';
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const opciones = (items, valor, { vacio } = {}) =>
  (vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : '') +
  items.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(valor ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');

/**
 * Formulario modal.
 * campos: [{name,label,type:'text'|'number'|'date'|'select'|'buscar'|'checkbox'|'money'|'decimal'|'textarea'|'lista-monto', value, options, required, placeholder}]
 * `buscar` es un `select` con buscador (mismas `options`, `vacio`, `agregar`): se escribe para filtrar, flechas/Enter para elegir.
 * `money` da formato de miles al escribir y acepta operaciones (`1.200.000 + 350.000 * 2`, Enter las convierte en su resultado; el botón 🧮 aparece al editar el campo); `decimal` es un número libre (tasas, porcentajes).
 * `lista-monto` ({items:[{id,label,sugerido}], value:[{id,monto}]}): lista con buscador de casillas, cada una con su monto; devuelve [{id, monto}] (monto como texto) solo de las marcadas.
 * `vistaPrevia(valores)` devuelve HTML que se actualiza en vivo debajo de los campos (o '' para ocultarlo).
 * Devuelve una promesa con el objeto de valores, o null si se cancela.
 * Con `otro` ('Guardar y agregar otro') aparece un segundo botón de envío y el resultado trae `__otro: true` si se usó.
 */
export function formulario({ titulo, campos, textoOk = 'Guardar', extra = '', otro = '', vistaPrevia = null }) {
  return new Promise((resolve) => {
    const dlg = el(`<dialog class="modal"><form method="dialog">
      <h3>${esc(titulo)}</h3>
      ${campos.map((c) => (c.type === 'lista-monto' || c.type === 'buscar'
        ? `<div class="campo"><span>${esc(c.label)}</span>${controlHTML(c)}</div>`
        : `<label class="campo ${c.type === 'checkbox' ? 'chk' : ''}"><span>${esc(c.label)}</span>${controlHTML(c)}</label>`)).join('')}
      ${vistaPrevia ? '<div class="previa" hidden></div>' : ''}
      ${extra}
      <p class="err" hidden></p>
      <div class="acciones"><button type="button" class="secondary" value="cancel">Cancelar</button>${otro ? `<button class="secondary" value="otro">${esc(otro)}</button>` : ''}<button class="primary" value="ok">${esc(textoOk)}</button></div>
    </form></dialog>`);
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const cerrar = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    for (const c of campos.filter((x) => x.agregar)) {
      const sel = form.elements[c.name], nuevo = form.elements[`${c.name}__nuevo`];
      sel.onchange = () => { nuevo.hidden = sel.value !== NUEVO; if (!nuevo.hidden) nuevo.focus(); };
    }
    dlg.querySelector('[value=cancel]').onclick = () => cerrar(null);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(null); });
    // --- Campos de dinero: aceptan operaciones; Enter, «=» o salir del campo las convierten en su resultado ---
    const pistaDinero = (inp) => {
      const hint = inp.closest('.dinero')?.querySelector('.calc-hint');
      if (!hint) return;
      if (!esExpresion(inp.value)) { hint.hidden = true; return; }
      try { hint.textContent = `= $ ${formatoDinero(evaluarExpresion(inp.value))} · Enter para aplicar`; hint.classList.remove('err'); }
      catch (e) { hint.textContent = e.message; hint.classList.add('err'); }
      hint.hidden = false;
    };
    const aplicarDinero = (inp) => {
      if (!esExpresion(inp.value)) return true;
      try { inp.value = formatoDinero(evaluarExpresion(inp.value)); pistaDinero(inp); return true; } catch { return false; }
    };
    const valorDinero = (txt) => { if (!esExpresion(txt)) return txt; try { return formatoDinero(evaluarExpresion(txt)); } catch { return txt; } };
    const leer = () => {
      const out = {};
      for (const c of campos) {
        if (c.type === 'lista-monto') {
          out[c.name] = [...form.querySelectorAll(`[data-lm="${c.name}"] .lm-fila`)].filter((f) => f.querySelector('[data-lm-chk]').checked)
            .map((f) => ({ id: Number(f.dataset.id), monto: valorDinero(f.querySelector('[data-lm-monto]').value) }));
          continue;
        }
        const inp = form.elements[c.name];
        if (c.type === 'checkbox') out[c.name] = inp.checked;
        else if (c.type === 'money') out[c.name] = valorDinero(inp.value);
        else out[c.name] = c.agregar && inp.value === NUEVO ? form.elements[`${c.name}__nuevo`].value.trim() : inp.value;
      }
      return out;
    };
    const previa = dlg.querySelector('.previa');
    const actualizarPrevia = () => {
      if (!previa) return;
      let html = '';
      try { html = vistaPrevia(leer()) || ''; } catch { html = ''; }
      previa.innerHTML = html;
      previa.hidden = !html;
    };
    // --- Campos «buscar»: lista filtrable con teclado ---
    const bq = (nodo) => {
      const caja = nodo.closest('.buscar');
      const c = campos.find((x) => x.name === caja.dataset.bq);
      const valor = caja.querySelector('input[type=hidden]'), texto = caja.querySelector('[data-bq-in]'), lista = caja.querySelector('.bq-lista');
      const items = [...lista.querySelectorAll('li:not(.bq-nada)')];
      const etiqueta = () => items.find((li) => li.dataset.v === valor.value)?.dataset.t ?? '';
      const activo = () => items.findIndex((li) => li.classList.contains('on'));
      const marcar = (i) => { items.forEach((li, j) => li.classList.toggle('on', j === i)); items[i]?.scrollIntoView({ block: 'nearest' }); };
      const filtrar = (q) => {
        let visibles = 0;
        for (const li of items) { const ok = li.dataset.fijo === '1' || coincide(li.dataset.t, q); li.hidden = !ok; if (ok) visibles++; }
        lista.hidden = false;
        marcar(items.findIndex((li) => !li.hidden));
        lista.querySelector('.bq-nada').hidden = items.some((li) => !li.hidden);
        return visibles;
      };
      const cerrarLista = () => { lista.hidden = true; };
      const elegir = (li) => {
        valor.value = li.dataset.v; texto.value = li.dataset.v === '' ? '' : li.dataset.t;
        cerrarLista();
        valor.dispatchEvent(new Event('change', { bubbles: true }));
      };
      return { c, valor, texto, lista, items, etiqueta, activo, marcar, filtrar, cerrarLista, elegir };
    };
    form.addEventListener('focusin', (e) => {
      if (!e.target.matches?.('[data-bq-in]')) return;
      const b = bq(e.target);
      b.filtrar('');   // al entrar se ve la lista completa; al escribir se filtra
      b.marcar(b.items.findIndex((li) => li.dataset.v === b.valor.value && !li.hidden));
      e.target.select();
    });
    form.addEventListener('focusout', (e) => {
      if (!e.target.matches?.('[data-bq-in]')) return;
      const b = bq(e.target);
      b.cerrarLista();
      if (b.texto.value.trim() === '' && b.c.vacio !== undefined && b.valor.value !== '') b.valor.value = '', b.valor.dispatchEvent(new Event('change', { bubbles: true }));
      else b.texto.value = b.valor.value === '' ? '' : b.etiqueta();   // lo escrito sin elegir se descarta
    });
    form.addEventListener('mousedown', (e) => {
      const li = e.target.closest?.('.bq-lista li');
      if (li) { e.preventDefault(); bq(li).elegir(li); }   // preventDefault: el campo no pierde el foco antes de elegir
    });
    form.addEventListener('keydown', (e) => {
      if (!e.target.matches?.('[data-bq-in]')) return;
      const b = bq(e.target);
      const visibles = b.items.map((li, i) => (li.hidden ? -1 : i)).filter((i) => i >= 0);
      const mover = (d) => { if (b.lista.hidden) b.filtrar(b.texto.value); const k = visibles.indexOf(b.activo()); b.marcar(visibles[Math.max(0, Math.min(visibles.length - 1, k + d))]); };
      if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
      else if (e.key === 'Enter' && !b.lista.hidden) { e.preventDefault(); if (b.items[b.activo()]) b.elegir(b.items[b.activo()]); }   // con la lista cerrada, Enter envía el formulario
      else if (e.key === 'Escape' && !b.lista.hidden) { e.preventDefault(); e.stopPropagation(); b.cerrarLista(); b.texto.value = b.valor.value === '' ? '' : b.etiqueta(); }
      else if (e.key === 'Tab' && !b.lista.hidden && b.texto.value.trim() && b.items[b.activo()] && b.texto.value !== b.etiqueta()) b.elegir(b.items[b.activo()]);
    });
    form.addEventListener('input', (e) => {
      const inp = e.target;
      if (inp.matches?.('[data-bq-in]')) { bq(inp).filtrar(inp.value); return; }
      if (inp.matches?.('[data-lm-buscar]')) {   // filtra la lista de conceptos
        const q = inp.value.trim().toLowerCase();
        inp.closest('.lista-monto').querySelectorAll('.lm-fila').forEach((f) => { f.hidden = !!q && !f.dataset.q.includes(q); });
        return;
      }
      if (inp.dataset.fmt === 'money' && esExpresion(inp.value)) { pistaDinero(inp); actualizarPrevia(); return; }   // una operación se deja tal cual
      if (inp.dataset.fmt === 'money') {   // formato de miles conservando la posición del cursor
        pistaDinero(inp);
        const digitosAntes = inp.value.slice(0, inp.selectionStart).replace(/[^\d,]/g, '').length;
        inp.value = formatearEntrada(inp.value);
        let n = 0, i = 0;
        for (; i < inp.value.length && n < digitosAntes; i++) if (/[\d,]/.test(inp.value[i])) n++;
        inp.setSelectionRange(i, i);
      }
      actualizarPrevia();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches?.('[data-lm-buscar]')) e.preventDefault();
      if ((e.key === 'Enter' || e.key === '=') && e.target.matches?.('[data-fmt="money"]') && esExpresion(e.target.value)) {
        e.preventDefault();   // aplica el resultado en vez de enviar el formulario
        aplicarDinero(e.target); actualizarPrevia();
      }
    });
    form.addEventListener('focusout', (e) => {
      if (e.target.matches?.('[data-fmt="money"]') && esExpresion(e.target.value) && aplicarDinero(e.target)) actualizarPrevia();
    });
    form.addEventListener('click', (e) => {
      const btn = e.target.closest?.('.calc-btn');
      if (!btn) return;
      const inp = btn.closest('.dinero').querySelector('input');
      abrirCalculadora({ inicial: inp.value, alUsar: (texto) => { inp.value = texto; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); } });
    });
    form.addEventListener('change', (e) => {
      if (e.target.matches?.('[data-lm-chk]')) {   // al marcar, el monto se sugiere (editable); al desmarcar se limpia
        const m = e.target.closest('.lm-fila').querySelector('[data-lm-monto]');
        m.disabled = !e.target.checked;
        if (!e.target.checked) m.value = '';
        else if (!m.value && m.dataset.sug) m.value = formatearEntrada(String(m.dataset.sug).replace('.', ','));
        else if (!m.value) m.focus();
      }
      actualizarPrevia();
    });
    actualizarPrevia();
    form.onsubmit = (e) => {
      e.preventDefault();
      const mala = [...form.querySelectorAll('[data-fmt="money"]')].find((i) => esExpresion(i.value) && !aplicarDinero(i));
      if (mala) {
        const err = form.querySelector('.err');
        err.textContent = 'Revisa la operación escrita en el campo de dinero.'; err.hidden = false;
        mala.focus();
        return;
      }
      const out = leer();
      const falta = campos.find((c) => c.type === 'buscar' && c.required && !out[c.name]);
      if (falta) {
        const err = form.querySelector('.err');
        err.textContent = `Elige un valor de la lista en «${falta.label}».`; err.hidden = false;
        form.querySelector(`[data-bq="${falta.name}"] [data-bq-in]`).focus();
        return;
      }
      out.__otro = e.submitter?.value === 'otro';
      cerrar(out);
    };
    dlg.showModal();
    form.querySelector('input:not([type=checkbox]):not([type=hidden]), select, textarea')?.focus();
  });
}

const NUEVO = '__nuevo__';

function controlHTML(c) {
  const base = `name="${esc(c.name)}" ${c.required ? 'required' : ''}`;
  switch (c.type) {
    case 'select': {
      const opts = opciones(c.options, c.value, c.vacio !== undefined ? { vacio: c.vacio } : {});
      if (!c.agregar) return `<select ${base}>${opts}</select>`;
      return `<select ${base}>${opts}<option value="${NUEVO}">➕ ${esc(c.agregar)}</option></select>
        <input name="${esc(c.name)}__nuevo" placeholder="Nombre" hidden>`;
    }
    case 'buscar': {
      const items = [...(c.vacio !== undefined ? [['', c.vacio]] : []), ...c.options];
      const actual = String(c.value ?? '');
      const sel = items.find(([v]) => String(v) === actual) ?? (c.vacio !== undefined ? ['', c.vacio] : null);
      const li = items.map(([v, t]) => `<li data-v="${esc(v)}" data-t="${esc(t)}" ${v === '' ? 'data-fijo="1"' : ''}>${esc(t)}</li>`).join('')
        + (c.agregar ? `<li data-v="${NUEVO}" data-t="➕ ${esc(c.agregar)}" data-fijo="1">➕ ${esc(c.agregar)}</li>` : '');
      return `<div class="buscar" data-bq="${esc(c.name)}"><input type="hidden" name="${esc(c.name)}" value="${esc(sel?.[0] ?? '')}">
        <input type="text" data-bq-in role="combobox" autocomplete="off" placeholder="🔍  Escribe para buscar…" value="${esc(sel && sel[0] !== '' ? sel[1] : '')}">
        <ul class="bq-lista" hidden>${li}<li class="bq-nada" hidden>Sin resultados</li></ul>
        ${c.agregar ? `<input name="${esc(c.name)}__nuevo" placeholder="Nombre" hidden>` : ''}</div>`;
    }
    case 'checkbox': return `<input type="checkbox" ${base} ${c.value ? 'checked' : ''}>`;
    case 'money': {
      const v = c.value === undefined || c.value === null || c.value === '' ? '' : formatearEntrada(String(c.value).replace('.', ','));
      return `<div class="dinero"><input ${base} data-fmt="money" inputmode="decimal" autocomplete="off" value="${esc(v)}" placeholder="${esc(c.placeholder ?? '0')}">
        <button type="button" class="calc-btn" tabindex="-1" title="Calculadora" aria-label="Abrir la calculadora">🧮</button><small class="calc-hint" hidden></small></div>`;
    }
    case 'lista-monto': {
      const marcados = new Map((c.value ?? []).map((x) => [Number(x.id), x.monto]));
      const filas = c.items.map((it) => {
        const on = marcados.has(it.id);
        const monto = on ? formatearEntrada(String(marcados.get(it.id)).replace('.', ',')) : '';
        return `<div class="lm-fila" data-id="${it.id}" data-q="${esc(it.label.toLowerCase())}">
          <label class="lm-chk"><input type="checkbox" data-lm-chk ${on ? 'checked' : ''}><span>${esc(it.label)}</span></label>
          <input data-fmt="money" data-lm-monto inputmode="decimal" autocomplete="off" data-sug="${esc(it.sugerido ?? '')}" ${on ? '' : 'disabled'}
            value="${esc(monto)}" placeholder="${esc(it.sugerido ? formatearEntrada(String(it.sugerido)) : '0')}"></div>`;
      }).join('');
      return `<div class="lista-monto" data-lm="${esc(c.name)}"><input type="search" data-lm-buscar placeholder="🔍  Buscar concepto…" autocomplete="off">
        <div class="lm-filas">${filas || '<p class="muted">No hay conceptos disponibles.</p>'}</div></div>`;
    }
    case 'textarea': return `<textarea ${base} rows="3" placeholder="${esc(c.placeholder ?? '')}">${esc(c.value ?? '')}</textarea>`;
    case 'decimal': return `<input ${base} inputmode="decimal" autocomplete="off" value="${esc(c.value ?? '')}" placeholder="${esc(c.placeholder ?? '')}">`;
    case 'number': return `<input type="number" ${base} value="${esc(c.value ?? '')}" min="${c.min ?? ''}" max="${c.max ?? ''}">`;
    case 'date': return `<input type="date" ${base} value="${esc(c.value ?? '')}">`;
    default: return `<input type="text" ${base} value="${esc(c.value ?? '')}" placeholder="${esc(c.placeholder ?? '')}">`;
  }
}

export async function alerta(msg) { await formulario({ titulo: 'Aviso', campos: [], textoOk: 'Entendido', extra: `<p>${esc(msg)}</p>` }); }
export async function confirmar(msg, textoOk = 'Aceptar') {
  return (await formulario({ titulo: 'Confirmar', campos: [], textoOk, extra: `<p>${esc(msg)}</p>` })) !== null;
}

/** Ejecuta una acción de escritura mostrando el error en lugar de romper la vista. */
export async function intentar(fn) {
  try { return await fn(); } catch (e) { await alerta(e.message || String(e)); return undefined; }
}
