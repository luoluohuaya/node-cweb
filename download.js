const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const cp = require('child_process');
const URL = 'https://github.com/XTLS/Xray-core/releases/download/v26.11.9/Xray-linux-64.zip';
async function main() {
  console.log('cwd', process.cwd(), 'home', os.homedir());
  const res = await fetch(URL, { headers: { 'User-Agent': 'node-cweb' } });
  if (!res.ok) throw new Error('download failed: ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('downloaded', buf.length, 'bytes');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('EOCD not found');
  const total = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  let data = null;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(cd + 10);
    const csize = buf.readUInt32LE(cd + 20);
    const usize = buf.readUInt32LE(cd + 24);
    const nlen = buf.readUInt16LE(cd + 28);
    const elen = buf.readUInt16LE(cd + 30);
    const clen = buf.readUInt16LE(cd + 32);
    const lho = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nlen);
    cd += 46 + nlen + elen + clen;
    if (name !== 'xray') continue;
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const comp = buf.subarray(start, start + csize);
    if (method === 0) data = comp;
    else if (method === 8) data = zlib.inflateRawSync(comp);
    else throw new Error('unsupported compression ' + method);
    if (data.length !== usize) throw new Error('size mismatch');
  }
  if (!data) throw new Error('xray entry not found in zip');
  console.log('xray extracted in memory', data.length, 'bytes');
  const candidates = [process.cwd(), path.join(os.homedir(), 'xray-app'), '/tmp/xray-app'];
  let ok = false;
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, 'xray');
      fs.writeFileSync(p, data);
      fs.chmodSync(p, 0o755);
      console.log('wrote', p);
      const r = cp.spawnSync(p, ['version'], { timeout: 10000, encoding: 'utf8' });
      console.log('exec test', p, 'status', r.status, 'error', r.error ? String(r.error) : '', 'stdout', (r.stdout || '').slice(0, 200));
      if (r.status === 0) { console.log('EXEC OK', p); ok = true; }
    } catch (e) { console.log('candidate failed', dir, String(e)); }
  }
  if (!ok) throw new Error('no candidate location could execute xray');
  console.log('done');
}
main().catch(e => { console.error(e); process.exit(1); });
