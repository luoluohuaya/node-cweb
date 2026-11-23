#!/bin/sh
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
if [ ! -x ./xray ] && [ ! -x "$HOME/xray-app/xray" ] && [ ! -x /tmp/xray-app/xray ]; then
  node download.js
fi
node -e "const fs=require('fs');fs.writeFileSync('/tmp/config.json',fs.readFileSync('./config.json','utf8').replace('__PORT__',process.env.PORT||'3000'))"
if [ -x ./xray ]; then exec ./xray run -config /tmp/config.json; fi
if [ -x "$HOME/xray-app/xray" ]; then exec "$HOME/xray-app/xray" run -config /tmp/config.json; fi
exec /tmp/xray-app/xray run -config /tmp/config.json
