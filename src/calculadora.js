// Calculadora básica (+ − × ÷, %, paréntesis). Se usa suelta (menú lateral / Ctrl K) o desde un campo de dinero.
import { evaluarExpresion, esExpresion, parseMonto, formatoDinero } from './calc.js';

const CLAVE = 'finanzas.calc';
const TECLAS = [['C', 'C'], ['DEL', '⌫'], ['%', '%'], ['÷', '÷'], ['7'], ['8'], ['9'], ['×', '×'], ['4'], ['5'], ['6'], ['−', '−'],
  ['1'], ['2'], ['3'], ['+'], ['(', '('], ['0'], [',', ','], [')', ')']];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let historial = [];
try { historial = JSON.parse(localStorage.getItem(CLAVE) ?? '[]').slice(0, 8); } catch { historial = []; }
const guardarHistorial = () => { try { localStorage.setItem(CLAVE, JSON.stringify(historial)); } catch { /* opcional */ } };

/** Valor numérico del texto: operación o número suelto. Lanza Error si no es válido. */
const valorDe = (txt) => {
  if (esExpresion(txt)) return evaluarExpresion(txt);
  const n = parseMonto(txt);
  if (!Number.isFinite(n)) throw new Error(String(txt ?? '').trim() ? 'Revisa la operación.' : 'Escribe una operación.');
  return Math.round(n * 100) / 100;
};

let abierta = false;

/**
 * `inicial`: texto con el que arranca la pantalla. `alUsar(textoFormateado)`: si se da, aparece «Usar resultado»
 * y escribe el valor en el campo desde el que se abrió.
 */
export function abrirCalculadora({ inicial = '', alUsar = null } = {}) {
  if (abierta) return;
  abierta = true;
  const t = document.createElement('template');
  t.innerHTML = `<dialog class="modal calc"><form method="dialog">
    <h3>🧮 Calculadora</h3>
    <input class="calc-pantalla" type="text" inputmode="decimal" autocomplete="off" aria-label="Operación" placeholder="0">
    <p class="calc-res muted" aria-live="polite">&nbsp;</p>
    <div class="calc-teclas">${TECLAS.map(([k, txt]) => `<button type="button" class="calc-t ${/\d|,/.test(k) ? '' : 'op'}" data-k="${esc(k)}">${esc(txt ?? k)}</button>`).join('')}
      <button type="button" class="calc-t igual" data-k="=">=</button></div>
    <div class="calc-hist"></div>
    <div class="acciones"><button type="button" class="secondary" data-a="cerrar">Cerrar</button>
      <button type="button" class="secondary" data-a="copiar">Copiar</button>
      ${alUsar ? '<button type="button" class="primary" data-a="usar">Usar resultado</button>' : ''}</div>
  </form></dialog>`;
  const dlg = t.content.firstElementChild;
  document.body.appendChild(dlg);
  const pantalla = dlg.querySelector('.calc-pantalla'), res = dlg.querySelector('.calc-res'), hist = dlg.querySelector('.calc-hist');
  pantalla.value = inicial;

  const actual = () => { try { return { ok: true, v: valorDe(pantalla.value) }; } catch (e) { return { ok: false, msg: e.message }; } };
  const pintarHistorial = () => {
    hist.innerHTML = historial.length ? `<small class="muted">Recientes</small>${historial.map((h, i) => `<button type="button" class="calc-h" data-h="${i}"><span class="muted">${esc(h.expr)} =</span> <b>${esc(h.res)}</b></button>`).join('')}` : '';
  };
  const pintar = () => {
    const r = actual();
    if (!pantalla.value.trim()) res.innerHTML = '&nbsp;';
    else if (r.ok) res.textContent = esExpresion(pantalla.value) ? `= $ ${formatoDinero(r.v)}` : ' ';
    else res.textContent = /[+\-*/×÷−(%]$/.test(pantalla.value.trim()) ? '…' : r.msg;
    res.classList.toggle('err', !r.ok && !/[+\-*/×÷−(%]$/.test(pantalla.value.trim()) && !!pantalla.value.trim());
  };
  const igual = () => {
    const r = actual();
    if (!r.ok) { res.textContent = r.msg; res.classList.add('err'); return false; }
    if (esExpresion(pantalla.value)) {
      const registro = { expr: pantalla.value.trim(), res: formatoDinero(r.v) };
      if (historial[0]?.expr !== registro.expr) historial = [registro, ...historial].slice(0, 8);
      guardarHistorial(); pintarHistorial();
    }
    pantalla.value = formatoDinero(r.v);
    pintar();
    return true;
  };
  const cerrar = () => { dlg.close(); dlg.remove(); abierta = false; };
  const insertar = (txt) => { pantalla.value += txt; pantalla.focus(); pintar(); };

  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg) return cerrar();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.k !== undefined) {
      const k = b.dataset.k;
      if (k === 'C') { pantalla.value = ''; pantalla.focus(); pintar(); }
      else if (k === 'DEL') { pantalla.value = pantalla.value.slice(0, -1); pantalla.focus(); pintar(); }
      else if (k === '=') igual();
      else insertar(k);
    } else if (b.dataset.h !== undefined) {
      pantalla.value = historial[Number(b.dataset.h)].res; pantalla.focus(); pintar();
    } else if (b.dataset.a === 'cerrar') cerrar();
    else if (b.dataset.a === 'copiar') {
      const r = actual();
      if (!r.ok) { res.textContent = r.msg; res.classList.add('err'); return; }
      const texto = formatoDinero(r.v);
      try { await navigator.clipboard.writeText(texto); b.textContent = 'Copiado ✓'; } catch { b.textContent = 'No se pudo copiar'; }
      setTimeout(() => { b.textContent = 'Copiar'; }, 1400);
    } else if (b.dataset.a === 'usar') {
      if (!igual()) return;
      const texto = pantalla.value;
      cerrar();
      alUsar(texto);
    }
  });
  pantalla.addEventListener('input', pintar);
  pantalla.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); igual(); }
    else if (e.key === '*') { e.preventDefault(); insertar('×'); }
    else if (e.key === '/') { e.preventDefault(); insertar('÷'); }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  pintarHistorial();
  pintar();
  dlg.showModal();
  pantalla.focus();
  pantalla.setSelectionRange(pantalla.value.length, pantalla.value.length);
}
