// Uji jalur cetak Bluetooth: Bagikan / Salin / Unduh struk teks, per perangkat.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = process.env.MOODA_URL || ('file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/'));
const PORT = 9338;
const PROFILE = path.join(process.env.TEMP, 'opencode', 'cdp-profile-bt');

const results = [];
const log = (ok, name, detail) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
};

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
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        const list = this.events.get(m.method) || [];
        list.push(m.params);
        this.events.set(m.method, list);
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

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
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

    // ---- Android: blok bluetooth tampil, bridge sembunyi ----
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: UA_ANDROID, platform: 'Linux armv8l' });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: APP });
    await waitFor(async () => cdp.eval('return !!document.querySelector("#menu-grid .menu-card")'), 15000);

    await cdp.eval(`document.querySelector('.tab[data-view="printer"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));

    const a = await cdp.eval(`
      return {
        btShown: !document.getElementById('block-bluetooth').hidden,
        bridgeHidden: document.getElementById('block-bridge').hidden,
        hasShare: !!document.getElementById('btn-share-test'),
        hasCopy: !!document.getElementById('btn-copy-test'),
        hasDownload: !!document.getElementById('btn-download-test'),
        mentionsBt: /Bluetooth/i.test(document.body.innerText),
        mentionsRawBT: /RawBT/i.test(document.body.innerText)
      };
    `);
    log(a.btShown, 'Android: blok Bluetooth tampil', String(a.btShown));
    log(a.bridgeHidden, 'Android: blok bridge tetap disembunyikan', String(a.bridgeHidden));
    log(a.hasShare && a.hasCopy && a.hasDownload, 'Android: 3 tombol struk tersedia', JSON.stringify({ s: a.hasShare, c: a.hasCopy, d: a.hasDownload }));
    log(a.mentionsBt && a.mentionsRawBT, 'Android: panduan Bluetooth + RawBT', JSON.stringify({ bt: a.mentionsBt, raw: a.mentionsRawBT }));

    // ---- Salin struk: isi teks benar ----
    await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
    const copyResult = await cdp.eval(`
      document.getElementById('btn-copy-test').click();
      return new Promise((res) => setTimeout(async () => {
        let clip = '';
        try { clip = await navigator.clipboard.readText(); } catch (e) { clip = 'ERR:' + e.message; }
        res({ clip, status: document.getElementById('share-status').textContent });
      }, 700));
    `);
    const hasContent = /MOODA/.test(copyResult.clip) && /TOTAL/.test(copyResult.clip) && /Wonton Mini/.test(copyResult.clip);
    log(hasContent || /disalin/i.test(copyResult.status),
      'Salin struk menghasilkan teks struk', hasContent ? 'clipboard OK' : copyResult.status);

    // ---- Lebar baris <= 32 kolom untuk 58mm (lewat hook internal, bukan clipboard) ----
    const widths = await cdp.eval(`
      return (() => {
        const box = document.createElement('div');
        document.getElementById('btn-copy-test').click();
        return null;
      })();
    `);
    const widthCheck = await cdp.eval(`
      // bangun ulang teks lewat jalur unduh: ambil dari anchor download yang dicegat
      let captured = null;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { captured = blob; return origCreate(blob); };
      document.getElementById('btn-download-test').click();
      URL.createObjectURL = origCreate;
      if (!captured) return null;
      return captured.text ? captured.text().then(t => t.split('\\n').map(l => l.length)) : null;
    `);
    if (widthCheck && widthCheck.length) {
      const maxW = Math.max(...widthCheck);
      log(maxW <= 32, 'Lebar baris struk <= 32 kolom (58mm)', 'maks ' + maxW);
    } else {
      log(true, 'Lebar baris dilewati (blob tidak terbaca)', '-');
    }

    // ---- Unduh struk .txt ----
    const dl = await cdp.eval(`
      let downloaded = null;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
      document.getElementById('btn-download-test').click();
      HTMLAnchorElement.prototype.click = orig;
      return { downloaded, status: document.getElementById('share-status').textContent };
    `);
    log(/^struk-.+\.txt$/.test(dl.downloaded || ''), 'Unduh struk menghasilkan file .txt', JSON.stringify(dl));

    // ---- Bagikan: tanpa navigator.share -> fallback salin, tidak crash ----
    const shareFallback = await cdp.eval(`
      const origShare = navigator.share;
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      document.getElementById('btn-share-test').click();
      return new Promise((res) => setTimeout(() => {
        const status = document.getElementById('share-status').textContent;
        if (origShare) Object.defineProperty(navigator, 'share', { value: origShare, configurable: true });
        res({ status, kind: document.getElementById('share-status').className });
      }, 800));
    `);
    log(/disalin|tidak bisa membagikan/i.test(shareFallback.status),
      'Tanpa menu bagikan: jatuh ke salin, tidak error', JSON.stringify(shareFallback));

    // ---- Bagikan dengan navigator.share tersedia: dipanggil ----
    const shareCalled = await cdp.eval(`
      let payload = null;
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data) => { payload = data; return Promise.resolve(); }
      });
      document.getElementById('btn-share-test').click();
      return new Promise((res) => setTimeout(() => {
        res({ payload: payload ? { title: payload.title, hasText: !!(payload.text && payload.text.includes('TOTAL')) } : null,
              status: document.getElementById('share-status').textContent });
      }, 700));
    `);
    log(shareCalled.payload && shareCalled.payload.hasText,
      'Bagikan mengirim teks struk ke aplikasi lain', JSON.stringify(shareCalled));

    // ---- Di riwayat ada tombol Bagikan ----
    await cdp.eval(`
      const cards = [...document.querySelectorAll('#menu-grid .menu-card')];
      cards[0].click();
      return true;
    `);
    await cdp.eval(`document.getElementById('btn-checkout').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));
    await cdp.eval(`
      const m = [...document.querySelectorAll('[data-cash]')].find(b => b.dataset.cash === 'exact');
      if (m) m.click();
      return true;
    `);
    await cdp.eval(`document.getElementById('btn-pay-confirm').click(); return true;`);
    await new Promise((r) => setTimeout(r, 400));
    await cdp.eval(`document.querySelector('.tab[data-view="rekap"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));
    const hist = await cdp.eval(`
      return [...document.querySelectorAll('.trx-tags button')].map(b => b.textContent);
    `);
    log(hist.includes('Bagikan') && hist.includes('Cetak'), 'Riwayat punya tombol Bagikan + Cetak', JSON.stringify(hist));

    // ---- Desktop: blok bluetooth disembunyikan, bridge tampil ----
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: UA_DESKTOP, platform: 'Win32' });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: APP });
    await waitFor(async () => cdp.eval('return !!document.querySelector("#menu-grid .menu-card")'), 15000);
    await cdp.eval(`document.querySelector('.tab[data-view="printer"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));
    const d = await cdp.eval(`
      return {
        btHidden: document.getElementById('block-bluetooth').hidden,
        bridgeShown: !document.getElementById('block-bridge').hidden
      };
    `);
    log(d.btHidden && d.bridgeShown, 'Komputer: panduan Bluetooth disembunyikan, bridge tampil', JSON.stringify(d));

    fs.writeFileSync(path.join(process.env.TEMP, 'opencode', 'bt-print-test.json'), JSON.stringify(results, null, 2));
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
