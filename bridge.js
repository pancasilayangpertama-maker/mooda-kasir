#!/usr/bin/env node
/**
 * MoodA Bridge - kirim struk ke printer thermal 58mm lewat WiFi (ESC/POS, port 9100).
 *
 * Browser tidak bisa membuka koneksi TCP mentah, jadi jembatan kecil ini
 * dijalankan di komputer yang SATU JARINGAN dengan printer.
 *
 *   node bridge.js                  # port default 9110
 *   PORT=9111 node bridge.js        # ganti port
 *   MOODA_PRINTER_IP=192.168.1.50 node bridge.js   # kunci IP printer
 *   SUBNET=192.168.1 node bridge.js # batasi pemindaian ke subnet ini
 *
 * Endpoint:
 *   GET  /health  -> { ok, version, printerIp, port }
 *   POST /test    -> { ip? } cari + tes koneksi printer
 *   POST /print   -> { text, ip?, width? } kirim teks ke printer
 *
 * Tanpa dependency npm. Node 18+.
 */

'use strict';

const net = require('node:net');
const os = require('node:os');
const http = require('node:http');

const VERSION = '1.0.0';
const PORT = Number(process.env.PORT || 9110);
const PRINTER_PORT = 9100;
const LOCKED_IP = process.env.MOODA_PRINTER_IP || '';
const SUBNET = process.env.SUBNET || '';

// ESC/POS
const ESC = 0x1b;
const GS = 0x1d;
const INIT = Buffer.from([ESC, 0x40]);
const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0x00]);
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const BOLD_ON = Buffer.from([ESC, 0x45, 0x01]);
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00]);
const SIZE_DOUBLE = Buffer.from([GS, 0x21, 0x11]);
const SIZE_NORMAL = Buffer.from([GS, 0x21, 0x00]);
const CUT = Buffer.from([GS, 0x56, 0x01]);
const FEED = Buffer.from([0x0a, 0x0a, 0x0a]);

let cachedPrinterIp = LOCKED_IP || '';

function log(...args) {
  console.log(`[bridge]`, ...args);
}

function tcpProbe(ip, port, timeout = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

function localSubnets() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (/^169\.254\./.test(info.address)) continue; // link-local
      const parts = info.address.split('.');
      out.push(parts.slice(0, 3).join('.'));
    }
  }
  return [...new Set(out)];
}

async function scanSubnet(prefix, concurrency = 40) {
  const hosts = [];
  for (let i = 1; i <= 254; i++) hosts.push(`${prefix}.${i}`);

  let index = 0;
  let found = null;
  const workers = new Array(concurrency).fill(0).map(async () => {
    while (index < hosts.length && !found) {
      const ip = hosts[index++];
      const ok = await tcpProbe(ip, PRINTER_PORT);
      if (ok && !found) {
        found = ip;
        return;
      }
    }
  });
  await Promise.all(workers);
  return found;
}

async function discoverPrinter() {
  if (LOCKED_IP) return (await tcpProbe(LOCKED_IP, PRINTER_PORT)) ? LOCKED_IP : null;
  if (cachedPrinterIp && (await tcpProbe(cachedPrinterIp, PRINTER_PORT))) return cachedPrinterIp;

  const prefixes = SUBNET ? [SUBNET] : localSubnets();
  for (const prefix of prefixes) {
    log(`memindai ${prefix}.1-254 port ${PRINTER_PORT} ...`);
    const found = await scanSubnet(prefix);
    if (found) {
      cachedPrinterIp = found;
      log(`printer ditemukan: ${found}`);
      return found;
    }
  }
  return null;
}

function textToEscPos(text, width) {
  const cols = width === 80 ? 48 : 32;
  const chunks = [INIT];

  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/[^\x20-\x7E\u00A0-\u024F]/g, ' ');
    const isFirst = i === 0;

    if (isFirst) {
      chunks.push(ALIGN_CENTER, BOLD_ON, SIZE_DOUBLE, Buffer.from(line + '\n', 'ascii'), SIZE_NORMAL, BOLD_OFF);
      return;
    }
    if (/^-{8,}$/.test(line.trim())) {
      chunks.push(ALIGN_LEFT, Buffer.from('-'.repeat(cols) + '\n', 'ascii'));
      return;
    }
    if (/^\s{1,3}\S/.test(raw) && !line.includes(':')) {
      chunks.push(ALIGN_LEFT, Buffer.from(line.slice(0, cols) + '\n', 'ascii'));
      return;
    }
    // baris "Kunci: Nilai" dirapikan ke kiri/kanan
    const kv = line.match(/^([^:]{1,20}):\s*(.+)$/);
    if (kv) {
      const left = kv[1];
      const right = kv[2];
      const space = Math.max(1, cols - left.length - right.length);
      chunks.push(ALIGN_LEFT, Buffer.from((left + ' '.repeat(space) + right).slice(0, cols) + '\n', 'ascii'));
      return;
    }
    chunks.push(ALIGN_LEFT, Buffer.from(line.slice(0, cols) + '\n', 'ascii'));
  });

  chunks.push(FEED, CUT);
  return Buffer.concat(chunks);
}

function sendToPrinter(ip, buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(6000);
    socket.once('connect', () => {
      socket.write(buffer, () => {
        socket.end();
        resolve(true);
      });
    });
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`timeout koneksi ke ${ip}:${PRINTER_PORT}`)); });
    socket.once('error', (err) => reject(new Error(`gagal konek ${ip}:${PRINTER_PORT} - ${err.message}`)));
    socket.connect(PRINTER_PORT, ip);
  });
}

// ---------- HTTP ----------
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) { reject(new Error('payload terlalu besar')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error('JSON tidak valid')); }
    });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, version: VERSION, printerIp: cachedPrinterIp || null, port: PRINTER_PORT });
    }

    if (req.method === 'POST' && url.pathname === '/test') {
      const body = await readJson(req);
      const ip = (body.ip || '').trim() || (await discoverPrinter());
      if (!ip) return send(res, 200, { ok: false, error: 'printer tidak ditemukan di jaringan' });
      const ok = await tcpProbe(ip, PRINTER_PORT, 1500);
      if (!ok) return send(res, 200, { ok: false, error: `port ${PRINTER_PORT} tidak terbuka di ${ip}` });
      cachedPrinterIp = ip;
      return send(res, 200, { ok: true, printerIp: ip, port: PRINTER_PORT });
    }

    if (req.method === 'POST' && url.pathname === '/print') {
      const body = await readJson(req);
      if (!body.text) return send(res, 400, { ok: false, error: 'field "text" wajib' });
      const ip = (body.ip || '').trim() || cachedPrinterIp || (await discoverPrinter());
      if (!ip) return send(res, 200, { ok: false, error: 'printer tidak ditemukan. Isi IP printer di aplikasi.' });
      const buf = textToEscPos(body.text, Number(body.width) || 58);
      await sendToPrinter(ip, buf);
      cachedPrinterIp = ip;
      log(`struk terkirim ke ${ip} (${buf.length} byte)`);
      return send(res, 200, { ok: true, printerIp: ip, bytes: buf.length });
    }

    send(res, 404, { ok: false, error: 'endpoint tidak dikenal' });
  } catch (err) {
    log('error:', err.message);
    send(res, 200, { ok: false, error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`MoodA Bridge v${VERSION} siap di http://127.0.0.1:${PORT}`);
  log(`subnet yang dipindai: ${(SUBNET ? [SUBNET] : localSubnets()).join(', ') || '(tidak ada jaringan aktif)'}`);
  log('biarkan jendela ini terbuka selama kasir dipakai.');
});
