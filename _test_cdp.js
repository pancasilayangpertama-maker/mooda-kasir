// Uji MoodA v3: menu baru, metode E-Wallet, struk baru, PWA.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const PORT = 9335;
const PROFILE = path.join(process.env.TEMP, 'opencode', 'cdp-profile-v3');

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
  async click(sel) {
    await this.eval(`
      const n = document.querySelector(${JSON.stringify(sel)});
      if (!n) throw new Error('not found: ' + ${JSON.stringify(sel)});
      n.scrollIntoView({block:'center'}); n.click(); return true;
    `);
    await new Promise((r) => setTimeout(r, 140));
  }
  async setValue(sel, value) {
    await this.eval(`
      const n = document.querySelector(${JSON.stringify(sel)});
      if (!n) throw new Error('not found: ' + ${JSON.stringify(sel)});
      n.value = ${JSON.stringify(String(value))};
      n.dispatchEvent(new Event('input', {bubbles:true}));
      n.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 90));
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

    const consoleErrors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(m.params.args.map((a) => a.value || a.description).join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        consoleErrors.push('EXCEPTION ' + (m.params.exceptionDetails.text || ''));
      }
    });

    await waitFor(async () => cdp.eval('return !!document.querySelector("#menu-grid .menu-card")'), 15000);

    // 1. Menu 8 item + 2 menu baru
    const menu = await cdp.eval(`
      return [...document.querySelectorAll('#menu-grid .menu-card')]
        .map(c => c.querySelector('.menu-name').textContent);
    `);
    log(menu.length === 8, 'Menu jadi 8 item', String(menu.length));
    log(menu.includes('Nasi Ayam Selimut'), 'Nasi Ayam Selimut ada');
    log(menu.includes('Signature Chocolate MoodA'), 'Signature Chocolate MoodA ada');
    log(menu.includes('Wonton Mini') && !menu.some(m => /Dimsum/i.test(m)), 'Wonton Mini, bukan Dimsum');

    // 2. Tidak ada tulisan varian di kartu
    const varianText = await cdp.eval(`
      return [...document.querySelectorAll('#menu-grid .menu-card')]
        .map(c => c.textContent.toLowerCase())
        .filter(t => t.includes('varian') || t.includes('less ice') || t.includes('sugar'));
    `);
    log(varianText.length === 0, 'Kartu menu bebas tulisan "varian"', varianText.join(' | ') || '-');

    // 3. Hero editorial ada
    const hero = await cdp.eval(`
      const h = document.querySelector('.hero');
      return {
        exists: !!h,
        title: h ? h.querySelector('.hero-title').textContent.trim().slice(0, 20) : '',
        logo: !!h?.querySelector('.hero-logo'),
        thumbs: document.querySelectorAll('.menu-thumb svg').length
      };
    `);
    log(hero.exists && hero.logo && hero.thumbs === 8, 'Hero editorial + ilustrasi kartu', JSON.stringify(hero));

    // 4. Metode pembayaran 4 pilihan
    await cdp.eval(`
      const card = [...document.querySelectorAll('#menu-grid .menu-card')]
        .find(c => c.querySelector('.menu-name').textContent === 'Signature Chocolate MoodA');
      card.click();
      const card2 = [...document.querySelectorAll('#menu-grid .menu-card')]
        .find(c => c.querySelector('.menu-name').textContent === 'Nasi Ayam Selimut');
      card2.click();
      return true;
    `);
    const total = await cdp.eval(`return document.getElementById('cart-total').textContent;`);
    log(total === 'Rp33.000', 'Total 15.000 + 18.000', total);

    await cdp.click('#btn-checkout');
    const methods = await cdp.eval(`
      return [...document.querySelectorAll('.method')].map(b => b.dataset.method);
    `);
    log(methods.join(',') === 'Cash,QRIS,E-Wallet,Transfer', 'Ada metode E-Wallet', methods.join(','));

    // 5. Pilih E-Wallet -> field wallet muncul, field cash hilang
    await cdp.eval(`
      const b = [...document.querySelectorAll('.method')].find(x => x.dataset.method === 'E-Wallet');
      b.click(); return true;
    `);
    await new Promise((r) => setTimeout(r, 120));
    const walletUi = await cdp.eval(`
      return {
        walletShown: !document.getElementById('field-wallet').hidden,
        paidHidden: document.getElementById('field-paid').hidden,
        active: document.querySelector('.method.is-active')?.dataset.method,
        options: [...document.querySelectorAll('#pay-wallet option')].map(o => o.value)
      };
    `);
    log(walletUi.walletShown && walletUi.paidHidden && walletUi.active === 'E-Wallet',
      'E-Wallet membuka pilihan dompet', JSON.stringify(walletUi));

    // 6. Bayar via E-Wallet tanpa uang tunai
    await cdp.setValue('#pay-wallet', 'DANA');
    await cdp.setValue('#pay-name', 'Bos Dims');
    await cdp.click('#btn-pay-confirm');
    const order = await cdp.eval(`
      const d = JSON.parse(localStorage.getItem('mooda.v1'));
      const o = d.orders[0];
      return { count: d.orders.length, method: o.method, label: o.methodLabel, change: o.change, lines: o.lines.length };
    `);
    log(order.count === 1 && order.method === 'E-Wallet' && /DANA/.test(order.label) && order.change === 0,
      'Transaksi E-Wallet tersimpan', JSON.stringify(order));

    // 7. Struk baru: elemen estetik lengkap
    const receipt = await cdp.eval(`
      document.querySelector('.tab[data-view="printer"]').click();
      document.getElementById('btn-print-example').click();
      const r = document.querySelector('#print-area .receipt');
      const q = (s) => !!r?.querySelector(s);
      const out = {
        brand: r?.querySelector('.r-brand')?.textContent || '',
        nomor: r?.querySelector('.r-nomor')?.textContent || '',
        logo: q('.r-logo'),
        rules: r?.querySelectorAll('.r-rule').length || 0,
        items: r?.querySelectorAll('.r-item').length || 0,
        grand: r?.querySelector('.r-sum-row.grand')?.textContent || '',
        badge: r?.querySelector('.r-badge')?.textContent || '',
        thanks: r?.querySelector('.r-thanks')?.textContent || '',
        dots: r?.querySelectorAll('.r-dots i').length || 0,
        width: Math.round(r?.getBoundingClientRect().width || 0)
      };
      document.getElementById('print-area').click();
      return out;
    `);
    const receiptOk = receipt.logo && receipt.rules >= 3 && receipt.items === 2 &&
      /E-WALLET/.test(receipt.badge) && receipt.dots === 3 &&
      receipt.width >= 210 && receipt.width <= 225;
    log(receiptOk, 'Struk baru estetik lengkap', JSON.stringify(receipt));

    // 8. Rekap memuat metode E-Wallet
    await cdp.click('.tab[data-view="rekap"]');
    const rekap = await cdp.eval(`
      return {
        omzet: document.getElementById('stat-omzet').textContent,
        tag: document.querySelector('.trx-tag.method')?.textContent || '',
        print: !!document.querySelector('.trx-print')
      };
    `);
    log(rekap.omzet === 'Rp33.000' && /DANA/.test(rekap.tag) && rekap.print,
      'Rekap menampilkan metode E-Wallet', JSON.stringify(rekap));

    // 9. Harga menu baru bisa diubah
    await cdp.click('.tab[data-view="harga"]');
    await cdp.setValue('#price-nasi-ayam-selimut', '21000');
    await cdp.click('#btn-save-prices');
    await cdp.click('.tab[data-view="kasir"]');
    const newPrice = await cdp.eval(`
      const c = [...document.querySelectorAll('#menu-grid .menu-card')]
        .find(x => x.querySelector('.menu-name').textContent === 'Nasi Ayam Selimut');
      return c.querySelector('.menu-price').textContent;
    `);
    log(newPrice === 'Rp21.000', 'Harga menu baru bisa custom', newPrice);

    // 10. Manifest & PWA metadata
    const pwa = await cdp.eval(`
      const link = document.querySelector('link[rel="manifest"]');
      const apple = document.querySelector('link[rel="apple-touch-icon"]');
      const capable = document.querySelector('meta[name="apple-mobile-web-app-capable"]');
      return { manifest: !!link, apple: !!apple, capable: !!capable };
    `);
    log(pwa.manifest && pwa.apple && pwa.capable, 'Metadata PWA terpasang', JSON.stringify(pwa));

    // 11. Reload
    await cdp.send('Page.reload');
    await waitFor(async () => cdp.eval('return !!document.querySelector("#menu-grid .menu-card")'), 15000);
    const reload = await cdp.eval(`
      const d = JSON.parse(localStorage.getItem('mooda.v1'));
      return { orders: d.orders.length, price: d.prices['nasi-ayam-selimut'], cards: document.querySelectorAll('#menu-grid .menu-card').length };
    `);
    log(reload.orders === 1 && reload.price === 21000 && reload.cards === 8,
      'Data bertahan setelah reload', JSON.stringify(reload));

    // 12. Responsif: iPhone SE, iPhone 14, tablet
    const sizes = [
      { w: 375, h: 667, name: 'iPhone SE' },
      { w: 390, h: 844, name: 'iPhone 14' },
      { w: 768, h: 1024, name: 'iPad mini' },
      { w: 1280, h: 800, name: 'Windows' }
    ];
    for (const s of sizes) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.w < 900 });
      await new Promise((r) => setTimeout(r, 320));
      const m = await cdp.eval(`
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          heroVisible: !!document.querySelector('.hero')?.offsetParent,
          cards: document.querySelectorAll('#menu-grid .menu-card').length
        };
      `);
      log(m.overflow <= 1 && m.heroVisible && m.cards === 8, `Layout ${s.name} (${s.w}px) rapi`, JSON.stringify(m));
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    log(consoleErrors.length === 0, 'Tidak ada error console', consoleErrors.join(' | ') || '-');

    fs.writeFileSync(path.join(process.env.TEMP, 'opencode', 'browser-test-v3.json'), JSON.stringify(results, null, 2));
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
