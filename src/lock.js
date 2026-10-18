export const LOCK_TTL_MS = 90_000;   // un bloqueo sin latido por 90 s se considera caducado
export const HEARTBEAT_MS = 30_000;

/**
 * Decide si esta sesión puede editar.
 * @param lock contenido de finanzas.lock (o null)
 * @returns {{canEdit:boolean, holder:object|null}}
 */
export function evaluateLock(lock, myId, now = Date.now()) {
  if (!lock || typeof lock.ts !== 'number') return { canEdit: true, holder: null };
  if (lock.id === myId) return { canEdit: true, holder: null };
  if (now - lock.ts > LOCK_TTL_MS) return { canEdit: true, holder: null };
  return { canEdit: false, holder: lock };
}

/** Segundos que faltan para que el bloqueo caduque SI su dueño deja de dar señal (0 = ya caducó). */
export function segundosParaLiberar(lock, now = Date.now()) {
  if (!lock || typeof lock.ts !== 'number') return 0;
  return Math.max(0, Math.ceil((lock.ts + LOCK_TTL_MS - now) / 1000));
}

/** Segundos desde el último latido del dueño (nunca negativo: los relojes de dos equipos pueden diferir). */
export function haceSegundos(lock, now = Date.now()) {
  if (!lock || typeof lock.ts !== 'number') return 0;
  return Math.max(0, Math.floor((now - lock.ts) / 1000));
}
