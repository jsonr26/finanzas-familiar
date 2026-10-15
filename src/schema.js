// Migraciones: cada elemento sube PRAGMA user_version en 1.
export const MIGRATIONS = [
  `
  CREATE TABLE config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);

  -- Catálogo: se da de baja con activo=0 (no se borra, para conservar historial)
  CREATE TABLE conceptos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','descuento','gasto_fijo','gasto_variable')),
    nombre TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    fecha_baja TEXT,
    UNIQUE (tipo, nombre)
  );

  CREATE TABLE personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    activo INTEGER NOT NULL DEFAULT 1
  );

  -- Línea de ingreso o descuento de una persona en un mes. Los descuentos se guardan positivos.
  CREATE TABLE ingresos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anio INTEGER NOT NULL, mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    persona_id INTEGER REFERENCES personas(id),
    concepto_id INTEGER NOT NULL REFERENCES conceptos(id),
    clase TEXT NOT NULL CHECK (clase IN ('sueldo','prima','otro','descuento')),
    monto REAL NOT NULL,
    nota TEXT
  );
  CREATE INDEX ix_ingresos_periodo ON ingresos(anio, mes);

  CREATE TABLE presupuesto (
    anio INTEGER NOT NULL, mes INTEGER NOT NULL,
    concepto_id INTEGER NOT NULL REFERENCES conceptos(id),
    monto REAL NOT NULL,
    PRIMARY KEY (anio, mes, concepto_id)
  );

  CREATE TABLE pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anio INTEGER NOT NULL, mes INTEGER NOT NULL,
    concepto_id INTEGER NOT NULL REFERENCES conceptos(id),
    monto REAL NOT NULL,
    fecha_vencimiento TEXT,
    pagado INTEGER NOT NULL DEFAULT 0,
    fecha_pago TEXT,
    nota TEXT
  );
  CREATE INDEX ix_pagos_periodo ON pagos(anio, mes);

  CREATE TABLE cajas_ahorro (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL, banco TEXT,
    activo INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE cajas_tasas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caja_id INTEGER NOT NULL REFERENCES cajas_ahorro(id),
    desde TEXT NOT NULL, tasa_ea REAL NOT NULL, verificada TEXT
  );
  CREATE TABLE cajas_movs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caja_id INTEGER NOT NULL REFERENCES cajas_ahorro(id),
    fecha TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('aporte','retiro','rendimiento')),
    monto REAL NOT NULL, nota TEXT
  );

  CREATE TABLE autoprestamos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL, monto REAL NOT NULL,
    tasa_mensual REAL NOT NULL, plazo INTEGER NOT NULL,
    fecha_inicio TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','pagado','cancelado'))
  );
  CREATE TABLE cuotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prestamo_id INTEGER NOT NULL REFERENCES autoprestamos(id) ON DELETE CASCADE,
    numero INTEGER NOT NULL, vencimiento TEXT NOT NULL,
    capital REAL NOT NULL, interes REAL NOT NULL, valor REAL NOT NULL,
    pagada INTEGER NOT NULL DEFAULT 0, fecha_pago TEXT
  );
  CREATE INDEX ix_cuotas_prestamo ON cuotas(prestamo_id);
  `,
];
