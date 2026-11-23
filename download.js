const fs = require('fs');
const zlib = require('zlib');
const WANT = new Set(['xray', 'geoip.dat', 'geosite.dat']);
const URL = 'https://github.com/XTLS/Xray-core/releases/download/v26.11.9/Xray-linux-64.zip';
async function main() {
  const res = await fetch(URL, { headers: { 'User-Agent': 'node-cweb' } });
  if (!res.ok) throw new Error('download failed: ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('downloaded', buf.length, 'bytes');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('EOCD not found');
  const total = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
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
    if (!WANT.has(name)) continue;
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const comp = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = comp;
    else if (method === 8) data = zlib.inflateRawSync(comp);
    else throw new Error('unsupported compression ' + method + ' for ' + name);
    if (data.length !== usize) throw new Error('size mismatch for ' + name);
    fs.writeFileSync(name, data);
    console.log('extracted', name, data.length);
  }
  fs.chmodSync('xray', 0o755);
  console.log('done');
}
main().catch(e => { console.error(e); process.exit(1); });
