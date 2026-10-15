const pendiente = (titulo, fase) => ({
  titulo,
  render(el) {
    el.innerHTML = `<div class="card"><h2>${titulo}</h2><p class="muted">Se implementa en la fase ${fase}.</p></div>`;
  },
});

export const VIEWS = {
  resumen: pendiente('Resumen anual', 6),
  mes: pendiente('Mes', 2),
  presupuesto: pendiente('Presupuesto', 3),
  cajas: pendiente('Cajas de ahorro', 4),
  prestamos: pendiente('Autopréstamos', 5),
  conceptos: pendiente('Conceptos', 2),
};
