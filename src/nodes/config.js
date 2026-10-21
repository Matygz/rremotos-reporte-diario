// ===================== EDITÁ ESTOS VALORES =====================
const CONFIG = {
  DEMO_MODE: true,          // true = datos ficticios, no llama a Mercado Libre
  ENVIAR_EMAIL: false,      // false = solo arma el reporte (útil para probar)
  SELLER_ID: '',            // tu user_id de Mercado Libre (número)
  EMAIL_DESTINO: 'destino@ejemplo.com',
  EMAIL_REMITENTE: 'tu-cuenta@gmail.com',
  UMBRAL_STOCK: 2,          // una variante está "baja" si tiene menos de este stock
  MIN_VARIANTES_BAJAS: 2,   // se pide recarga si una publicación tiene al menos estas variantes bajas
  ZONA_HORARIA: 'America/Argentina/Buenos_Aires',
};
// ===============================================================

// Rango "ayer" completo en hora argentina, en el formato que espera la API de órdenes.
const hoy = DateTime.now().setZone(CONFIG.ZONA_HORARIA).startOf('day');
const ayer = hoy.minus({ days: 1 });

return [{
  json: {
    ...CONFIG,
    DESDE: ayer.toISO(),
    HASTA: hoy.minus({ milliseconds: 1 }).toISO(),
    FECHA_REPORTE: ayer.toFormat('dd/LL/yyyy'),
  },
}];
