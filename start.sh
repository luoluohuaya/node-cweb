#!/bin/sh
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
if [ ! -x ./xray ]; then
  curl -L -o xray.zip https://github.com/XTLS/Xray-core/releases/download/v26.11.9/Xray-linux-64.zip
  (unzip -o xray.zip xray geoip.dat geosite.dat || python3 -m zipfile -e xray.zip .)
  chmod +x ./xray
  rm -f xray.zip
fi
sed "s/__PORT__/$PORT/" ./config.json > /tmp/config.json
exec ./xray run -config /tmp/config.json
