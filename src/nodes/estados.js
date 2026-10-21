// Mercado Libre pausa sola una publicación cuando todo su stock llega a 0,
// así que también hay que mirar las pausadas para no perder esas alertas.
return ['active', 'paused'].map((status) => ({ json: { status } }));
