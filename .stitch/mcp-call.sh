#!/bin/bash
# Stitch MCP 调用助手（本会话工具）：$1=tool名，$2=params JSON
# key 从 Antigravity mcp_config 读取，不落盘
KEY=$(python3 -c "
import json
j=json.load(open('/Users/reed_soul/.gemini/antigravity/mcp_config.json'))
a=j['mcpServers']['StitchMCP']['args']
print(a[a.index('--header')+1].split('X-Goog-Api-Key: ')[1])
")
curl -s -X POST "https://stitch.googleapis.com/mcp" \
  -H "X-Goog-Api-Key: $KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" \
| python3 -c "
import json,sys
raw=sys.stdin.read()
j=json.loads(raw.split('data: ')[-1]) if 'data: ' in raw else json.loads(raw)
if 'error' in j: print('RPC-ERROR:', json.dumps(j['error'],ensure_ascii=False)[:500]); exit(1)
r=j.get('result',{})
content=r.get('content',[])
for c in content:
    if c.get('type')=='text': print(c['text'][:100000])
    else: print(json.dumps(c,ensure_ascii=False)[:2000])
if r.get('isError'): print('TOOL-ERROR')
"
