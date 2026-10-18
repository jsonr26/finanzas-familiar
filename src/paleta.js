// Paleta de búsqueda global (Ctrl/Cmd + K): saltar a una vista, un concepto o lanzar una acción escribiendo.
import { coincide } from './calc.js';
import { esc, el } from './ui.js';

let abierta = false;

/** items: [{ texto, detalle, icono, fn }]; `fn` corre al elegir. Con la consulta vacía solo se ofrecen los de `siempre`. */
export function abrirPaleta(items) {
  if (abierta) return;
  abierta = true;
  const dlg = el(`<dialog class="modal paleta"><input type="search" placeholder="Buscar una vista, un concepto o una acción…" autocomplete="off" aria-label="Buscar">
    <ul class="pal-lista"></ul><p class="muted pal-ayuda">↑ ↓ para moverse · Enter para elegir · Esc para cerrar</p></dialog>`);
  document.body.appendChild(dlg);
  const input = dlg.querySelector('input'), lista = dlg.querySelector('ul');
  let visibles = [], sel = 0;
  const pintar = () => {
    const q = input.value.trim();
    visibles = items.filter((i) => (q ? coincide(`${i.texto} ${i.detalle ?? ''}`, q) : i.siempre)).slice(0, 12);
    sel = Math.min(sel, Math.max(0, visibles.length - 1));
    lista.innerHTML = visibles.length
      ? visibles.map((i, k) => `<li data-k="${k}" class="${k === sel ? 'on' : ''}"><span class="ic">${i.icono ?? ''}</span><span>${esc(i.texto)}</span>${i.detalle ? `<small class="muted">${esc(i.detalle)}</small>` : ''}</li>`).join('')
      : '<li class="vacio-pal">Sin resultados</li>';
    lista.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const cerrar = () => { dlg.close(); dlg.remove(); abierta = false; };
  const elegir = (k) => { const i = visibles[k]; if (!i) return; cerrar(); i.fn(); };
  input.addEventListener('input', () => { sel = 0; pintar(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(visibles.length - 1, sel + 1); pintar(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); pintar(); }
    else if (e.key === 'Enter') { e.preventDefault(); elegir(sel); }
  });
  lista.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-k]'); if (li) { e.preventDefault(); elegir(Number(li.dataset.k)); } });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) cerrar(); });
  pintar();
  dlg.showModal();
  input.focus();
}
