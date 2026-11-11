// Uji khusus tampilan Printer di HP vs komputer (regresi: pesan "jalankan node" di HP).
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const PORT = 9337;
const PROFILE = path.join(process.env.TEMP, 'opencode', 'cdp-profile-printer');

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

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

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

    async function bootAs(kind, width, height) {
      await cdp.send('Emulation.setUserAgentOverride', { userAgent: UA[kind], platform: kind === 'desktop' ? 'Win32' : 'Linux armv8l' });
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 2, mobile: kind !== 'desktop'
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: kind !== 'desktop', maxTouchPoints: kind === 'desktop' ? 1 : 5 });
      await cdp.send('Page.navigate', { url: APP });
      await waitFor(async () => cdp.eval('return !!document.querySelector("#menu-grid .menu-card")'), 15000);
      await cdp.eval(`
        document.querySelector('.tab[data-view="printer"]').click();
        return true;
      `);
      await new Promise((r) => setTimeout(r, 250));
    }

    // ---------- Android ----------
    await bootAs('android', 412, 915);
    let a = await cdp.eval(`
      const bodyText = document.body.innerText;
      return {
        bridgeHidden: document.getElementById('block-bridge').hidden,
        checkBridgeHidden: document.getElementById('check-bridge').hidden,
        hasNodeText: /node bridge\\.js/.test(bodyText),
        help: document.getElementById('mobile-help').textContent,
        printBtn: !!document.getElementById('btn-print-test')
      };
    `);
    log(a.bridgeHidden && a.checkBridgeHidden, 'Android: blok bridge disembunyikan', JSON.stringify({ b: a.bridgeHidden, c: a.checkBridgeHidden }));
    log(!a.hasNodeText, 'Android: tidak ada teks "node bridge.js"', a.hasNodeText ? 'MASIH ADA' : 'bersih');
    log(/Android/.test(a.help) || /aplikasi merek printer/.test(a.help), 'Android: panduan sesuai HP', a.help.slice(0, 70));
    log(a.printBtn, 'Android: tombol cetak tetap ada');

    // pastikan useBridge dipaksa false
    const aFlag = await cdp.eval(`
      const d = JSON.parse(localStorage.getItem('mooda.v1') || '{}');
      return d.settings ? d.settings.useBridge : null;
    `);
    log(aFlag === false || aFlag === null, 'Android: useBridge dipaksa mati', String(aFlag));

    // cetak struk uji -> window.print dipanggil, bukan fetch bridge
    const aPrint = await cdp.eval(`
      let printCalled = false;
      let bridgeCalled = false;
      const origPrint = window.print;
      window.print = () => { printCalled = true; };
      const origFetch = window.fetch;
      window.fetch = (...args) => { bridgeCalled = true; return origFetch(...args); };
      document.getElementById('btn-print-test').click();
      return new Promise((res) => setTimeout(() => {
        window.print = origPrint; window.fetch = origFetch;
        res({ printCalled, bridgeCalled });
      }, 500));
    `);
    log(aPrint.printCalled && !aPrint.bridgeCalled, 'Android: cetak pakai dialog sistem, bukan bridge', JSON.stringify(aPrint));

    // ---------- iPhone ----------
    await bootAs('iphone', 390, 844);
    const i = await cdp.eval(`
      const bodyText = document.body.innerText;
      return {
        bridgeHidden: document.getElementById('block-bridge').hidden,
        hasNodeText: /node bridge\\.js/.test(bodyText),
        help: document.getElementById('mobile-help').textContent
      };
    `);
    log(i.bridgeHidden && !i.hasNodeText, 'iPhone: bridge hilang & tanpa teks node', JSON.stringify({ b: i.bridgeHidden, n: i.hasNodeText }));
    log(/AirPrint/.test(i.help), 'iPhone: panduan AirPrint', i.help.slice(0, 70));

    // ---------- Desktop ----------
    await bootAs('desktop', 1280, 900);
    const d = await cdp.eval(`
      return {
        bridgeHidden: document.getElementById('block-bridge').hidden,
        checkBridgeHidden: document.getElementById('check-bridge').hidden,
        hasNodeText: /node bridge\\.js/.test(document.body.innerText),
        paperField: !!document.getElementById('paper-width')
      };
    `);
    log(!d.bridgeHidden && !d.checkBridgeHidden, 'Komputer: bridge tetap tersedia', JSON.stringify({ b: d.bridgeHidden, c: d.checkBridgeHidden }));
    log(d.hasNodeText, 'Komputer: instruksi node tampil (memang untuk komputer)', String(d.hasNodeText));
    log(d.paperField, 'Komputer: pilihan lebar kertas ada');

    fs.writeFileSync(path.join(process.env.TEMP, 'opencode', 'printer-device-test.json'), JSON.stringify(results, null, 2));
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
