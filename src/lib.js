// Lógica del reporte diario. Funciones puras: se testean con `node --test`
// y el script build_workflow.py las incrusta en los nodos Code de n8n.

const TALLE_RE = /talle|size|tamaño/i;

/** Nombre legible de una variante: el talle si existe, si no la combinación completa. */
function nombreVariante(variacion) {
  const attrs = variacion.attribute_combinations || [];
  const talle = attrs.find((a) => TALLE_RE.test(a.name || '') || a.id === 'SIZE');
  if (talle && talle.value_name) return String(talle.value_name);
  const valores = attrs.map((a) => a.value_name).filter(Boolean);
  return valores.length ? valores.join(' / ') : String(variacion.id);
}

/** Lista de variantes {nombre, stock} de una publicación (sin variaciones = una sola). */
function variantesDe(item) {
  const vars = item.variations || [];
  if (vars.length === 0) {
    return [{ nombre: '(única)', stock: Number(item.available_quantity) || 0 }];
  }
  return vars.map((v) => ({ nombre: nombreVariante(v), stock: Number(v.available_quantity) || 0 }));
}

/** Ordena talles numéricos de menor a mayor y el resto alfabéticamente. */
function ordenarVariantes(a, b) {
  const na = Number(a.nombre);
  const nb = Number(b.nombre);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.nombre.localeCompare(b.nombre, 'es');
}

/**
 * Regla de reposición (definida por el negocio):
 * una publicación con varias variantes necesita recarga cuando
 * MIN_VARIANTES_BAJAS o más variantes tienen menos de UMBRAL_STOCK unidades.
 * Las publicaciones de variante única se informan aparte cuando llegan a 0.
 */
function analizarStock(items, config) {
  const umbral = Number(config.UMBRAL_STOCK);
  const minBajas = Number(config.MIN_VARIANTES_BAJAS);
  const alertas = [];
  const sinStock = [];
  let variantesTotales = 0;

  for (const item of items) {
    const variantes = variantesDe(item);
    variantesTotales += variantes.length;

    if (variantes.length === 1) {
      if (variantes[0].stock === 0) {
        sinStock.push({ id: item.id, titulo: item.title, permalink: item.permalink || '' });
      }
      continue;
    }

    const bajas = variantes.filter((v) => v.stock < umbral).sort(ordenarVariantes);
    if (bajas.length >= minBajas) {
      alertas.push({
        id: item.id,
        titulo: item.title,
        permalink: item.permalink || '',
        pausada: item.status === 'paused',
        bajas,
        sinStock: bajas.filter((v) => v.stock === 0).length,
        totalVariantes: variantes.length,
      });
    }
  }

  // Primero las más urgentes: más variantes en 0, después más variantes bajas.
  alertas.sort((a, b) => b.sinStock - a.sinStock || b.bajas.length - a.bajas.length || a.titulo.localeCompare(b.titulo, 'es'));
  return { alertas, sinStock, publicaciones: items.length, variantes: variantesTotales };
}

/** Resumen de ventas de un conjunto de órdenes de Mercado Libre (solo las pagadas). */
function analizarVentas(orders, topN = 5) {
  const pagadas = orders.filter((o) => o.status === 'paid');
  const porProducto = new Map();
  let unidades = 0;
  let monto = 0;
  let moneda = 'ARS';

  for (const orden of pagadas) {
    if (orden.currency_id) moneda = orden.currency_id;
    for (const linea of orden.order_items || []) {
      const cantidad = Number(linea.quantity) || 0;
      const subtotal = cantidad * (Number(linea.unit_price) || 0);
      unidades += cantidad;
      monto += subtotal;

      const item = linea.item || {};
      const variante = (item.variation_attributes || [])
        .map((a) => a.value_name)
        .filter(Boolean)
        .join(' / ');
      const clave = `${item.id}|${item.variation_id || ''}`;
      const actual = porProducto.get(clave) || { titulo: item.title || item.id, variante, unidades: 0, monto: 0 };
      actual.unidades += cantidad;
      actual.monto += subtotal;
      porProducto.set(clave, actual);
    }
  }

  const top = [...porProducto.values()]
    .sort((a, b) => b.unidades - a.unidades || b.monto - a.monto)
    .slice(0, topN);

  return { ordenes: pagadas.length, unidades, monto: Math.round(monto), moneda, top };
}

function analizar({ items, orders, config }) {
  return {
    fecha: config.FECHA_REPORTE,
    fuente: config.DEMO_MODE ? 'demo' : 'mercadolibre',
    config: { umbral: Number(config.UMBRAL_STOCK), minBajas: Number(config.MIN_VARIANTES_BAJAS) },
    ventas: analizarVentas(orders),
    stock: analizarStock(items, config),
  };
}

// ---------- Email ----------

function escapar(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatearMonto(monto, moneda) {
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(monto);
  } catch (e) {
    return `${moneda} ${Math.round(monto).toLocaleString('es-AR')}`;
  }
}

function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

function enlace(titulo, permalink) {
  const t = escapar(titulo);
  return permalink ? `<a href="${escapar(permalink)}" style="color:#1a56db;text-decoration:none">${t}</a>` : t;
}

function armarEmail(r) {
  const { ventas, stock } = r;
  const recargar = stock.alertas.length;
  const asunto = `Rremotos · ${r.fecha} · ${plural(ventas.unidades, 'unidad vendida', 'unidades vendidas')} · ` +
    (recargar ? `${plural(recargar, 'publicación', 'publicaciones')} para recargar` : 'stock OK');

  const th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;font-size:13px;color:#555"';
  const thNum = 'style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;font-size:13px;color:#555"';
  const td = 'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:14px;vertical-align:top"';
  const tdNum = 'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap"';

  const filasTop = ventas.top.map((p) =>
    `<tr><td ${td}>${escapar(p.titulo)}${p.variante ? `<br><span style="color:#777;font-size:12px">${escapar(p.variante)}</span>` : ''}</td>` +
    `<td ${tdNum}>${p.unidades}</td><td ${tdNum}>${formatearMonto(p.monto, ventas.moneda)}</td></tr>`).join('');

  const filasAlertas = stock.alertas.map((a) => {
    const detalle = a.bajas
      .map((v) => `<span style="display:inline-block;margin:0 6px 4px 0;padding:2px 6px;border-radius:4px;background:${v.stock === 0 ? '#fde2e2' : '#fff4d6'};font-size:13px">${escapar(v.nombre)}: <b>${v.stock}</b></span>`)
      .join('');
    const pausa = a.pausada ? ' <span style="color:#b42318;font-size:12px">(pausada)</span>' : '';
    return `<tr><td ${td}>${enlace(a.titulo, a.permalink)}${pausa}</td><td ${td}>${detalle}</td></tr>`;
  }).join('');

  const listaSinStock = stock.sinStock.map((s) => `<li style="margin-bottom:4px">${enlace(s.titulo, s.permalink)}</li>`).join('');

  const seccionVentas = ventas.ordenes === 0
    ? '<p style="margin:0 0 8px">Ayer no hubo ventas pagadas.</p>'
    : `<p style="margin:0 0 12px;font-size:15px"><b>${plural(ventas.unidades, 'unidad', 'unidades')}</b> en ${plural(ventas.ordenes, 'orden', 'órdenes')} · <b>${formatearMonto(ventas.monto, ventas.moneda)}</b></p>
       <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">
         <tr><th ${th}>Más vendidos</th><th ${thNum}>Unid.</th><th ${thNum}>Total</th></tr>
         ${filasTop}
       </table>`;

  const seccionAlertas = recargar === 0
    ? `<p style="margin:0">Ninguna publicación tiene ${r.config.minBajas} o más talles con menos de ${r.config.umbral} unidades.</p>`
    : `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">
         <tr><th ${th}>Publicación</th><th ${th}>Talles con stock bajo</th></tr>
         ${filasAlertas}
       </table>`;

  const seccionSinStock = stock.sinStock.length
    ? `<h3 style="font-size:15px;margin:20px 0 8px">Sin stock (variante única)</h3><ul style="margin:0;padding-left:18px">${listaSinStock}</ul>`
    : '';

  const avisoDemo = r.fuente === 'demo'
    ? '<p style="margin:0 0 16px;padding:8px 10px;background:#eef2ff;border-radius:6px;font-size:13px">Modo demo: datos ficticios, sin conexión a Mercado Libre.</p>'
    : '';

  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;padding:20px">
    <h2 style="margin:0 0 4px;font-size:20px">Reporte diario · Rremotos</h2>
    <p style="margin:0 0 16px;color:#666;font-size:13px">Ventas del ${escapar(r.fecha)} · stock de ${plural(stock.publicaciones, 'publicación', 'publicaciones')} (${stock.variantes} variantes)</p>
    ${avisoDemo}
    <h3 style="font-size:16px;margin:0 0 8px">Ventas de ayer</h3>
    ${seccionVentas}
    <h3 style="font-size:16px;margin:24px 0 4px">Para recargar${recargar ? ` (${recargar})` : ''}</h3>
    <p style="margin:0 0 10px;color:#666;font-size:12px">Publicaciones con ${r.config.minBajas} o más talles con menos de ${r.config.umbral} unidades. En rojo, los talles en 0.</p>
    ${seccionAlertas}
    ${seccionSinStock}
  </div></body></html>`;

  const lineas = [
    `Reporte diario Rremotos · ventas del ${r.fecha}`,
    ventas.ordenes === 0
      ? 'Ayer no hubo ventas pagadas.'
      : `${plural(ventas.unidades, 'unidad', 'unidades')} en ${plural(ventas.ordenes, 'orden', 'órdenes')} · ${formatearMonto(ventas.monto, ventas.moneda)}`,
    ...ventas.top.map((p) => `  - ${p.titulo}${p.variante ? ` (${p.variante})` : ''}: ${p.unidades}`),
    '',
    recargar ? `Para recargar (${recargar}):` : 'Stock OK: nada para recargar.',
    ...stock.alertas.map((a) => `  - ${a.titulo}${a.pausada ? ' [pausada]' : ''}: ${a.bajas.map((v) => `${v.nombre}=${v.stock}`).join(', ')}`),
    ...(stock.sinStock.length ? ['', 'Sin stock (variante única):', ...stock.sinStock.map((s) => `  - ${s.titulo}`)] : []),
  ];

  return { asunto, html, texto: lineas.join('\n') };
}

// ---------- Datos demo ----------

/** Generador pseudoaleatorio con semilla: el demo da siempre el mismo resultado para la misma fecha. */
function crearRandom(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function semillaDeFecha(fecha) {
  return [...String(fecha)].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
}

function datosDemo(fecha) {
  const rnd = crearRandom(semillaDeFecha(fecha));
  const modelos = ['410', '512', '618', '733', '805', '920'];
  const colores = ['NEGRO', 'BLANCO', 'AZUL', 'GRIS'];
  const talles = ['35', '36', '37', '38', '39', '40', '41', '42', '43'];
  const items = [];
  let itemN = 1000001;
  let varN = 5000001;

  for (const modelo of modelos) {
    for (const color of colores.slice(0, 2 + Math.floor(rnd() * 3))) {
      const tallesPub = talles.filter(() => rnd() > 0.25);
      const variations = tallesPub.map((talle) => {
        // La mayoría arranca en 2 (stock base del negocio); algunas bajan a 1 o 0.
        const r = rnd();
        const stock = r < 0.05 ? 0 : r < 0.13 ? 1 : r < 0.9 ? 2 : 3;
        return {
          id: varN++,
          available_quantity: stock,
          attribute_combinations: [
            { id: 'COLOR', name: 'Color', value_name: color[0] + color.slice(1).toLowerCase() },
            { id: 'SIZE', name: 'Talle', value_name: talle },
          ],
        };
      });
      const total = variations.reduce((s, v) => s + v.available_quantity, 0);
      items.push({
        id: `MLA${itemN++}`,
        title: `Zapatilla ${modelo} ${color}`,
        status: total === 0 ? 'paused' : 'active',
        permalink: '',
        available_quantity: total,
        variations,
      });
    }
  }

  // Dos publicaciones sin variaciones (accesorios) para cubrir ese caso.
  items.push({ id: `MLA${itemN++}`, title: 'Plantillas de gel', status: 'active', permalink: '', available_quantity: 4, variations: [] });
  items.push({ id: `MLA${itemN++}`, title: 'Cordones planos x2', status: 'paused', permalink: '', available_quantity: 0, variations: [] });

  const conVariaciones = items.filter((i) => i.variations.length);
  const orders = [];
  const cantidadOrdenes = 6 + Math.floor(rnd() * 10);
  for (let n = 0; n < cantidadOrdenes; n++) {
    const item = conVariaciones[Math.floor(rnd() * conVariaciones.length)];
    const v = item.variations[Math.floor(rnd() * item.variations.length)];
    orders.push({
      id: 2000000000 + n,
      status: rnd() < 0.9 ? 'paid' : 'cancelled',
      currency_id: 'ARS',
      order_items: [{
        item: { id: item.id, title: item.title, variation_id: v.id, variation_attributes: v.attribute_combinations },
        quantity: rnd() < 0.85 ? 1 : 2,
        unit_price: 38000 + Math.floor(rnd() * 8) * 2500,
      }],
    });
  }

  return { items, orders };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { nombreVariante, variantesDe, analizarStock, analizarVentas, analizar, armarEmail, datosDemo };
}
