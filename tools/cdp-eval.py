import json
import requests
import websocket
import sys
sys.stdout.reconfigure(encoding='utf-8')

page = requests.get('http://127.0.0.1:9222/json').json()[0]
socket = websocket.create_connection(page['webSocketDebuggerUrl'], suppress_origin=True)
counter = 0
def evaluate(expression):
    global counter
    counter += 1
    socket.send(json.dumps({'id': counter, 'method': 'Runtime.evaluate', 'params': {'expression': expression, 'returnByValue': True}}))
    while True:
        message = json.loads(socket.recv())
        if message.get('id') == counter:
            print(json.dumps(message, ensure_ascii=False, indent=2))
            break

evaluate('document.title')
evaluate('document.documentElement.outerHTML.slice(0, 1200)')
evaluate('document.body && document.body.innerText')
evaluate('window.__PATHLENS_BOOTED__')
evaluate('document.querySelectorAll("script").length')
