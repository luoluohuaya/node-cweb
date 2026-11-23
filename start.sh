#!/bin/sh
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
if [ ! -x /tmp/xray-app/xray ]; then
  node download.js
fi
node -e "const fs=require('fs');fs.writeFileSync('/tmp/config.json',fs.readFileSync('./config.json','utf8').replace('__PORT__',process.env.PORT||'3000'))"
exec /tmp/xray-app/xray run -config /tmp/config.json
