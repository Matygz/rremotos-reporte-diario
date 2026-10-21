// Junta los IDs de todas las páginas de búsqueda y los parte en lotes de 20,
// el máximo que acepta el endpoint /items?ids= por llamada.
const ids = [...new Set($input.all().flatMap((i) => i.json.results || []))];
const lotes = [];
for (let i = 0; i < ids.length; i += 20) {
  lotes.push({ json: { ids: ids.slice(i, i + 20).join(',') } });
}
if (lotes.length === 0) {
  throw new Error('No se encontraron publicaciones activas ni pausadas. Revisá SELLER_ID y la credencial.');
}
return lotes;
