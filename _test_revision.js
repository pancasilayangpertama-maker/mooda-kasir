// Uji revisi: format harga bertitik, ekspor PDF, kunci PIN, dan audit keamanan.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = process.env.MOODA_URL || ('file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/'));
const PORT = 9342;
const PROFILE = path.join(process.env.TEMP, 'opencode', 'cdp-profile-rev');

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
    this.ws = ws; this.id = 0; this.pending = new Map(); this.requests = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Network.requestWillBeSent') {
        this.requests.push(m.params.request.url);
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
    await cdp.send('Network.enable');

    await waitFor(async () => cdp.eval('return !!document.querySelector("#menu-grid .menu-card")'), 15000);

    // ---------- 1. Karakter keranjang tidak rusak ----------
    await cdp.eval(`
      const card = [...document.querySelectorAll('#menu-grid .menu-card')][2];
      card.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 250));
    const cartChars = await cdp.eval(`
      const minus = document.querySelector('#cart-list .qty button');
      const qtyVal = document.querySelector('#cart-list .qty-value');
      const txt = document.body.innerText;
      return {
        minus: minus ? minus.textContent : '',
        minusCode: minus ? minus.textContent.codePointAt(0) : 0,
        qty: qtyVal ? qtyVal.textContent : '',
        hasMojibake: new RegExp('[\\u00c2\\u00c3\\u00e2\\u20ac]').test(txt)
      };
    `);
    log(cartChars.minusCode === 0x2212, 'Tombol minus pakai U+2212 (bukan mojibake)',
      'U+' + cartChars.minusCode.toString(16).toUpperCase());
    log(!cartChars.hasMojibake, 'Tidak ada mojibake di halaman', String(cartChars.hasMojibake));

    // ---------- 2. Format harga bertitik ----------
    await cdp.eval(`document.querySelector('.tab[data-view="harga"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));
    const priceInit = await cdp.eval(`
      const input = document.getElementById('price-takoyaki');
      return { value: input.value, type: input.type, inputMode: input.inputMode };
    `);
    log(priceInit.value === '15.000' && priceInit.type === 'text',
      'Harga tampil bertitik (15.000)', JSON.stringify(priceInit));

    await cdp.eval(`
      const input = document.getElementById('price-takoyaki');
      input.value = '100000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    const afterType = await cdp.eval(`return document.getElementById('price-takoyaki').value;`);
    log(afterType === '100.000', 'Ketik 100000 otomatis jadi 100.000', afterType);

    await cdp.eval(`
      const input = document.getElementById('price-takoyaki');
      input.value = '10.000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btn-save-prices').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const saved = await cdp.eval(`
      const d = JSON.parse(localStorage.getItem('mooda.v1'));
      return { price: d.prices['takoyaki'], note: document.getElementById('save-note').textContent };
    `);
    log(saved.price === 10000, 'Harga bertitik tersimpan sebagai angka 10000', JSON.stringify(saved));

    // ---------- 3. Ekspor PDF ----------
    await cdp.eval(`document.querySelector('.tab[data-view="kasir"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 200));
    await cdp.eval(`
      const card = document.querySelector('#menu-grid .menu-card[data-id="takoyaki"]');
      card.click();
      document.getElementById('btn-checkout').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 350));
    await cdp.eval(`
      const m = [...document.querySelectorAll('[data-cash]')].find(b => b.dataset.cash === 'exact');
      if (m) m.click();
      document.getElementById('btn-pay-confirm').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 450));

    await cdp.eval(`document.querySelector('.tab[data-view="rekap"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));

    const pdf = await cdp.eval(`
      let printed = false;
      const orig = window.print;
      window.print = () => { printed = true; };
      document.getElementById('btn-export-pdf').click();
      const r = document.querySelector('#print-area .report');
      const out = {
        printed,
        exists: !!r,
        brand: r ? r.querySelector('.rpt-brand').textContent : '',
        rows: r ? r.querySelectorAll('.rpt-table tbody tr').length : 0,
        total: r ? (r.querySelector('.rpt-table tfoot .money') || {}).textContent : '',
        stats: r ? r.querySelectorAll('.rpt-stat').length : 0,
        bodyClass: document.body.classList.contains('printing-report')
      };
      window.print = orig;
      return out;
    `);
    log(pdf.printed && pdf.exists && pdf.rows >= 1 && pdf.stats === 4,
      'Ekspor PDF membuat laporan & memanggil print', JSON.stringify(pdf));
    log(/Rp/.test(pdf.total || ''), 'Laporan punya baris TOTAL', pdf.total);
    log(pdf.bodyClass, 'Mode cetak laporan aktif', String(pdf.bodyClass));

    // ---------- 4. Kunci PIN ----------
    const pinFlow = await cdp.eval(`
      // buat PIN
      localStorage.removeItem('mooda.pin.v1');
      const rec = localStorage.getItem('mooda.pin.v1');
      return { before: rec };
    `);
    log(pinFlow.before === null, 'Belum ada PIN tersimpan', String(pinFlow.before));

    await cdp.eval(`
      document.getElementById('lock-screen').hidden = false;
      document.getElementById('lock-setup').hidden = false;
      document.getElementById('lock-entry').hidden = true;
      document.getElementById('pin-new').value = '1234';
      document.getElementById('pin-confirm').value = '1234';
      document.getElementById('btn-pin-create').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 500));

    const pinSaved = await cdp.eval(`
      const raw = localStorage.getItem('mooda.pin.v1');
      const rec = raw ? JSON.parse(raw) : null;
      return {
        stored: rec,
        hasPlain: raw ? raw.includes('1234') : false,
        hidden: document.getElementById('lock-screen').hidden
      };
    `);
    log(!!pinSaved.stored && !!pinSaved.stored.hash && !!pinSaved.stored.salt,
      'PIN disimpan sebagai hash + salt', JSON.stringify({ salt: !!pinSaved.stored?.salt, hashLen: pinSaved.stored?.hash?.length }));
    log(!pinSaved.hasPlain, 'PIN asli tidak tersimpan di localStorage', 'mengandung 1234: ' + pinSaved.hasPlain);
    log(pinSaved.hidden, 'Layar kunci tertutup setelah PIN dibuat', String(pinSaved.hidden));

    // verifikasi PIN salah & benar
    const wrong = await cdp.eval(`
      document.getElementById('lock-screen').hidden = false;
      document.getElementById('lock-setup').hidden = true;
      document.getElementById('lock-entry').hidden = false;
      document.getElementById('pin-input').value = '9999';
      document.getElementById('btn-pin-unlock').click();
      return new Promise(r => setTimeout(() => r({
        err: document.getElementById('lock-error').textContent,
        hidden: document.getElementById('lock-screen').hidden
      }), 700));
    `);
    log(/salah/i.test(wrong.err) && !wrong.hidden, 'PIN salah ditolak', JSON.stringify(wrong));

    const right = await cdp.eval(`
      document.getElementById('pin-input').value = '1234';
      document.getElementById('btn-pin-unlock').click();
      return new Promise(r => setTimeout(() => r({
        hidden: document.getElementById('lock-screen').hidden,
        err: document.getElementById('lock-error').textContent
      }), 800));
    `);
    log(right.hidden, 'PIN benar membuka aplikasi', JSON.stringify(right));

    // ---------- 5. Audit keamanan: tidak ada permintaan ke luar ----------
    const external = cdp.requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:') && !u.includes('127.0.0.1') && !u.includes('localhost'));
    log(external.length === 0, 'Tidak ada permintaan jaringan eksternal', external.slice(0, 3).join(' | ') || '-');

    // ---------- 6. Tidak ada kredensial di DOM/source ----------
    // Catatan: pola "AIza..." bisa muncul secara kebetulan di dalam data URI base64
    // (font/ikon ikut ter-inline). Karena itu data URI dibuang dulu sebelum diaudit.
    const cred = await cdp.eval(`
      const html = document.documentElement.outerHTML;
      const stripped = html.replace(/data:[a-z\\/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'DATAURI');
      const pat = /(api[_-]?key|sk_live|sk_test|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|Bearer\\s+[A-Za-z0-9]{10,})/i;
      const m = stripped.match(pat);
      return { hit: !!m, sample: m ? m[0].slice(0, 40) : '' };
    `);
    log(!cred.hit, 'Tidak ada API key/secret di halaman', JSON.stringify(cred));

    // ---------- 7. Struk: nama pelanggan jadi penanda utama ----------
    await cdp.eval(`document.querySelector('.tab[data-view="kasir"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 250));
    await cdp.eval(`
      const card = [...document.querySelectorAll('#menu-grid .menu-card')][0];
      card.click();
      document.getElementById('btn-checkout').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 350));
    await cdp.eval(`
      document.getElementById('pay-name').value = 'dono';
      const m = [...document.querySelectorAll('[data-cash]')].find(b => b.dataset.cash === 'exact');
      if (m) m.click();
      document.getElementById('btn-pay-confirm').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 500));

    const receipt = await cdp.eval(`
      document.querySelector('.tab[data-view="printer"]').click();
      document.getElementById('btn-print-example').click();
      const r = document.querySelector('#print-area .receipt');
      const out = {
        nama: r ? ((r.querySelector('.r-nama') || {}).textContent || '') : '',
        adaNomorBesar: !!(r && r.querySelector('.r-nomor')),
        metaRows: r ? [...r.querySelectorAll('.r-meta-row')].map(x => x.textContent) : []
      };
      document.getElementById('print-area').click();
      return out;
    `);
    log((receipt.nama || '').toLowerCase() === 'dono', 'Struk: nama pelanggan tampil besar', receipt.nama);
    log(!receipt.adaNomorBesar, 'Struk: nomor besar sudah dihapus', String(receipt.adaNomorBesar));
    log(receipt.metaRows.some((t) => /No\. pesanan/i.test(t)), 'Struk: nomor pindah ke baris kecil',
      receipt.metaRows.join(' || ').slice(0, 90));

    fs.writeFileSync(path.join(process.env.TEMP, 'opencode', 'revision-test.json'), JSON.stringify(results, null, 2));
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

