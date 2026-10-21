const config = $('Config').first().json;
const { items, orders } = datosDemo(config.FECHA_REPORTE);
return [{ json: { items, orders, config } }];
