import conceptos from './conceptos.js';
import inicio from './inicio.js';
import resumen from './resumen.js';
import mes from './mes.js';
import presupuesto from './presupuesto.js';
import tarjetas from './tarjetas.js';
import cuentas from './cuentas.js';
import cajas from './cajas.js';
import prestamos from './prestamos.js';

const pendiente = (titulo, fase, icono) => ({
  titulo, icono,
  render(el) {
    el.innerHTML = `<div class="card"><h2>${titulo}</h2><p class="muted">Se implementa en la fase ${fase}.</p></div>`;
  },
});

export const VIEWS = {
  inicio,
  resumen,
  mes,
  presupuesto,
  tarjetas,
  cuentas,
  cajas,
  prestamos,
  conceptos,
};
