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
  // v2: ajustes tras revisar el Excel actual (conceptos con grupo/día/quincena, libro de movimientos)
  `
  ALTER TABLE conceptos ADD COLUMN grupo TEXT;                 -- Hogar, Deudas, ...
  ALTER TABLE conceptos ADD COLUMN categoria TEXT NOT NULL DEFAULT 'Gasto' CHECK (categoria IN ('Gasto','Ahorro'));
  ALTER TABLE conceptos ADD COLUMN dia_pago INTEGER;           -- día del mes en que vence
  ALTER TABLE conceptos ADD COLUMN quincena INTEGER CHECK (quincena IN (1,2));
  ALTER TABLE conceptos ADD COLUMN presupuestado INTEGER NOT NULL DEFAULT 1;

  ALTER TABLE ingresos ADD COLUMN quincena INTEGER NOT NULL DEFAULT 1 CHECK (quincena IN (1,2));

  DROP TABLE pagos;   -- reemplazada por el libro de movimientos

  -- Libro de movimientos: lo ejecutado. 'persona_id' = quién pagó (tercero).
  CREATE TABLE movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,                       -- AAAA-MM-DD
    concepto_id INTEGER NOT NULL REFERENCES conceptos(id),
    persona_id INTEGER REFERENCES personas(id),
    monto REAL NOT NULL,
    nota TEXT
  );
  CREATE INDEX ix_mov_fecha ON movimientos(fecha);
  CREATE INDEX ix_mov_concepto ON movimientos(concepto_id);

  CREATE TABLE saldos_mes (
    anio INTEGER NOT NULL, mes INTEGER NOT NULL,
    saldo_anterior REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (anio, mes)
  );
  `,
  // v3: fecha de pago + periodicidad en conceptos; catálogo de grupos
  `
  ALTER TABLE conceptos ADD COLUMN fecha_pago TEXT;            -- AAAA-MM-DD de referencia (mensual: el día; anual: día y mes)
  ALTER TABLE conceptos ADD COLUMN periodicidad TEXT NOT NULL DEFAULT 'mensual' CHECK (periodicidad IN ('mensual','anual','manual'));

  CREATE TABLE grupos (nombre TEXT PRIMARY KEY);
  INSERT INTO grupos (nombre) SELECT DISTINCT grupo FROM conceptos WHERE grupo IS NOT NULL AND grupo <> '';
  `,
  // v4: responsable del pago (Personas) en lugar de quincena; grupos base
  `
  ALTER TABLE conceptos DROP COLUMN quincena;
  ALTER TABLE conceptos ADD COLUMN responsable_id INTEGER REFERENCES personas(id);
  INSERT OR IGNORE INTO grupos (nombre) VALUES ('Hogar'), ('Deudas');
  `,
  // v5: monto base por concepto para el presupuesto (los ajustes de un mes van en la tabla presupuesto)
  `
  ALTER TABLE conceptos ADD COLUMN monto_estimado REAL NOT NULL DEFAULT 0;
  `,
  // v6: cuentas bancarias, tarjetas de crédito con compras a cuotas (el pago crea un movimiento)
  `
  CREATE TABLE cuentas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    persona_id INTEGER REFERENCES personas(id),
    saldo_inicial REAL NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1
  );
  -- Saldo real del banco anotado al cierre de un mes, para conciliar contra el calculado
  CREATE TABLE cuentas_saldos (
    cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
    anio INTEGER NOT NULL, mes INTEGER NOT NULL,
    saldo REAL NOT NULL,
    PRIMARY KEY (cuenta_id, anio, mes)
  );
  ALTER TABLE ingresos ADD COLUMN cuenta_id INTEGER REFERENCES cuentas(id);
  ALTER TABLE movimientos ADD COLUMN cuenta_id INTEGER REFERENCES cuentas(id);

  -- Cada tarjeta tiene un concepto de gasto («Tarjeta X») que recibe los pagos
  CREATE TABLE tarjetas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    concepto_id INTEGER NOT NULL REFERENCES conceptos(id),
    cuenta_id INTEGER REFERENCES cuentas(id),
    activo INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE compras_tarjeta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tarjeta_id INTEGER NOT NULL REFERENCES tarjetas(id),
    fecha TEXT NOT NULL, descripcion TEXT NOT NULL,
    monto REAL NOT NULL, num_cuotas INTEGER NOT NULL DEFAULT 1,
    tasa_mensual REAL NOT NULL DEFAULT 0          -- fracción: 0.019 = 1,9 % mensual
  );
  -- movimiento_id NULL = cuota pendiente; al borrar el movimiento del pago la cuota vuelve a quedar pendiente
  CREATE TABLE cuotas_tarjeta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id INTEGER NOT NULL REFERENCES compras_tarjeta(id) ON DELETE CASCADE,
    numero INTEGER NOT NULL,
    anio INTEGER NOT NULL, mes INTEGER NOT NULL,
    capital REAL NOT NULL, interes REAL NOT NULL, valor REAL NOT NULL,
    movimiento_id INTEGER REFERENCES movimientos(id) ON DELETE SET NULL
  );
  CREATE INDEX ix_cuotas_tarjeta_compra ON cuotas_tarjeta(compra_id);
  CREATE INDEX ix_cuotas_tarjeta_periodo ON cuotas_tarjeta(anio, mes);
  `,
  // v7: autopréstamos financiados por cajas de ahorro; sus cuotas se pagan con un movimiento (como las tarjetas)
  `
  ALTER TABLE autoprestamos ADD COLUMN concepto_id INTEGER REFERENCES conceptos(id);   -- «Autopréstamo X», recibe los pagos
  ALTER TABLE autoprestamos ADD COLUMN cuenta_id INTEGER REFERENCES cuentas(id);       -- cuenta sugerida para pagar
  -- Cuánto prestó cada caja; la devolución de cada cuota se reparte en proporción a estos montos
  CREATE TABLE autoprestamos_origen (
    prestamo_id INTEGER NOT NULL REFERENCES autoprestamos(id) ON DELETE CASCADE,
    caja_id INTEGER NOT NULL REFERENCES cajas_ahorro(id),
    monto REAL NOT NULL,
    PRIMARY KEY (prestamo_id, caja_id)
  );
  -- Cuota pendiente = movimiento_id NULL (las columnas pagada/fecha_pago de la v1 no se usan)
  ALTER TABLE cuotas ADD COLUMN movimiento_id INTEGER REFERENCES movimientos(id) ON DELETE SET NULL;
  -- Movimientos de caja generados por un préstamo (retiro al desembolsar) o por el pago de una cuota (aporte)
  ALTER TABLE cajas_movs ADD COLUMN autoprestamo_id INTEGER REFERENCES autoprestamos(id);
  ALTER TABLE cajas_movs ADD COLUMN cuota_id INTEGER REFERENCES cuotas(id);
  `,
  // v8: conceptos que se pagan cada N meses (2 = bimestral…); el mes de fecha_pago es uno de los meses de pago
  `
  ALTER TABLE conceptos ADD COLUMN cada_meses INTEGER NOT NULL DEFAULT 1 CHECK (cada_meses BETWEEN 1 AND 12);
  `,
  // v9: un concepto puede abonar sus pagos a una caja de ahorro; el aporte queda ligado al movimiento que lo originó
  `
  ALTER TABLE conceptos ADD COLUMN caja_id INTEGER REFERENCES cajas_ahorro(id);
  ALTER TABLE cajas_movs ADD COLUMN movimiento_id INTEGER REFERENCES movimientos(id);
  CREATE INDEX ix_cajas_movs_mov ON cajas_movs(movimiento_id);
  `,
  // v10: notas de detalle en los conceptos (la baja por fecha reutiliza fecha_baja)
  `
  ALTER TABLE conceptos ADD COLUMN notas TEXT;
  `,
  // v11: conceptos quincenales (pagos los días 15 y último de cada mes); monto_estimado es lo de cada pago
  `
  ALTER TABLE conceptos ADD COLUMN quincenal INTEGER NOT NULL DEFAULT 0 CHECK (quincenal IN (0, 1));
  `,
  // v12: una compra con tarjeta puede «cubrir» un concepto (lo que ya estaba por pagar), para no contarlo dos veces
  `
  ALTER TABLE compras_tarjeta ADD COLUMN concepto_id INTEGER REFERENCES conceptos(id);
  `,
  // v13: una compra con tarjeta puede cubrir VARIOS conceptos, cada uno con el monto de la compra que le corresponde.
  // (compras_tarjeta.concepto_id de la v12 queda sin uso: SQLite no deja borrar una columna con clave foránea)
  `
  CREATE TABLE compras_cubre (
    compra_id INTEGER NOT NULL REFERENCES compras_tarjeta(id) ON DELETE CASCADE,
    concepto_id INTEGER NOT NULL REFERENCES conceptos(id),
    monto REAL NOT NULL CHECK (monto > 0),
    PRIMARY KEY (compra_id, concepto_id)
  );
  INSERT INTO compras_cubre (compra_id, concepto_id, monto) SELECT id, concepto_id, monto FROM compras_tarjeta WHERE concepto_id IS NOT NULL;
  `,
];
