import './styles.css';
import * as storage from './storage.js';
import { isReadonly } from './db.js';
import { segundosParaLiberar, haceSegundos } from './lock.js';
import { VIEWS } from './views/index.js';
import { periodo, selectorPeriodo, enlazarPeriodo } from './periodo.js';
import { pendientesDePago } from './calc.js';
import * as repo from './repo.js';
import { editarMovimiento } from './views/mes.js';
import { buscarConcepto } from './views/conceptos.js';
import { abrirPaleta } from './paleta.js';

const app = document.getElementById('app');
let vistaActual = 'inicio';
// Menú lateral: grupos de vistas, en el orden en que se muestran.
const GRUPOS = [['', ['inicio', 'mes', 'presupuesto', 'resumen']], ['Dinero', ['cuentas', 'tarjetas', 'cajas', 'prestamos']], ['Ajustes', ['conceptos']]];
let colapsada = false;
try { colapsada = localStorage.getItem('finanzas.menu') === 'colapsado'; } catch { /* sin almacenamiento: se queda desplegado */ }
const ir = (k) => { vistaActual = k; render(); };
let conectado = false;

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

function pantallaNoSoportada() {
  app.replaceChildren(h(`<div class="card center"><h2>Navegador no compatible</h2>
    <p>Esta aplicación guarda los datos en una carpeta de OneDrive y necesita <b>Google Chrome</b> o <b>Microsoft Edge</b> de escritorio.</p></div>`));
}

async function pantallaConexion() {
  const recordado = await storage.handleRecordado();
  const nombre = storage.userName();
  const el = h(`<div class="card center">
    <h2>💰 Finanzas Familiares</h2>
    <p class="muted">Elige la carpeta de OneDrive donde se guardará <code>finanzas.sqlite</code>. Si ya existe, se abre; si no, se crea.</p>
    <p><input id="usuario" placeholder="Tu nombre (para el aviso de edición)" value="${nombre.replace(/"/g, '&quot;')}"></p>
    <p>
      ${recordado ? `<button class="primary" id="reabrir">Continuar con «${recordado.name}»</button> ` : ''}
      <button class="${recordado ? 'secondary' : 'primary'}" id="elegir">Elegir carpeta…</button>
    </p>
    <p id="msg" class="muted"></p></div>`);
  const conectar = (fn) => async () => {
    const u = el.querySelector('#usuario').value.trim();
    if (!u) { el.querySelector('#msg').textContent = 'Escribe tu nombre primero.'; return; }
    storage.setUserName(u);
    try { await fn(); conectado = true; render(); }
    catch (e) { if (e.name !== 'AbortError') el.querySelector('#msg').textContent = e.message; }
  };
  el.querySelector('#elegir').onclick = conectar(() => storage.elegirCarpeta());
  if (recordado) el.querySelector('#reabrir').onclick = conectar(() => storage.reconectar(recordado));
  app.replaceChildren(el);
}

let relojBloqueo = null;
/** Pinta «última señal hace X s · se liberará en ~N s» y lo actualiza cada segundo sin re-renderizar la vista. */
function iniciarContador(nodo, holder) {
  clearInterval(relojBloqueo);
  if (!nodo || !holder) return;
  const pintar = () => {
    const falta = segundosParaLiberar(holder);
    nodo.textContent = falta > 0
      ? `Última señal hace ${haceSegundos(holder)} s. Si deja de dar señal, se liberará en ~${falta} s (se revisa solo cada 10 s).`
      : 'Su bloqueo caducó; comprobando…';
  };
  pintar();
  relojBloqueo = setInterval(pintar, 1000);
}

/** Paleta global: vistas, acciones y conceptos. */
function paleta() {
  if (!conectado) return;
  abrirPaleta([
    ...Object.entries(VIEWS).map(([k, v]) => ({ texto: v.titulo, detalle: 'Ir a la vista', icono: v.icono, siempre: true, fn: () => ir(k) })),
    { texto: 'Agregar movimiento', detalle: 'Acción', icono: '➕', siempre: true, fn: () => editarMovimiento({}, render) },
    ...repo.conceptos().filter((c) => c.activo).map((c) => ({ texto: c.nombre, detalle: c.grupo ?? 'Concepto', icono: '🏷️', fn: () => { buscarConcepto(c.nombre); ir('conceptos'); } })),
  ]);
}
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paleta(); }
});

function render() {
  if (!conectado) return;
  const st = storage.state;
  document.body.classList.toggle('readonly', isReadonly());
  const banner = st.readonly
    ? `<div class="banner">🔒 Solo lectura: «${st.holder?.user ?? 'otro equipo'}» está editando${st.holder ? ' desde las ' + new Date(st.holder.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''}. Puedes consultar, no modificar.
        <span id="cuenta-bloqueo" class="muted"></span> <button id="reintentar">Reintentar</button></div>`
    : st.externalChange
      ? `<div class="banner">⚠️ El archivo cambió en OneDrive desde otro equipo. Guarda y recarga la página para no perder cambios.</div>` : '';
  const estado = st.error ? `<div class="pie"><span class="estado err">⚠ ${st.error}</span></div>`
    : `<div class="pie"><span class="estado">${st.readonly ? 'Solo lectura' : st.saved ? '✓ Guardado' : 'Guardando…'} · ${st.folder}</span></div>`;
  const v = VIEWS[vistaActual];
  let urgentes = 0;
  try { urgentes = pendientesDePago(repo.gastosMes(periodo.anio, periodo.mes), periodo.anio, periodo.mes).filter((p) => p.estado !== 'pendiente').length; } catch { /* la insignia es opcional */ }
  const shell = h(`<div class="app ${colapsada ? 'colapsada' : ''}">
    <aside class="side">
      <div class="marca"><span class="logo">💰</span><b>Finanzas</b><button class="icon" id="plegar" title="Plegar o desplegar el menú" aria-label="Plegar menú">«</button></div>
      <nav>${GRUPOS.map(([g, claves]) => `${g ? `<h4>${g}</h4>` : ''}${claves.map((k) => `<button data-v="${k}" class="${k === vistaActual ? 'on' : ''}" title="${VIEWS[k].titulo}">
        <span class="ic">${VIEWS[k].icono ?? ''}</span><span class="tx">${VIEWS[k].titulo}</span>${k === 'mes' && urgentes ? `<span class="insignia">${urgentes}</span>` : ''}</button>`).join('')}`).join('')}</nav>
      ${estado}
    </aside>
    <div class="cuerpo">
      <header class="topbar"><h1>${v.titulo}</h1>${v.periodo ? selectorPeriodo() : ''}<span class="sp"></span>
        <button class="busca" id="buscar-global" title="Buscar (Ctrl K)">🔍 <span>Buscar</span> <kbd>Ctrl K</kbd></button>
        <button class="primary" id="agregar" data-edit>+ Agregar</button></header>${banner}<main></main>
    </div></div>`);
  shell.querySelectorAll('nav button').forEach((b) => (b.onclick = () => ir(b.dataset.v)));
  shell.querySelector('#plegar').onclick = () => {
    colapsada = !colapsada;
    shell.classList.toggle('colapsada', colapsada);
    try { localStorage.setItem('finanzas.menu', colapsada ? 'colapsado' : 'desplegado'); } catch { /* preferencia opcional */ }
  };
  if (v.periodo) enlazarPeriodo(shell.querySelector('.topbar'), render);
  shell.querySelector('#buscar-global').onclick = paleta;
  shell.querySelector('#agregar').onclick = () => editarMovimiento({}, render);
  shell.querySelector('#reintentar')?.addEventListener('click', async () => { await storage.reintentar(); render(); });
  iniciarContador(shell.querySelector('#cuenta-bloqueo'), st.holder);
  const main = shell.querySelector('main');
  try {
    v.render(main, { rerender: render, ir });
  } catch (e) {
    console.error(e);
    const caja = h('<div class="card"><h2>No se pudo mostrar esta vista</h2><p class="err"></p></div>');
    caja.querySelector('.err').textContent = e.message || String(e);
    main.replaceChildren(caja);
  }
  app.replaceChildren(shell);
}

// Evita re-render completo mientras se escribe en un campo: solo refresca la barra de estado.
let ultimoReadonly = true;
storage.subscribe((st) => {
  if (!conectado) return;
  const foco = document.activeElement;
  const escribiendo = foco && ['INPUT', 'SELECT', 'TEXTAREA'].includes(foco.tagName);
  if (st.readonly !== ultimoReadonly || st.tick || !escribiendo) { ultimoReadonly = st.readonly; render(); }
  else {
    const e = document.querySelector('.estado');
    if (e) e.textContent = `${st.saved ? '✓ Guardado' : 'Guardando…'} · ${st.folder}`;
  }
});

window.addEventListener('beforeunload', (e) => { if (!storage.state.saved) { e.preventDefault(); e.returnValue = ''; } });

storage.soportado() ? pantallaConexion() : pantallaNoSoportada();
