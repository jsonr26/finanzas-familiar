// Mes y año que consultan las vistas con período (el selector vive en el encabezado de la app).
import { MESES } from './calc.js';

const hoy = new Date();
export const periodo = { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };

export const selectorPeriodo = () =>
  `<div class="periodo"><button class="icon" id="mes-ant" title="Mes anterior" aria-label="Mes anterior">‹</button>
   <select id="mes" aria-label="Mes">${MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === periodo.mes ? 'selected' : ''}>${m}</option>`).join('')}</select>
   <input id="anio" type="number" value="${periodo.anio}" aria-label="Año">
   <button class="icon" id="mes-sig" title="Mes siguiente" aria-label="Mes siguiente">›</button></div>`;

export function enlazarPeriodo(node, rerender) {
  const cambiar = () => {
    const a = Number(node.querySelector('#anio').value);
    if (a >= 2000 && a <= 2100) { periodo.anio = a; periodo.mes = Number(node.querySelector('#mes').value); rerender(); }
  };
  const mover = (d) => {
    const m = periodo.mes - 1 + d;
    periodo.anio += Math.floor(m / 12); periodo.mes = ((m % 12) + 12) % 12 + 1;
    rerender();
  };
  node.querySelector('#mes').onchange = cambiar;
  node.querySelector('#anio').onchange = cambiar;
  node.querySelector('#mes-ant').onclick = () => mover(-1);
  node.querySelector('#mes-sig').onclick = () => mover(1);
}
