const { items, orders, config } = $input.first().json;
const resumen = analizar({ items, orders, config });
const email = armarEmail(resumen);

return [{
  json: {
    asunto: email.asunto,
    texto: email.texto,
    html: email.html,
    destino: config.EMAIL_DESTINO,
    remitente: config.EMAIL_REMITENTE,
    enviar: config.ENVIAR_EMAIL,
    resumen,
  },
}];
