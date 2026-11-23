// Pure Node.js VLESS over WebSocket server (no native binary needed).
// Protocol: VLESS (version 0), WebSocket path /vless, same UUID as config.json.
// The cWeb Node runtime cannot execute a downloaded xray binary
// (/app is read-only, /tmp and /dev/shm are noexec), so this server
// implements the VLESS TCP/UDP relay in Node itself.
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const PORT = parseInt(process.env.PORT || '3000', 10);
let UUID_HEX = '3171b9af0ccc4bb9864726d36f3989b1';
try {
  const cfg = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
  const id = cfg.inbounds && cfg.inbounds[0] && cfg.inbounds[0].settings && cfg.inbounds[0].settings.clients && cfg.inbounds[0].settings.clients[0] && cfg.inbounds[0].settings.clients[0].id;
  if (id) UUID_HEX = String(id).replace(/-/g, '');
} catch (e) { console.log('config.json not read, using built-in UUID'); }
const UUID = Buffer.from(UUID_HEX, 'hex');
console.log('VLESS server starting, port', PORT, 'uuid', UUID_HEX);
function wsAccept(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}
function sendWsFrame(sock, payload, opcode) {
  if (sock.destroyed) return;
  opcode = opcode === undefined ? 2 : opcode;
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x80 | opcode, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  sock.write(Buffer.concat([header, payload]));
}
function parseAddress(buf, off) {
  const type = buf[off];
  if (type === 1) return { addr: buf[off + 1] + '.' + buf[off + 2] + '.' + buf[off + 3] + '.' + buf[off + 4], len: 5 };
  if (type === 2) { const l = buf[off + 1]; return { addr: buf.toString('utf8', off + 2, off + 2 + l), len: 2 + l }; }
  if (type === 3) {
    const parts = [];
    for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(off + 1 + i * 2).toString(16));
    return { addr: parts.join(':'), len: 17 };
  }
  return null;
}
function handleConnection(sock) {
  let wsBuf = Buffer.alloc(0);
  let frag = [];
  let fragOpcode = 0;
  let closed = false;
  let streamBuf = Buffer.alloc(0);
  let headerDone = false;
  let target = null;
  let udpSock = null;
  let udpTarget = null;
  let responseSent = false;
  function closeAll() {
    if (closed) return;
    closed = true;
    try { if (target) target.destroy(); } catch (e) {}
    try { if (udpSock) udpSock.close(); } catch (e) {}
    try { sock.destroy(); } catch (e) {}
  }
  function sendResponseHeader() {
    if (!responseSent) { responseSent = true; sendWsFrame(sock, Buffer.from([0, 0])); }
  }
  function startTcp(addr, port, firstData) {
    console.log('VLESS TCP', addr, port);
    target = net.connect(port, addr, () => {
      sendResponseHeader();
      if (firstData && firstData.length) target.write(firstData);
    });
    target.on('data', (d) => { sendResponseHeader(); sendWsFrame(sock, d); });
    target.on('error', (e) => { console.log('target error', addr, port, e.message); closeAll(); });
    target.on('close', () => { closeAll(); });
  }
  function startUdp(addr, port) {
    console.log('VLESS UDP', addr, port);
    udpTarget = { addr: addr, port: port };
    udpSock = dgram.createSocket('udp4');
    udpSock.on('message', (msg) => {
      if (!udpTarget) return;
      sendResponseHeader();
      const a = udpTarget;
      let abuf;
      if (net.isIPv4(a.addr)) { const p = a.addr.split('.').map(Number); abuf = Buffer.from([1, p[0], p[1], p[2], p[3]]); }
      else { const db = Buffer.from(a.addr, 'utf8'); abuf = Buffer.concat([Buffer.from([2, db.length]), db]); }
      const pb = Buffer.alloc(2); pb.writeUInt16BE(a.port, 0);
      const body = Buffer.concat([pb, abuf, msg]);
      const lb = Buffer.alloc(2); lb.writeUInt16BE(body.length, 0);
      sendWsFrame(sock, Buffer.concat([lb, body]));
    });
    udpSock.on('error', (e) => { console.log('udp error', e.message); closeAll(); });
  }
  function handleUdpData(buf) {
    let off = 0;
    while (off + 2 <= buf.length) {
      const plen = buf.readUInt16BE(off); off += 2;
      if (off + plen > buf.length) break;
      const pkt = buf.subarray(off, off + plen); off += plen;
      if (pkt.length < 3) continue;
      const port = pkt.readUInt16BE(0);
      const parsed = parseAddress(pkt, 2);
      if (!parsed) continue;
      const data = pkt.subarray(2 + parsed.len);
      if (!udpSock) startUdp(parsed.addr, port);
      if (udpSock) { udpTarget = { addr: parsed.addr, port: port }; udpSock.send(data, port, parsed.addr, (e) => { if (e) console.log('udp send error', e.message); }); }
    }
  }
  function onStreamData(chunk) {
    streamBuf = Buffer.concat([streamBuf, chunk]);
    if (!headerDone) {
      if (streamBuf.length < 18) return;
      const version = streamBuf[0];
      if (!streamBuf.subarray(1, 17).equals(UUID)) { console.log('VLESS uuid mismatch'); closeAll(); return; }
      const optLen = streamBuf[17];
      const base = 18 + optLen;
      if (streamBuf.length < base + 4) return;
      const cmd = streamBuf[base];
      const port = streamBuf.readUInt16BE(base + 1);
      const parsed = parseAddress(streamBuf, base + 3);
      if (!parsed) { console.log('VLESS bad address'); closeAll(); return; }
      const headerLen = base + 3 + parsed.len;
      const rest = streamBuf.subarray(headerLen);
      headerDone = true;
      console.log('VLESS v' + version + ' cmd ' + cmd + ' -> ' + parsed.addr + ':' + port);
      if (cmd === 1) { startTcp(parsed.addr, port, rest); }
      else if (cmd === 2) { startUdp(parsed.addr, port); if (rest.length) handleUdpData(rest); }
      else { console.log('VLESS unsupported command', cmd, '(mux not supported)'); closeAll(); }
      streamBuf = Buffer.alloc(0);
      return;
    }
    if (target) { target.write(streamBuf); streamBuf = Buffer.alloc(0); }
    else if (udpSock) { handleUdpData(streamBuf); streamBuf = Buffer.alloc(0); }
  }
  function deliverMessage(msg, opcode) {
    if (opcode === 1 || opcode === 2) onStreamData(msg);
  }
  function processWs() {
    while (true) {
      if (wsBuf.length < 2) return;
      const b0 = wsBuf[0]; const b1 = wsBuf[1];
      const fin = (b0 & 0x80) !== 0; const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0; let len = b1 & 0x7f; let off = 2;
      if (len === 126) { if (wsBuf.length < 4) return; len = wsBuf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (wsBuf.length < 10) return; len = Number(wsBuf.readBigUInt64BE(2)); off = 10; }
      const maskLen = masked ? 4 : 0;
      if (wsBuf.length < off + maskLen + len) return;
      let payload = wsBuf.subarray(off + maskLen, off + maskLen + len);
      if (masked) { const key = wsBuf.subarray(off, off + 4); const un = Buffer.from(payload); for (let i = 0; i < un.length; i++) un[i] ^= key[i % 4]; payload = un; }
      wsBuf = wsBuf.subarray(off + maskLen + len);
      if (opcode === 8) { closeAll(); return; }
      if (opcode === 9) { sendWsFrame(sock, payload, 10); continue; }
      if (opcode === 10) continue;
      if (opcode === 0) {
        frag.push(payload);
        if (fin) { deliverMessage(Buffer.concat(frag), fragOpcode); frag = []; }
        continue;
      }
      if (!fin) { frag = [payload]; fragOpcode = opcode; continue; }
      deliverMessage(payload, opcode);
    }
  }
  sock.on('data', (d) => { wsBuf = Buffer.concat([wsBuf, d]); try { processWs(); } catch (e) { console.log('ws parse error', e.message); closeAll(); } });
  sock.on('error', () => closeAll());
  sock.on('close', () => closeAll());
}
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/vless') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('vless server running'); return; }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not Found');
});
server.on('upgrade', (req, sock, head) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname !== '/vless') { sock.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key) { sock.destroy(); return; }
    console.log('WS upgrade', u.pathname, 'from', req.socket.remoteAddress);
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n');
    if (head && head.length) sock.unshift(head);
    handleConnection(sock);
  } catch (e) { console.log('upgrade error', e.message); try { sock.destroy(); } catch (err) {} }
});
server.listen(PORT, '0.0.0.0', () => { console.log('listening on', PORT); });
server.on('error', (e) => { console.log('server error', e); });
