import './styles.css';
import * as storage from './storage.js';
import { isReadonly } from './db.js';
import { VIEWS } from './views/index.js';

const app = document.getElementById('app');
let vistaActual = 'resumen';
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

function render() {
  if (!conectado) return;
  const st = storage.state;
  document.body.classList.toggle('readonly', isReadonly());
  const banner = st.readonly
    ? `<div class="banner">🔒 Solo lectura: «${st.holder?.user ?? 'otro equipo'}» está editando${st.holder ? ' desde las ' + new Date(st.holder.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''}. Puedes consultar, no modificar. <button id="reintentar">Reintentar</button></div>`
    : st.externalChange
      ? `<div class="banner">⚠️ El archivo cambió en OneDrive desde otro equipo. Guarda y recarga la página para no perder cambios.</div>` : '';
  const estado = st.error ? `<span class="estado err">⚠ ${st.error}</span>`
    : `<span class="estado">${st.readonly ? 'Solo lectura' : st.saved ? '✓ Guardado' : 'Guardando…'} · ${st.folder}</span>`;
  const shell = h(`<div>
    <header class="top"><h1>💰 Finanzas</h1>
      <nav>${Object.entries(VIEWS).map(([k, v]) => `<button data-v="${k}" class="${k === vistaActual ? 'on' : ''}">${v.titulo}</button>`).join('')}</nav>
      ${estado}</header>${banner}<main></main></div>`);
  shell.querySelectorAll('nav button').forEach((b) => (b.onclick = () => { vistaActual = b.dataset.v; render(); }));
  shell.querySelector('#reintentar')?.addEventListener('click', async () => { await storage.reintentar(); render(); });
  VIEWS[vistaActual].render(shell.querySelector('main'), { rerender: render });
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
