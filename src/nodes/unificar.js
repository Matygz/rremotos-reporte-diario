// Junta lo que trajeron las llamadas a la API en un solo objeto con la misma forma que el modo demo.
const config = $('Config').first().json;

const items = $('Detalle publicaciones').all()
  .map((i) => i.json)
  .filter((r) => r.code === 200 && r.body)
  .map((r) => r.body);

const orders = $('Ventas de ayer').all().flatMap((i) => i.json.results || []);

return [{ json: { items, orders, config } }];
