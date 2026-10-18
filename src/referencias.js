// Valores de referencia externos. Cambian con el tiempo: son solo un punto de partida editable en los formularios.

/**
 * Tasa de interés de la tarjeta de crédito de Nu Colombia para compras a cuotas: 28,59 % efectivo anual
 * (simulación del documento oficial «Tarifas y costos Tarjeta de crédito Nu», octubre de 2026).
 * Depende del cupo y del plazo de cada cliente: confírmala en tu extracto o en la app de Nu.
 */
export const NU_TARJETA = {
  ea: 0.2859,
  fuente: 'Tarifas y costos Tarjeta de crédito Nu, octubre de 2026',
  url: 'https://cdn.nubank.com.br/colombia/tarjeta_credito_tarifas_y_costos.pdf',
};
