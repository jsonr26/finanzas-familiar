// Tema de color: «sistema» (sigue al sistema operativo), «claro» u «oscuro». Se recuerda en el navegador.
const CLAVE = 'finanzas.tema';
export const TEMAS = { sistema: ['💻', 'Sistema'], claro: ['☀️', 'Claro'], oscuro: ['🌙', 'Oscuro'] };

export function temaActual() {
  try { const t = localStorage.getItem(CLAVE); return t in TEMAS ? t : 'sistema'; } catch { return 'sistema'; }
}

/** Pone el atributo `data-tema` en <html> (sin atributo = sigue al sistema) y lo guarda. */
export function aplicarTema(t) {
  if (t === 'sistema') delete document.documentElement.dataset.tema; else document.documentElement.dataset.tema = t;
  try { if (t === 'sistema') localStorage.removeItem(CLAVE); else localStorage.setItem(CLAVE, t); } catch { /* preferencia opcional */ }
}

/** Pasa al siguiente tema (sistema → claro → oscuro → sistema) y lo devuelve. */
export function siguienteTema() {
  const orden = Object.keys(TEMAS);
  const n = orden[(orden.indexOf(temaActual()) + 1) % orden.length];
  aplicarTema(n);
  return n;
}
