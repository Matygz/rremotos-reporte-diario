"""Genera workflow/reporte-diario.json a partir de los fuentes en src/.

La lógica vive en src/lib.js (con tests) y se incrusta en los nodos Code que la usan,
así el workflow importado en n8n es autosuficiente y el código no se duplica a mano.

Uso: python build_workflow.py
"""
import json
import uuid
from pathlib import Path

RAIZ = Path(__file__).parent
SRC = RAIZ / "src"
SALIDA = RAIZ / "workflow" / "reporte-diario.json"

API = "https://api.mercadolibre.com"
SELLER = "{{ $('Config').first().json.SELLER_ID }}"


def leer(nombre: str) -> str:
    return (SRC / nombre).read_text(encoding="utf-8").strip() + "\n"


def con_lib(nodo: str) -> str:
    lib = leer("lib.js")
    return f"{lib}\n// ---------- Nodo ----------\n{leer(nodo)}"


def nodo(nombre, tipo, version, x, y, parametros, **extra):
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"reporte-ml/{nombre}")),
        "name": nombre,
        "type": tipo,
        "typeVersion": version,
        "position": [x, y],
        "parameters": parametros,
        **extra,
    }


def code(nombre, x, y, js, **extra):
    return nodo(nombre, "n8n-nodes-base.code", 2, x, y, {"jsCode": js}, **extra)


def si_verdadero(nombre, x, y, campo):
    return nodo(nombre, "n8n-nodes-base.if", 2.2, x, y, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"reporte-ml/{nombre}/cond")),
                "leftValue": f"={{{{ $json.{campo} }}}}",
                "rightValue": "",
                "operator": {"type": "boolean", "operation": "true", "singleValue": True},
            }],
            "combinator": "and",
        },
        "looseTypeValidation": True,
        "options": {},
    })


def http_ml(nombre, x, y, url, query, paginar=False, **extra):
    opciones = {}
    if paginar:
        opciones["pagination"] = {"pagination": {
            "paginationMode": "updateAParameterInEachRequest",
            "parameters": {"parameters": [{"type": "qs", "name": "offset", "value": "={{ $pageCount * 50 }}"}]},
            "paginationCompleteWhen": "other",
            "completeExpression": "={{ !$response.body.results || $response.body.results.length < 50 }}",
            "limitPagesFetched": True,
            "maxRequests": 40,
            "requestInterval": 300,
        }}
    return nodo(nombre, "n8n-nodes-base.httpRequest", 4.2, x, y, {
        "url": f"={API}{url}",
        "authentication": "genericCredentialType",
        "genericAuthType": "oAuth2Api",
        "sendQuery": True,
        "queryParameters": {"parameters": [{"name": k, "value": v} for k, v in query]},
        "options": opciones,
    }, **extra)


def construir():
    nodos = [
        nodo("Todos los días 14:00", "n8n-nodes-base.scheduleTrigger", 1.2, 0, 0,
             {"rule": {"interval": [{"field": "cronExpression", "expression": "0 14 * * *"}]}}),
        nodo("Ejecutar a mano", "n8n-nodes-base.manualTrigger", 1, 0, 200, {}),
        code("Config", 240, 100, leer("nodes/config.js")),
        si_verdadero("¿Modo demo?", 460, 100, "DEMO_MODE"),
        code("Datos demo", 700, -60, con_lib("nodes/datos_demo.js")),
        code("Estados a consultar", 700, 220, leer("nodes/estados.js")),
        http_ml("Buscar publicaciones", 920, 220, f"/users/{SELLER}/items/search",
                [("status", "={{ $json.status }}"), ("limit", "50")], paginar=True),
        code("Lotes de 20", 1140, 220, leer("nodes/lotes.js")),
        http_ml("Detalle publicaciones", 1360, 220, "/items",
                [("ids", "={{ $json.ids }}"),
                 ("attributes", "id,title,status,sub_status,permalink,available_quantity,variations")]),
        http_ml("Ventas de ayer", 1580, 220, "/orders/search",
                [("seller", f"={SELLER}"),
                 ("order.status", "paid"),
                 ("order.date_created.from", "={{ $('Config').first().json.DESDE }}"),
                 ("order.date_created.to", "={{ $('Config').first().json.HASTA }}"),
                 ("sort", "date_desc"),
                 ("limit", "50")],
                paginar=True, executeOnce=True),
        code("Unificar datos", 1800, 220, leer("nodes/unificar.js")),
        code("Analizar y armar email", 2040, 100, con_lib("nodes/analizar.js")),
        si_verdadero("¿Enviar email?", 2260, 100, "enviar"),
        nodo("Enviar email", "n8n-nodes-base.emailSend", 2.1, 2480, 0, {
            "fromEmail": "={{ $json.remitente }}",
            "toEmail": "={{ $json.destino }}",
            "subject": "={{ $json.asunto }}",
            "emailFormat": "both",
            "text": "={{ $json.texto }}",
            "html": "={{ $json.html }}",
            "options": {},
        }),
    ]

    def a(destino, salida=0):
        return (destino, salida)

    enlaces = {
        "Todos los días 14:00": [[a("Config")]],
        "Ejecutar a mano": [[a("Config")]],
        "Config": [[a("¿Modo demo?")]],
        "¿Modo demo?": [[a("Datos demo")], [a("Estados a consultar")]],
        "Datos demo": [[a("Analizar y armar email")]],
        "Estados a consultar": [[a("Buscar publicaciones")]],
        "Buscar publicaciones": [[a("Lotes de 20")]],
        "Lotes de 20": [[a("Detalle publicaciones")]],
        "Detalle publicaciones": [[a("Ventas de ayer")]],
        "Ventas de ayer": [[a("Unificar datos")]],
        "Unificar datos": [[a("Analizar y armar email")]],
        "Analizar y armar email": [[a("¿Enviar email?")]],
        "¿Enviar email?": [[a("Enviar email")], []],
    }
    conexiones = {
        origen: {"main": [[{"node": d, "type": "main", "index": i} for d, i in rama] for rama in ramas]}
        for origen, ramas in enlaces.items()
    }

    return {
        "name": "Rremotos · Reporte diario de ventas y reposición",
        "nodes": nodos,
        "connections": conexiones,
        "active": False,
        "settings": {"executionOrder": "v1", "timezone": "America/Argentina/Buenos_Aires"},
        "pinData": {},
        "tags": [],
    }


if __name__ == "__main__":
    SALIDA.parent.mkdir(exist_ok=True)
    SALIDA.write_text(json.dumps(construir(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK -> {SALIDA.relative_to(RAIZ)}")
