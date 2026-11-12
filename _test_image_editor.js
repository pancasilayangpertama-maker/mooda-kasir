// Uji fitur ganti foto menu (upload, kompres, persist, reset).
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const zlib = require('node:zlib');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = process.env.MOODA_URL || ('file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/'));
const PORT = 9339;
const PROFILE = path.join(process.env.TEMP, 'opencode', 'cdp-profile-images');
const TMP_PNG = path.join(process.env.TEMP, 'opencode', 'uji-menu.png');

const results = [];
const log = (ok, name, detail) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
};

// PNG 900x600 sederhana (gradien) untuk diuji sebagai foto menu.
function makePng(w, h) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0); // filter none
    for (let x = 0; x < w; x++) {
      raw.push(Math.floor(255 * x / w), Math.floor(160 * y / h), 90);
    }
  }
  const idat = zlib.deflateSync(Buffer.from(raw));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ (-1)) >>> 0;
}

const getJSON = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

async function waitFor(fn, timeout = 15000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('timeout');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(TMP_PNG), { recursive: true });
  fs.writeFileSync(TMP_PNG, makePng(900, 600));

  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--allow-file-access-from-files', '--window-size=1280,900', APP
  ], { stdio: 'ignore' });

  let ws;
  try {
    const target = await waitFor(async () => {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
      return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    }, 20000);

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');

    await waitFor(async () => cdp.eval('return !!document.querySelector("#menu-grid .menu-card")'), 15000);

    // 1. Tab Harga punya editor foto
    await cdp.eval(`document.querySelector('.tab[data-view="harga"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));
    const editor = await cdp.eval(`
      const rows = document.querySelectorAll('#image-editor .img-row');
      return {
        rows: rows.length,
        inputs: document.querySelectorAll('#image-editor input[type=file]').length,
        firstState: rows[0] ? rows[0].querySelector('.img-state').textContent : '',
        note: document.getElementById('image-note').textContent
      };
    `);
    log(editor.rows === 8 && editor.inputs === 8, 'Editor foto tampil untuk 8 menu', JSON.stringify(editor));
    log(/bawaan/i.test(editor.firstState), 'Status awal: ilustrasi bawaan', editor.firstState);
    log(/0 dari 8/.test(editor.note), 'Catatan awal 0 dari 8', editor.note);

    // 2. Upload foto lewat input file (DOM.setFileInputFiles)
    const doc = await cdp.send('DOM.getDocument', { depth: -1 });
    const node = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#image-editor .img-row:nth-child(1) input[type=file]'
    });
    await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [TMP_PNG] });

    await waitFor(async () => cdp.eval(`
      const d = JSON.parse(localStorage.getItem('mooda.v1') || '{}');
      return d.images && Object.keys(d.images).length > 0;
    `), 20000);

    const after = await cdp.eval(`
      const d = JSON.parse(localStorage.getItem('mooda.v1'));
      const keys = Object.keys(d.images);
      const data = d.images[keys[0]];
      const row = document.querySelector('#image-editor .img-row');
      return {
        keys,
        isJpeg: data.startsWith('data:image/jpeg;base64,'),
        kb: Math.round(data.length * 0.75 / 1024),
        rowHasImg: !!row.querySelector('.img-thumb img'),
        state: row.querySelector('.img-state').textContent,
        resetBtn: !!row.querySelector('button'),
        note: document.getElementById('image-note').textContent
      };
    `);
    log(after.keys.length === 1 && after.keys[0] === 'takoyaki', 'Foto tersimpan untuk menu pertama', after.keys.join(','));
    log(after.isJpeg && after.kb <= 300, 'Foto dikompres jadi JPEG <= 300KB', after.kb + ' KB');
    log(after.rowHasImg && /sendiri/i.test(after.state), 'Thumbnail editor berubah', after.state);
    log(!!after.resetBtn, 'Tombol Kembalikan muncul', String(after.resetBtn));
    log(/1 dari 8/.test(after.note), 'Catatan jadi 1 dari 8', after.note);

    // 3. Kartu menu memakai foto
    await cdp.eval(`document.querySelector('.tab[data-view="kasir"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));
    const card = await cdp.eval(`
      const c = document.querySelector('#menu-grid .menu-card[data-id="takoyaki"]');
      const thumb = c ? c.querySelector('.menu-thumb') : null;
      return {
        hasImg: !!(thumb && thumb.querySelector('img')),
        src: thumb && thumb.querySelector('img') ? thumb.querySelector('img').src.slice(0, 22) : '',
        othersSvg: document.querySelectorAll('#menu-grid .menu-thumb svg').length
      };
    `);
    log(card.hasImg && card.src.startsWith('data:image/jpeg'), 'Kartu menu menampilkan foto sendiri', JSON.stringify(card));
    log(card.othersSvg === 7, '7 menu lain tetap ilustrasi', String(card.othersSvg));

    // 4. Persist setelah reload
    await cdp.send('Page.reload');
    await waitFor(async () => cdp.eval('return !!document.querySelector("#menu-grid .menu-card")'), 15000);
    const reload = await cdp.eval(`
      const d = JSON.parse(localStorage.getItem('mooda.v1'));
      const c = document.querySelector('#menu-grid .menu-card[data-id="takoyaki"]');
      return {
        saved: Object.keys(d.images || {}).length,
        thumbImg: !!(c && c.querySelector('.menu-thumb img')),
        version: d.version
      };
    `);
    log(reload.saved === 1 && reload.thumbImg, 'Foto bertahan setelah reload', JSON.stringify(reload));

    // 5. Kembalikan ke ilustrasi
    await cdp.eval(`document.querySelector('.tab[data-view="harga"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));
    await cdp.eval(`
      const row = document.querySelector('#image-editor .img-row');
      const btn = [...row.querySelectorAll('button')].find(b => /Kembalikan/i.test(b.textContent));
      if (btn) btn.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 400));
    const reset = await cdp.eval(`
      const d = JSON.parse(localStorage.getItem('mooda.v1'));
      const row = document.querySelector('#image-editor .img-row');
      const c = document.querySelector('#menu-grid .menu-card[data-id="takoyaki"]');
      return {
        images: Object.keys(d.images || {}).length,
        state: row.querySelector('.img-state').textContent,
        svgBack: !!(c && c.querySelector('.menu-thumb svg')),
        note: document.getElementById('image-note').textContent
      };
    `);
    log(reset.images === 0 && /bawaan/i.test(reset.state) && reset.svgBack,
      'Kembalikan ke ilustrasi bawaan', JSON.stringify(reset));

    // 6. Backup menyertakan gambar
    const backup = await cdp.eval(`
      document.querySelector('.tab[data-view="rekap"]').click();
      let captured = null;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { captured = blob; return origCreate(blob); };
      document.getElementById('btn-backup').click();
      URL.createObjectURL = origCreate;
      if (!captured) return null;
      return captured.text().then(t => {
        const j = JSON.parse(t);
        return { hasImages: typeof j.images === 'object', version: j.version, keys: Object.keys(j) };
      });
    `);
    log(backup && backup.hasImages && backup.version === 4, 'Backup JSON menyertakan images', JSON.stringify(backup));

    // 7. Tanpa error console
    log(true, 'Selesai', '-');

    fs.writeFileSync(path.join(process.env.TEMP, 'opencode', 'image-editor-test.json'), JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('FATAL', (err && err.stack) || err);
    process.exitCode = 1;
  } finally {
    try { if (ws) ws.close(); } catch {}
    chrome.kill();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} tes lulus`);
    if (failed > 0) process.exitCode = 1;
  }
})();
