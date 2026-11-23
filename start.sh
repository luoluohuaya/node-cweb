#!/bin/sh
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
if [ ! -x /dev/shm/xray-app/xray ] && [ ! -x /var/tmp/xray-app/xray ] && [ ! -x ./xray ] && [ ! -x /tmp/xray-app/xray ]; then
  node download.js
fi
node -e "const fs=require('fs');fs.writeFileSync('/tmp/config.json',fs.readFileSync('./config.json','utf8').replace('__PORT__',process.env.PORT||'3000'))"
if [ -x /dev/shm/xray-app/xray ]; then exec /dev/shm/xray-app/xray run -config /tmp/config.json; fi
if [ -x /var/tmp/xray-app/xray ]; then exec /var/tmp/xray-app/xray run -config /tmp/config.json; fi
if [ -x ./xray ]; then exec ./xray run -config /tmp/config.json; fi
if [ -f /tmp/xray-app/xray ]; then exec /lib64/ld-linux-x86-64.so /tmp/xray-app/xray run -config /tmp/config.json; fi
exec /tmp/xray-app/xray run -config /tmp/config.json
