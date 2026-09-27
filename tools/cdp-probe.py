import json, requests, websocket, sys
page=requests.get('http://127.0.0.1:9222/json').json()[0]
ws=websocket.create_connection(page['webSocketDebuggerUrl'], suppress_origin=True, timeout=8)
expr="fetch('http://127.0.0.1:8787/api/network').then(r=>r.status).catch(e=>'ERR:'+e.message)"
ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expr,'awaitPromise':True,'returnByValue':True}}))
while True:
 m=json.loads(ws.recv())
 if m.get('id')==1:
  print(json.dumps(m,ensure_ascii=False),flush=True)
  break
