import { describe, it, expect } from 'vitest';
import { evaluateLock, LOCK_TTL_MS, segundosParaLiberar, haceSegundos } from '../src/lock.js';

const now = 1_000_000;
describe('evaluateLock', () => {
  it('sin bloqueo se puede editar', () => {
    expect(evaluateLock(null, 'a', now).canEdit).toBe(true);
  });
  it('bloqueo propio se puede editar', () => {
    expect(evaluateLock({ id: 'a', ts: now }, 'a', now).canEdit).toBe(true);
  });
  it('bloqueo vigente de otro equipo => solo lectura', () => {
    const r = evaluateLock({ id: 'b', ts: now - 1000, user: 'Ana' }, 'a', now);
    expect(r.canEdit).toBe(false);
    expect(r.holder.user).toBe('Ana');
  });
  it('bloqueo caducado de otro equipo se puede tomar', () => {
    expect(evaluateLock({ id: 'b', ts: now - LOCK_TTL_MS - 1 }, 'a', now).canEdit).toBe(true);
  });
  it('bloqueo corrupto se ignora', () => {
    expect(evaluateLock({ foo: 1 }, 'a', now).canEdit).toBe(true);
  });
});

describe('contador del bloqueo', () => {
  it('cuenta los segundos que faltan para que caduque', () => {
    expect(segundosParaLiberar({ ts: now }, now)).toBe(LOCK_TTL_MS / 1000);
    expect(segundosParaLiberar({ ts: now - 30_000 }, now)).toBe(60);
    expect(segundosParaLiberar({ ts: now - 30_001 }, now)).toBe(60);
  });
  it('no baja de cero cuando ya caducó ni falla con un bloqueo corrupto', () => {
    expect(segundosParaLiberar({ ts: now - LOCK_TTL_MS - 5000 }, now)).toBe(0);
    expect(segundosParaLiberar({ foo: 1 }, now)).toBe(0);
    expect(segundosParaLiberar(null, now)).toBe(0);
  });
  it('un reloj adelantado del otro equipo no da tiempos negativos', () => {
    expect(haceSegundos({ ts: now + 20_000 }, now)).toBe(0);
    expect(haceSegundos({ ts: now - 12_500 }, now)).toBe(12);
  });
});
