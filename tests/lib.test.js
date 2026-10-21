const test = require('node:test');
const assert = require('node:assert/strict');
const { analizarStock, analizarVentas, analizar, armarEmail, datosDemo, nombreVariante } = require('../src/lib.js');

const config = { UMBRAL_STOCK: 2, MIN_VARIANTES_BAJAS: 2, FECHA_REPORTE: '20/10/2026', DEMO_MODE: true };

function pub(id, stocks, extra = {}) {
  return {
    id,
    title: `Pub ${id}`,
    status: 'active',
    variations: stocks.map((stock, i) => ({
      id: i,
      available_quantity: stock,
      attribute_combinations: [{ id: 'SIZE', name: 'Talle', value_name: String(36 + i) }],
    })),
    ...extra,
  };
}

test('todas en 2: no hay alerta', () => {
  const r = analizarStock([pub('A', [2, 2, 2, 2])], config);
  assert.equal(r.alertas.length, 0);
});

test('una sola variante baja no alcanza para alertar', () => {
  const r = analizarStock([pub('A', [2, 1, 2, 2])], config);
  assert.equal(r.alertas.length, 0);
});

test('dos o más variantes con 0 o 1 disparan la alerta', () => {
  const r = analizarStock([pub('A', [2, 1, 0, 2])], config);
  assert.equal(r.alertas.length, 1);
  assert.deepEqual(r.alertas[0].bajas.map((v) => [v.nombre, v.stock]), [['37', 1], ['38', 0]]);
  assert.equal(r.alertas[0].sinStock, 1);
});

test('los umbrales son configurables', () => {
  const r = analizarStock([pub('A', [3, 2, 2, 3])], { UMBRAL_STOCK: 3, MIN_VARIANTES_BAJAS: 2 });
  assert.equal(r.alertas.length, 1);
});

test('las más urgentes van primero (más talles en 0)', () => {
  const r = analizarStock([pub('A', [1, 1, 2]), pub('B', [0, 0, 1])], config);
  assert.deepEqual(r.alertas.map((a) => a.id), ['B', 'A']);
});

test('variante única en 0 va a "sin stock", no a alertas', () => {
  const r = analizarStock([{ id: 'X', title: 'Única', available_quantity: 0, variations: [] }], config);
  assert.equal(r.alertas.length, 0);
  assert.equal(r.sinStock.length, 1);
});

test('nombre de variante sin talle usa la combinación', () => {
  assert.equal(nombreVariante({ id: 9, attribute_combinations: [{ name: 'Color', value_name: 'Rojo' }] }), 'Rojo');
});

test('ventas: solo cuenta órdenes pagadas y agrupa por variante', () => {
  const linea = (id, vid, q, p) => ({ item: { id, title: id, variation_id: vid, variation_attributes: [{ value_name: 'T' + vid }] }, quantity: q, unit_price: p });
  const v = analizarVentas([
    { status: 'paid', currency_id: 'ARS', order_items: [linea('A', 1, 1, 1000)] },
    { status: 'paid', currency_id: 'ARS', order_items: [linea('A', 1, 2, 1000), linea('B', 2, 1, 500)] },
    { status: 'cancelled', currency_id: 'ARS', order_items: [linea('B', 2, 5, 500)] },
  ]);
  assert.equal(v.ordenes, 2);
  assert.equal(v.unidades, 4);
  assert.equal(v.monto, 3500);
  assert.equal(v.top[0].titulo, 'A');
  assert.equal(v.top[0].unidades, 3);
});

test('demo: datos estables para la misma fecha y reporte completo', () => {
  const a = datosDemo('20/10/2026');
  const b = datosDemo('20/10/2026');
  assert.deepEqual(a, b);
  const r = analizar({ ...a, config });
  const email = armarEmail(r);
  assert.match(email.asunto, /Rremotos · 20\/10\/2026/);
  assert.match(email.html, /Para recargar/);
  assert.ok(r.stock.publicaciones > 10);
  assert.ok(!/undefined|NaN/.test(email.html + email.texto));
});

test('email sin ventas ni alertas', () => {
  const r = analizar({ items: [pub('A', [2, 2])], orders: [], config });
  const email = armarEmail(r);
  assert.match(email.asunto, /stock OK/);
  assert.match(email.texto, /no hubo ventas/);
});
