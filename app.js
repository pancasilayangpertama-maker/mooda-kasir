/* MoodA - Kasir kafe. HTML murni + localStorage, siap PWA/APK. */
(() => {
  'use strict';

  const STORE_KEY = 'mooda.v1';

  // ---------- Menu ----------
  // `art` hanya menentukan gambar/ilustrasi kartu, bukan tulisan "varian".
  const MENU = [
    { id: 'takoyaki',       name: 'Takoyaki',              type: 'makanan', price: 15000, art: 'takoyaki' },
    { id: 'wonton-mini',    name: 'Wonton Mini',           type: 'makanan', price: 15000, art: 'wonton' },
    { id: 'nasi-ayam-selimut', name: 'Nasi Ayam Selimut',  type: 'makanan', price: 18000, art: 'nasi' },
    { id: 'esteh',          name: 'Es Teh',                type: 'minuman', price: 5000,  art: 'tea' },
    { id: 'thai-tea',       name: 'Thai Tea',              type: 'minuman', price: 10000, art: 'tea' },
    { id: 'green-tea',      name: 'Green Tea',             type: 'minuman', price: 10000, art: 'tea' },
    { id: 'green-thai-tea', name: 'Green Thai Tea',        type: 'minuman', price: 12000, art: 'tea' },
    { id: 'signature-chocolate', name: 'Signature Chocolate MoodA', type: 'minuman', price: 15000, art: 'choco' }
  ];

  const ICE_OPTIONS = [
    { id: 'normal', label: 'Es normal' },
    { id: 'less',   label: 'Less ice' }
  ];
  const SUGAR_OPTIONS = [
    { id: 'normal', label: 'Gula normal' },
    { id: 'less',   label: 'Less sugar' },
    { id: 'none',   label: 'No sugar' }
  ];

  const PAY_METHODS = ['Cash', 'QRIS', 'E-Wallet', 'Transfer'];

  const DEFAULT_SETTINGS = {
    receiptName: 'MoodA',
    receiptTagline: 'Es Teh - Milk Tea - Cemilan',
    receiptFooter: 'Terima kasih sudah mampir!',
    autoPrint: false,
    useBridge: false,
    bridgeUrl: 'http://127.0.0.1:9110',
    printerIp: '',
    btAddress: '',
    btName: '',
    paperWidth: '58'
  };

  // ---------- State ----------
  let state = load();
  let cart = [];
  let activeCat = 'all';
  let activePeriod = 'hari';
  let periodAnchor = new Date();
  let payMethod = 'Cash';
  let lastOrder = null;

  // ---------- Util ----------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const rupiah = (n) => 'Rp' + Math.round(n).toLocaleString('id-ID');
  const pad = (n) => String(n).padStart(2, '0');

  const localDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const startOfWeek = (d) => {
    const x = startOfDay(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  const startOfMonth = (d) => { const x = startOfDay(d); x.setDate(1); return x; };

  // ---------- Penyimpanan ----------
  function defaults() {
    const prices = {};
    MENU.forEach(m => { prices[m.id] = m.price; });
    return { version: 4, prices, orders: [], images: {}, settings: { ...DEFAULT_SETTINGS } };
  }

  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      const data = JSON.parse(raw);
      return {
        version: 4,
        prices: Object.assign(base.prices, data.prices || {}),
        orders: Array.isArray(data.orders) ? data.orders : [],
        images: (data.images && typeof data.images === 'object') ? data.images : {},
        settings: Object.assign({ ...DEFAULT_SETTINGS }, data.settings || {})
      };
    } catch (err) {
      console.warn('Data rusak, mulai baru.', err);
      return base;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      toast('Gagal menyimpan: penyimpanan penuh');
      console.error(err);
      return false;
    }
  }

  const priceOf = (id) => Number(state.prices[id] - 0);

  // ---------- Deteksi perangkat ----------
  // Bridge ESC/POS hanya masuk akal di komputer yang menjalankan bridge.js.
  const isMobile = (() => {
    const ua = navigator.userAgent || '';
    const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua) || touchMac;
  })();

  function deviceKind() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPod/.test(ua)) return 'iphone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }

  function applyDeviceUi() {
    const kind = deviceKind();
    const bridgeBlock = $('#block-bridge');
    const checkBridge = $('#check-bridge');

    if (isMobile) {
      // Sembunyikan jalur bridge sepenuhnya di HP; jangan pernah menyuruh buka komputer.
      if (bridgeBlock) bridgeBlock.hidden = true;
      if (checkBridge) checkBridge.hidden = true;
      state.settings.useBridge = false;

      const help = $('#mobile-help');
      if (help) {
        help.textContent = kind === 'iphone' || kind === 'ipad'
          ? 'iPhone/iPad mencetak lewat AirPrint. Printer thermal harus mendukung AirPrint, atau pakai aplikasi merek printer yang menyediakan tombol cetak.'
          : 'Android mencetak lewat layanan cetak bawaan. Untuk printer thermal biasanya perlu aplikasi merek printer (Xprinter / iDPRT) atau RawBT yang menerima perintah cetak.';
      }
    } else {
      if (bridgeBlock) bridgeBlock.hidden = false;
      if (checkBridge) checkBridge.hidden = false;
    }

    const btBlock = $('#block-bluetooth');
    if (btBlock) btBlock.hidden = !isMobile;
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-shown'), 2600);
  }

  // ---------- Navigasi ----------
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
    const view = $('#view-' + name);
    if (view) view.classList.add('is-active');
    document.querySelectorAll('.tab').forEach(t => {
      const on = t.dataset.view === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
    if (name === 'rekap') renderRekap();
    if (name === 'harga') { renderPriceEditor(); renderImageEditor(); }
    if (name === 'printer') renderPrinterSettings();
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });

  // ---------- Ilustrasi menu (SVG inline, tanpa file gambar) ----------
  function artFor(kind, itemId) {
    const wrap = el('div', 'menu-thumb');
    const custom = itemId ? state.images[itemId] : null;

    if (custom) {
      const img = document.createElement('img');
      img.src = custom;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      wrap.append(img);
      return wrap;
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'width:68%;height:68%;';
    const shapes = ART[kind] || ART.tea;
    svg.innerHTML = shapes;
    wrap.append(svg);
    return wrap;
  }

  // ---------- Gambar menu (bisa diganti sendiri) ----------
  const IMG_MAX_SIDE = 640;      // px, sisi terpanjang
  const IMG_QUALITY = 0.72;      // JPEG
  const IMG_MAX_BYTES = 260 * 1024; // batas per gambar setelah kompresi

  // Kompres di kanvas supaya localStorage tidak cepat penuh.
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('gagal membaca file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('file bukan gambar yang didukung'));
        img.onload = () => {
          const scale = Math.min(1, IMG_MAX_SIDE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFF7EA';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          let data = canvas.toDataURL('image/jpeg', IMG_QUALITY);
          // turunkan kualitas bertahap kalau masih terlalu besar
          let q = IMG_QUALITY;
          while (data.length * 0.75 > IMG_MAX_BYTES && q > 0.35) {
            q -= 0.1;
            data = canvas.toDataURL('image/jpeg', q);
          }
          resolve(data);
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function setMenuImage(itemId, dataUrl) {
    if (dataUrl) state.images[itemId] = dataUrl;
    else delete state.images[itemId];
    if (!save()) {
      if (dataUrl) delete state.images[itemId];
      return false;
    }
    renderMenu();
    renderCart();
    if ($('#view-harga').classList.contains('is-active')) renderImageEditor();
    return true;
  }

  function renderImageEditor() {
    const box = $('#image-editor');
    if (!box) return;
    box.textContent = '';

    MENU.forEach(item => {
      const custom = state.images[item.id];
      const row = el('div', 'img-row');

      const thumb = el('div', 'img-thumb');
      if (custom) {
        const img = document.createElement('img');
        img.src = custom;
        img.alt = '';
        thumb.append(img);
      } else {
        const fallback = artFor(item.art, null);
        fallback.style.width = '100%';
        fallback.style.height = '100%';
        thumb.append(fallback);
      }
      row.append(thumb);

      const info = el('div', 'img-info');
      info.append(el('div', 'img-name', item.name));
      info.append(el('div', 'img-state', custom ? 'Gambar sendiri' : 'Ilustrasi bawaan'));
      row.append(info);

      const actions = el('div', 'img-actions');

      const label = el('label', 'btn-ghost btn-sm file-label');
      label.append(document.createTextNode(custom ? 'Ganti' : 'Pilih foto'));
      const fileInput = el('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.hidden = true;
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          const data = await compressImage(file);
          if (setMenuImage(item.id, data)) toast(`${item.name}: gambar diganti`);
          else toast('Gagal menyimpan gambar (penyimpanan penuh)');
        } catch (err) {
          toast('Gagal memproses gambar');
          console.error(err);
        }
        fileInput.value = '';
      });
      label.append(fileInput);
      actions.append(label);

      if (custom) {
        const reset = el('button', 'btn-ghost btn-sm', 'Kembalikan');
        reset.type = 'button';
        reset.addEventListener('click', () => {
          if (setMenuImage(item.id, null)) toast(`${item.name}: kembali ke ilustrasi`);
        });
        actions.append(reset);
      }

      row.append(actions);
      box.append(row);
    });

    const used = Object.keys(state.images).length;
    const note = $('#image-note');
    if (note) note.textContent = `${used} dari ${MENU.length} menu memakai foto sendiri.`;
  }

  const ART = {
    tea: `<g fill="none" stroke="#0F5C55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M30 30h40l-4 48a6 6 0 0 1-6 5H40a6 6 0 0 1-6-5z" fill="#CFEFE6"/>
      <path d="M34 44h32" opacity=".5"/>
      <path d="M50 22v8" /><circle cx="50" cy="18" r="4" fill="#E39B33" stroke="none"/>
      <path d="M40 58c4 4 16 4 20 0" opacity=".6"/>
    </g>`,
    choco: `<g fill="none" stroke="#0F5C55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M30 30h40l-4 48a6 6 0 0 1-6 5H40a6 6 0 0 1-6-5z" fill="#E7C9A9"/>
      <path d="M32 42h36l-1.5 18a5 5 0 0 1-5 4.5H38.5a5 5 0 0 1-5-4.5z" fill="#7A4A22" stroke="none"/>
      <path d="M50 18v10"/><circle cx="50" cy="15" r="3.5" fill="#FF8A3D" stroke="none"/>
    </g>`,
    takoyaki: `<g fill="none" stroke="#0F5C55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="55" r="26" fill="#FFD65C"/>
      <path d="M50 29v-9"/><circle cx="50" cy="45" r="3" fill="#0F5C55" stroke="none"/>
      <circle cx="38" cy="58" r="3" fill="#0F5C55" stroke="none"/>
      <circle cx="62" cy="58" r="3" fill="#0F5C55" stroke="none"/>
      <path d="M38 68c6 4 18 4 24 0" opacity=".55"/>
    </g>`,
    wonton: `<g fill="none" stroke="#0F5C55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M26 62l24-30 24 30z" fill="#FFD65C"/>
      <path d="M38 62l12-16 12 16" opacity=".6"/>
      <circle cx="50" cy="58" r="2.5" fill="#0F5C55" stroke="none"/>
    </g>`,
    nasi: `<g fill="none" stroke="#0F5C55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M24 56a26 16 0 0 1 52 0z" fill="#FFF7EA"/>
      <path d="M22 56h56a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6z" fill="#CFEFE6"/>
      <path d="M40 46c4-5 16-5 20 0" opacity=".5"/>
      <circle cx="50" cy="38" r="4" fill="#E8712B" stroke="none"/>
    </g>`
  };

  // ---------- Menu ----------
  function renderMenu() {
    const grid = $('#menu-grid');
    grid.textContent = '';
    MENU.filter(m => activeCat === 'all' || m.type === activeCat).forEach(item => {
      const card = el('button', 'menu-card');
      card.type = 'button';
      card.dataset.id = item.id;
      card.setAttribute('aria-label', `Tambah ${item.name}, ${rupiah(priceOf(item.id))}`);

      const thumb = artFor(item.art, item.id);
      thumb.append(el('span', 'menu-thumb-type', item.type === 'minuman' ? 'Minuman' : 'Makanan'));
      card.append(thumb);

      const body = el('div', 'menu-body');
      body.append(el('div', 'menu-name', item.name));
      body.append(el('div', 'menu-price money', rupiah(priceOf(item.id))));
      card.append(body);

      card.addEventListener('click', () => {
        addToCart(item);
        card.classList.add('is-added');
        setTimeout(() => card.classList.remove('is-added'), 220);
      });
      grid.append(card);
    });
  }

  document.querySelectorAll('[data-cat]').forEach(chip => {
    chip.addEventListener('click', () => {
      activeCat = chip.dataset.cat;
      document.querySelectorAll('[data-cat]').forEach(c => {
        const on = c === chip;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', String(on));
      });
      renderMenu();
    });
  });

  // ---------- Keranjang ----------
  function variantLabel(line) {
    if (!line.ice) return '';
    const ice = ICE_OPTIONS.find(o => o.id === line.ice)?.label || '';
    const sugar = SUGAR_OPTIONS.find(o => o.id === line.sugar)?.label || '';
    return `${ice} * ${sugar}`;
  }

  function addToCart(item) {
    const isDrink = item.type === 'minuman';
    const key = isDrink ? `${item.id}|normal|normal` : `${item.id}||`;
    const found = cart.find(l => l.key === key);
    if (found) found.qty += 1;
    else cart.push({ key, itemId: item.id, ice: isDrink ? 'normal' : null, sugar: isDrink ? 'normal' : null, qty: 1 });
    renderCart();
  }

  function changeVariant(line, field, value) {
    const qty = line.qty;
    cart = cart.filter(l => l !== line);
    if (field === 'ice') line.ice = value; else line.sugar = value;
    line.key = `${line.itemId}|${line.ice || ''}|${line.sugar || ''}`;
    const existing = cart.find(l => l.key === line.key);
    if (existing) existing.qty += qty;
    else cart.push({ ...line, qty });
    renderCart();
  }

  const cartTotal = () => cart.reduce((s, l) => s + priceOf(l.itemId) * l.qty, 0);
  const cartCount = () => cart.reduce((n, l) => n + l.qty, 0);

  function renderCart() {
    const list = $('#cart-list');
    list.textContent = '';

    if (cart.length === 0) {
      list.append(el('div', 'cart-empty', 'Belum ada pesanan.\nKlik menu untuk menambahkan.'));
    }

    cart.forEach(line => {
      const item = MENU.find(m => m.id === line.itemId);
      if (!item) return;

      const row = el('div', 'cart-item');
      row.append(el('div', 'cart-item-name', item.name));
      row.append(el('div', 'cart-item-price money', rupiah(priceOf(item.id) * line.qty)));

      if (item.type === 'minuman') {
        const wrap = el('div', 'variant-picker');

        const iceSel = el('select');
        iceSel.setAttribute('aria-label', `Es untuk ${item.name}`);
        ICE_OPTIONS.forEach(o => {
          const opt = el('option', null, o.label);
          opt.value = o.id;
          if (o.id === line.ice) opt.selected = true;
          iceSel.append(opt);
        });
        iceSel.addEventListener('change', () => changeVariant(line, 'ice', iceSel.value));

        const sugarSel = el('select');
        sugarSel.setAttribute('aria-label', `Gula untuk ${item.name}`);
        SUGAR_OPTIONS.forEach(o => {
          const opt = el('option', null, o.label);
          opt.value = o.id;
          if (o.id === line.sugar) opt.selected = true;
          sugarSel.append(opt);
        });
        sugarSel.addEventListener('change', () => changeVariant(line, 'sugar', sugarSel.value));

        wrap.append(iceSel, sugarSel);
        row.append(wrap);
      }

      const qty = el('div', 'qty');
      const minus = el('button', null, '\u2212');
      minus.type = 'button';
      minus.setAttribute('aria-label', `Kurangi ${item.name}`);
      minus.dataset.action = 'minus';
      minus.addEventListener('click', () => {
        line.qty -= 1;
        if (line.qty <= 0) cart = cart.filter(l => l !== line);
        renderCart();
      });

      const qtyValue = el('span', 'qty-value', String(line.qty));
      qtyValue.setAttribute('aria-label', `Jumlah ${item.name}: ${line.qty}`);

      const plus = el('button', null, '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', `Tambah ${item.name}`);
      plus.dataset.action = 'plus';
      plus.addEventListener('click', () => { line.qty += 1; renderCart(); });

      qty.append(minus, qtyValue, plus);
      row.append(qty);
      list.append(row);
    });

    const n = cartCount();
    $('#cart-total').textContent = rupiah(cartTotal());
    $('#cart-count').textContent = n === 0 ? 'Kosong' : `${n} item`;
    $('#btn-checkout').disabled = cart.length === 0;
    $('#view-kasir').classList.toggle('has-cart', cart.length > 0);
    const pane = document.querySelector('.cart-pane');
    if (pane) pane.classList.toggle('is-empty', cart.length === 0);
  }

  $('#btn-clear-cart').addEventListener('click', () => {
    if (cart.length === 0) return;
    if (!confirm('Kosongkan semua pesanan di keranjang?')) return;
    cart = [];
    renderCart();
  });

  // ---------- Modal bayar ----------
  let payTotalValue = 0;

  function setPayMethod(method) {
    payMethod = method;
    document.querySelectorAll('.method').forEach(b => {
      const on = b.dataset.method === method;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
    $('#field-wallet').hidden = method !== 'E-Wallet';
    $('#field-paid').hidden = method !== 'Cash';
    $('#quick-cash').hidden = method !== 'Cash';
    updateChange();
  }

  function openPay() {
    if (cart.length === 0) return;
    payTotalValue = cartTotal();
    $('#pay-total').textContent = rupiah(payTotalValue);
    $('#pay-received').value = '';
    $('#pay-name').value = '';
    $('#pay-change').textContent = rupiah(0);
    $('#change-row').hidden = true;
    $('#pay-error').textContent = '';
    setPayMethod('Cash');
    $('#modal-pay').hidden = false;
    $('#pay-received').focus();
  }

  const closePay = () => { $('#modal-pay').hidden = true; };

  function updateChange() {
    if (payMethod !== 'Cash') { $('#change-row').hidden = true; return; }
    const received = Number($('#pay-received').value || 0);
    const change = received - payTotalValue;
    if (received > 0 && change >= 0) {
      $('#pay-change').textContent = rupiah(change);
      $('#change-row').hidden = false;
    } else {
      $('#change-row').hidden = true;
    }
  }

  document.querySelectorAll('.method').forEach(btn => {
    btn.addEventListener('click', () => setPayMethod(btn.dataset.method));
  });

  $('#btn-checkout').addEventListener('click', openPay);
  $('#btn-pay-cancel').addEventListener('click', closePay);
  $('#pay-received').addEventListener('input', updateChange);

  document.querySelectorAll('[data-cash]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.cash;
      $('#pay-received').value = v === 'exact' ? String(payTotalValue) : v;
      updateChange();
    });
  });

  $('#modal-pay').addEventListener('click', (e) => { if (e.target === $('#modal-pay')) closePay(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal-pay').hidden) closePay();
  });

  function payLabel(method) {
    if (method === 'E-Wallet') return 'E-Wallet * ' + ($('#pay-wallet').value || 'GoPay');
    return method;
  }

  function buildOrder() {
    const received = payMethod === 'Cash' ? Number($('#pay-received').value || 0) : payTotalValue;
    const now = new Date();
    return {
      id: 'TRX-' + now.getTime().toString(36).toUpperCase(),
      at: now.toISOString(),
      method: payMethod,
      methodLabel: payLabel(payMethod),
      received,
      change: Math.max(0, received - payTotalValue),
      customer: $('#pay-name').value.trim() || null,
      total: payTotalValue,
      printed: false,
      lines: cart.map(l => {
        const item = MENU.find(m => m.id === l.itemId);
        return {
          id: l.itemId,
          name: item ? item.name : l.itemId,
          ice: l.ice,
          sugar: l.sugar,
          variant: variantLabel(l),
          qty: l.qty,
          price: priceOf(l.itemId),
          subtotal: priceOf(l.itemId) * l.qty
        };
      })
    };
  }

  async function confirmPay() {
    const received = payMethod === 'Cash' ? Number($('#pay-received').value || 0) : payTotalValue;
    const errBox = $('#pay-error');

    if (payMethod === 'Cash' && received < payTotalValue) {
      errBox.textContent = `Uang diterima kurang ${rupiah(payTotalValue - received)}.`;
      $('#pay-received').focus();
      return;
    }

    const order = buildOrder();
    state.orders.push(order);
    if (!save()) { state.orders.pop(); return; }

    lastOrder = order;
    cart = [];
    renderCart();
    closePay();
    toast('Tersimpan * ' + rupiah(order.total));
    if ($('#view-rekap').classList.contains('is-active')) renderRekap();

    if (state.settings.autoPrint) await printOrder(order);
  }

  $('#btn-pay-confirm').addEventListener('click', confirmPay);

  // ---------- Struk ----------
  function receiptMeta(order) {
    const when = new Date(order.at);
    return {
      nomor: order.id.replace('TRX-', '#'),
      tanggal: when.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      jam: when.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    };
  }

  function renderReceiptNode(order) {
    const s = state.settings;
    const meta = receiptMeta(order);
    const box = el('div', 'receipt');

    // kop
    const head = el('div', 'r-head');
    const logo = document.createElement('img');
    logo.src = 'icons/icon-192.png';
    logo.alt = '';
    logo.className = 'r-logo';
    head.append(logo);
    head.append(el('h4', 'r-brand', (s.receiptName || 'MoodA').toUpperCase()));
    if (s.receiptTagline) head.append(el('p', 'r-tagline', s.receiptTagline));
    box.append(head);

    const rule = (mark) => {
      const r = el('div', 'r-rule');
      r.append(el('span', null, mark || '*'));
      return r;
    };
    box.append(rule('*'));

    // Nama pelanggan jadi penanda utama struk (bukan nomor pesanan).
    const nama = (order.customer || '').trim();
    if (nama) {
      box.append(el('div', 'r-nama', nama));
    } else {
      box.append(el('div', 'r-nama r-nama-kosong', 'Tanpa nama'));
    }

    // meta
    const metaBox = el('div', 'r-meta');
    const metaRow = (k, v) => {
      const row = el('div', 'r-meta-row');
      row.append(el('span', null, k));
      row.append(el('b', null, v));
      return row;
    };
    metaBox.append(metaRow(meta.tanggal, meta.jam));
    metaBox.append(metaRow('No. pesanan', meta.nomor));
    box.append(metaBox);

    box.append(rule('*'));

    // item
    const items = el('div', 'r-items');
    order.lines.forEach(l => {
      const row = el('div', 'r-item');
      const nameRow = el('div', 'r-item-name');
      nameRow.append(el('span', null, `${l.qty}x ${l.name}`));
      nameRow.append(el('span', null, rupiah(l.subtotal)));
      row.append(nameRow);
      if (l.variant) row.append(el('div', 'r-item-note', l.variant));
      items.append(row);
    });
    box.append(items);

    box.append(rule('*'));

    // ringkasan
    const sum = el('div', 'r-sum');
    const sumRow = (k, v, cls) => {
      const row = el('div', 'r-sum-row' + (cls ? ' ' + cls : ''));
      row.append(el('span', null, k));
      row.append(el('span', null, v));
      return row;
    };
    const itemCount = order.lines.reduce((n, l) => n + l.qty, 0);
    sum.append(sumRow(`${itemCount} item`, rupiah(order.total), 'muted'));
    sum.append(sumRow('TOTAL', rupiah(order.total), 'grand'));
    if (order.method === 'Cash') {
      sum.append(sumRow('Tunai', rupiah(order.received), 'muted'));
      sum.append(sumRow('Kembali', rupiah(order.change), 'muted'));
    }
    box.append(sum);

    // badge metode
    const badgeWrap = el('div', 'r-badge-wrap');
    badgeWrap.append(el('span', 'r-badge', (order.methodLabel || order.method).toUpperCase()));
    box.append(badgeWrap);

    // footer
    const foot = el('div', 'r-foot');
    foot.append(el('p', 'r-thanks', 'Terima kasih!'));
    if (s.receiptFooter) foot.append(el('p', 'r-footnote', s.receiptFooter));
    foot.append(el('p', 'r-footnote', 'Dicetak oleh MoodA'));
    box.append(foot);

    const dots = el('div', 'r-dots');
    for (let i = 0; i < 3; i++) dots.append(el('i'));
    box.append(dots);

    return box;
  }

  function receiptPlainText(order) {
    const s = state.settings;
    const meta = receiptMeta(order);
    const cols = Number(s.paperWidth) === 80 ? 44 : 30;
    const line = (ch) => ch.repeat(cols);
    const kv = (k, v) => {
      const space = Math.max(1, cols - k.length - v.length);
      return k + ' '.repeat(space) + v;
    };
    // Penjaga terakhir: apa pun yang terjadi, jangan pernah lewat lebar kertas.
    const fit = (txt) => (txt.length <= cols ? txt : txt.slice(0, cols));
    const out = [];
    out.push(fit(trunc((s.receiptName || 'MoodA').toUpperCase(), cols)));
    if (s.receiptTagline) out.push(fit(trunc(s.receiptTagline, cols)));
    out.push(line('-'));
    if ((order.customer || '').trim()) out.push(fit(trunc('Nama: ' + order.customer, cols)));
    out.push(kv(meta.tanggal, meta.jam));
    out.push(kv('No', meta.nomor));
    out.push(line('-'));
    order.lines.forEach(l => {
      const price = rupiah(l.subtotal);
      const qtyPrefix = `${l.qty}x `;
      const nameRoom = cols - qtyPrefix.length - price.length - 1;
      out.push(fit(kv(qtyPrefix + trunc(l.name, Math.max(4, nameRoom)), price)));
      if (l.variant) out.push(fit(trunc('  ' + l.variant, cols)));
    });
    out.push(line('-'));
    const itemCount = order.lines.reduce((n, l) => n + l.qty, 0);
    out.push(kv(`${itemCount} item`, rupiah(order.total)));
    out.push(kv('TOTAL', rupiah(order.total)));
    if (order.method === 'Cash') {
      out.push(kv('Tunai', rupiah(order.received)));
      out.push(kv('Kembali', rupiah(order.change)));
    }
    out.push(fit(trunc('Bayar: ' + (order.methodLabel || order.method), cols)));
    out.push(line('-'));
    out.push('Terima kasih!');
    if (s.receiptFooter) out.push(fit(trunc(s.receiptFooter, cols)));
    return out.join('\n');
  }

  function previewReceipt(order) {
    const area = $('#print-area');
    area.textContent = '';
    area.append(renderReceiptNode(order));
    area.style.cssText = 'display:block;position:fixed;inset:0;z-index:90;overflow:auto;background:rgba(8,59,54,.66);padding:18px;cursor:pointer;';
    area.setAttribute('aria-hidden', 'false');
    area.onclick = () => {
      area.style.cssText = '';
      area.textContent = '';
      area.setAttribute('aria-hidden', 'true');
    };
  }

  // ---------- Cetak langsung ke printer Bluetooth (khusus APK Android) ----------
  const nativePrinter = () =>
    (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MoodaPrinter) || null;

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  // Byte ESC/POS: baris pertama jadi judul tengah + huruf dobel, sisanya rata kiri.
  function escposPayload(order) {
    const ESC = 0x1b;
    const GS = 0x1d;
    const out = [ESC, 0x40];
    const put = (txt) => { for (const ch of txt) out.push(ch.charCodeAt(0) & 0x7f); };
    escposText(order).split('\n').forEach((raw, i) => {
      const line = raw.replace(/[^\x20-\x7E\u00A0-\u024F]/g, ' ');
      if (i === 0) {
        out.push(ESC, 0x61, 0x01, ESC, 0x45, 0x01, GS, 0x21, 0x11);
        put(line);
        out.push(0x0a, GS, 0x21, 0x00, ESC, 0x45, 0x00);
        return;
      }
      out.push(ESC, 0x61, 0x00);
      put(line);
      out.push(0x0a);
    });
    out.push(0x0a, 0x0a, 0x0a, GS, 0x56, 0x01);
    return new Uint8Array(out);
  }

  async function printBluetooth(order) {
    const plugin = nativePrinter();
    if (!plugin) return false;
    const address = state.settings.btAddress;
    if (!address) {
      toast('Pilih printer Bluetooth dulu di tab Printer');
      return false;
    }
    try {
      await plugin.print({ address, data: toBase64(escposPayload(order)) });
      toast('Struk terkirim ke printer');
      return true;
    } catch (err) {
      toast('Gagal cetak: ' + ((err && err.message) || err));
      return false;
    }
  }

  async function printOrder(order) {
    if (await printBluetooth(order)) { markPrinted(order); return; }
    if (state.settings.useBridge && !isMobile) {
      const ok = await sendToBridge(order);
      if (ok) { markPrinted(order); return; }
      toast('Cetak langsung gagal, memakai dialog cetak');
    }
    const area = $('#print-area');
    area.textContent = '';
    area.append(renderReceiptNode(order));
    window.print();
    markPrinted(order);
  }

  function markPrinted(order) {
    const found = state.orders.find(o => o.id === order.id);
    if (found) { found.printed = true; save(); }
  }

  // ---------- Bagikan / salin struk (jalur printer Bluetooth) ----------
  // Halaman web tidak bisa menembak printer Bluetooth; aplikasi printer merek
  // (Kimipos/Dooke/ALGOO/VS/RawBT) yang bisa. Jadi struk dikirim sebagai teks.
  function escposText(order) {
    const s = state.settings;
    const cols = Number(s.paperWidth) === 80 ? 44 : 30; // 58mm praktisnya ~30-32 kolom
    const line = () => '-'.repeat(cols);
    const kv = (k, v) => {
      const space = Math.max(1, cols - k.length - v.length);
      return k + ' '.repeat(space) + v;
    };
    // Nama panjang dipotong agar tidak melewati lebar kertas (thermal tidak auto-wrap rapi).
    const trunc = (txt, max) => (txt.length <= max ? txt : txt.slice(0, Math.max(1, max - 1)).trimEnd() + '\u2026');
    // Penjaga terakhir: apa pun yang terjadi, jangan pernah lewat lebar kertas.
    const fit = (txt) => (txt.length <= cols ? txt : txt.slice(0, cols));
    const meta = receiptMeta(order);
    const out = [];
    out.push(fit(trunc((s.receiptName || 'MoodA').toUpperCase(), cols)));
    if (s.receiptTagline) out.push(fit(trunc(s.receiptTagline, cols)));
    out.push(line());
    if ((order.customer || '').trim()) out.push(fit(trunc('Nama: ' + order.customer, cols)));
    out.push(kv(meta.tanggal, meta.jam));
    out.push(kv('No', meta.nomor));
    out.push(line());
    order.lines.forEach(l => {
      const price = rupiah(l.subtotal);
      const qtyPrefix = `${l.qty}x `;
      const nameRoom = cols - qtyPrefix.length - price.length - 1;
      out.push(fit(kv(qtyPrefix + trunc(l.name, Math.max(4, nameRoom)), price)));
      if (l.variant) out.push(trunc('   ' + l.variant, cols));
    });
    out.push(line());
    const itemCount = order.lines.reduce((n, l) => n + l.qty, 0);
    out.push(kv(`${itemCount} item`, rupiah(order.total)));
    out.push(kv('TOTAL', rupiah(order.total)));
    if (order.method === 'Cash') {
      out.push(kv('Tunai', rupiah(order.received)));
      out.push(kv('Kembali', rupiah(order.change)));
    }
    out.push(fit(trunc('Bayar: ' + (order.methodLabel || order.method), cols)));
    out.push(line());
    out.push('Terima kasih!');
    if (s.receiptFooter) out.push(fit(trunc(s.receiptFooter, cols)));
    return out.join('\n');
  }

  function setShareStatus(msg, tone) {
    const box = $('#share-status');
    if (!box) return;
    box.className = 'status-line' + (tone ? ' is-' + tone : '');
    box.textContent = msg;
  }

  // Bagian terakhir struk teks untuk aplikasi printer (dipakai tombol salin/uji).
  function receiptTextTail(order) {
    return escposText(order).slice(-600);
  }

  async function shareReceipt(order) {
    const text = escposText(order);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Struk ' + order.id.replace('TRX-', '#'), text });
        setShareStatus('Struk dibagikan. Pilih aplikasi printer di daftar aplikasi.', 'ok');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') { setShareStatus('Dibatalkan.', ''); return; }
      }
    }
    const ok = await copyReceipt(order, true);
    setShareStatus(ok
      ? 'Perangkat ini tidak punya menu bagikan, struk sudah disalin. Tempel di aplikasi printer.'
      : 'Tidak bisa membagikan maupun menyalin. Pakai tombol Unduh struk (.txt).', ok ? 'ok' : 'err');
  }

  async function copyReceipt(order, silent) {
    const text = escposText(order);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        if (!silent) setShareStatus('Struk disalin. Tempel di aplikasi printer.', 'ok');
        return true;
      }
    } catch (err) { /* jatuh ke cara manual */ }

    // fallback untuk file:// atau browser tanpa clipboard API
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
      document.body.append(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      if (!silent) setShareStatus(ok ? 'Struk disalin. Tempel di aplikasi printer.' : 'Gagal menyalin.', ok ? 'ok' : 'err');
      return ok;
    } catch (err) {
      if (!silent) setShareStatus('Gagal menyalin struk.', 'err');
      return false;
    }
  }

  function downloadReceipt(order) {
    const text = escposText(order);
    download(`struk-${order.id.replace('TRX-', '')}.txt`, text, 'text/plain;charset=utf-8');
    setShareStatus('File struk diunduh. Buka di aplikasi printer lewat menu impor.', 'ok');
  }

  // ---------- Bridge (ESC/POS via WiFi) ----------
  async function bridgeHealth() {
    const base = ($('#bridge-url')?.value || state.settings.bridgeUrl || '').replace(/\/$/, '');
    const res = await fetch(base + '/health', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function sendToBridge(order) {
    const base = ($('#bridge-url')?.value || state.settings.bridgeUrl || '').replace(/\/$/, '');
    try {
      const res = await fetch(base + '/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: receiptPlainText(order),
          ip: $('#printer-ip')?.value || state.settings.printerIp || '',
          width: Number(state.settings.paperWidth || 58)
        }),
        signal: AbortSignal.timeout(8000)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'gagal cetak');
      toast('Struk terkirim ke printer');
      return true;
    } catch (err) {
      console.warn('Bridge print gagal:', err);
      return false;
    }
  }

  async function scanBridge() {
    const st = $('#bridge-status');
    st.className = 'status-line';
    st.textContent = 'Menghubungi bridge...';
    try {
      const info = await bridgeHealth();
      st.className = 'status-line is-ok';
      st.textContent = info.printerIp
        ? `Bridge OK * printer terdeteksi: ${info.printerIp}`
        : 'Bridge aktif, printer belum diketahui';
      if (info.printerIp && !$('#printer-ip').value) $('#printer-ip').value = info.printerIp;
    } catch (err) {
      st.className = 'status-line is-err';
      st.textContent = isMobile
        ? 'Cetak langsung tidak tersedia di HP. Pakai dialog cetak bawaan perangkat.'
        : 'Bridge tidak terjangkau. Di komputer ini, jalankan "node bridge.js" lalu coba lagi.';
    }
  }

  async function testBridge() {
    const st = $('#bridge-status');
    st.className = 'status-line';
    st.textContent = 'Menguji koneksi printer...';
    const ip = $('#printer-ip').value.trim();
    try {
      const base = ($('#bridge-url').value.trim() || 'http://127.0.0.1:9110').replace(/\/$/, '');
      const res = await fetch(base + '/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip }),
        signal: AbortSignal.timeout(8000)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'gagal');
      st.className = 'status-line is-ok';
      if (data.printerIp) {
        $('#printer-ip').value = data.printerIp;
        st.textContent = `Terhubung ke printer ${data.printerIp} * port ${data.port || 9100}`;
      } else {
        st.textContent = 'Bridge aktif. Isi IP printer kalau pencarian otomatis tidak menemukan.';
      }
    } catch (err) {
      st.className = 'status-line is-err';
      st.textContent = 'Koneksi ke printer gagal: ' + (err.message || err);
    }
  }

  // ---------- Rekap ----------
  function periodRange(period, anchor) {
    if (period === 'hari') {
      const s = startOfDay(anchor);
      const e = new Date(s); e.setDate(e.getDate() + 1);
      return { start: s, end: e };
    }
    if (period === 'minggu') {
      const s = startOfWeek(anchor);
      const e = new Date(s); e.setDate(e.getDate() + 7);
      return { start: s, end: e };
    }
    const s = startOfMonth(anchor);
    return { start: s, end: new Date(s.getFullYear(), s.getMonth() + 1, 1) };
  }

  function periodLabelText(period, anchor) {
    const { start } = periodRange(period, anchor);
    const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    if (period === 'hari') return `${start.getDate()} ${bulan[start.getMonth()]} ${start.getFullYear()}`;
    if (period === 'minggu') {
      const end = new Date(start); end.setDate(end.getDate() + 6);
      const fmt = (d) => `${d.getDate()} ${bulan[d.getMonth()].slice(0, 3)}`;
      return `${fmt(start)} - ${fmt(end)} ${end.getFullYear()}`;
    }
    return `${bulan[start.getMonth()]} ${start.getFullYear()}`;
  }

  function ordersInRange(start, end) {
    return state.orders.filter(o => {
      const t = new Date(o.at);
      return t >= start && t < end;
    });
  }

  function renderRekap() {
    const { start, end } = periodRange(activePeriod, periodAnchor);
    const orders = ordersInRange(start, end);
    $('#period-label').textContent = periodLabelText(activePeriod, periodAnchor);

    const omzet = orders.reduce((s, o) => s + o.total, 0);
    const itemQty = orders.reduce((s, o) => s + o.lines.reduce((a, l) => a + l.qty, 0), 0);

    $('#stat-omzet').textContent = rupiah(omzet);
    $('#stat-trx').textContent = String(orders.length);
    $('#stat-item').textContent = String(itemQty);
    $('#stat-avg').textContent = rupiah(orders.length ? omzet / orders.length : 0);

    const tally = new Map();
    orders.forEach(o => o.lines.forEach(l => {
      const key = l.name + (l.variant ? ` (${l.variant})` : '');
      const cur = tally.get(key) || { name: key, qty: 0, revenue: 0 };
      cur.qty += l.qty;
      cur.revenue += l.subtotal;
      tally.set(key, cur);
    }));

    const top = [...tally.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 8);
    const topBox = $('#top-items');
    topBox.textContent = '';
    if (top.length === 0) {
      topBox.append(el('div', 'empty-state', 'Belum ada penjualan pada periode ini.'));
    } else {
      top.forEach((t, i) => {
        const row = el('div', 'top-item');
        row.append(el('div', 'top-rank', String(i + 1)));
        row.append(el('div', null, t.name));
        row.append(el('div', 'top-qty', `${t.qty} pcs`));
        row.append(el('div', 'money', rupiah(t.revenue)));
        topBox.append(row);
      });
    }

    const hist = $('#history');
    hist.textContent = '';
    const sorted = [...orders].sort((a, b) => new Date(b.at) - new Date(a.at));
    if (sorted.length === 0) {
      hist.append(el('div', 'empty-state', 'Belum ada transaksi pada periode ini.'));
    } else {
      sorted.forEach(o => {
        const card = el('div', 'trx');
        const head = el('div', 'trx-top');
        head.append(el('div', 'trx-id',
          `${o.id.replace('TRX-', '#')} * ${new Date(o.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`));
        head.append(el('div', 'trx-total money', rupiah(o.total)));
        card.append(head);

        card.append(el('div', 'trx-lines',
          o.lines.map(l => `${l.qty}x ${l.name}${l.variant ? ' * ' + l.variant : ''}`).join(' * ')));

        const tags = el('div', 'trx-tags');
        tags.append(el('span', 'trx-tag method', o.methodLabel || o.method));
        if (o.customer) tags.append(el('span', 'trx-tag', o.customer));
        if (o.method === 'Cash') tags.append(el('span', 'trx-tag', 'Kembali ' + rupiah(o.change)));

        const shareBtn = el('button', 'trx-print', 'Bagikan');
        shareBtn.type = 'button';
        shareBtn.setAttribute('aria-label', `Bagikan struk ${o.id} ke aplikasi printer`);
        shareBtn.addEventListener('click', () => shareReceipt(o));
        tags.append(shareBtn);

        const printBtn = el('button', 'trx-print', 'Cetak');
        printBtn.type = 'button';
        printBtn.setAttribute('aria-label', `Cetak struk ${o.id}`);
        printBtn.addEventListener('click', () => printOrder(o));
        tags.append(printBtn);
        card.append(tags);
        hist.append(card);
      });
    }
  }

  document.querySelectorAll('[data-period]').forEach(chip => {
    chip.addEventListener('click', () => {
      activePeriod = chip.dataset.period;
      document.querySelectorAll('[data-period]').forEach(c => c.classList.toggle('is-active', c === chip));
      renderRekap();
    });
  });

  $('#btn-prev').addEventListener('click', () => {
    const d = new Date(periodAnchor);
    if (activePeriod === 'hari') d.setDate(d.getDate() - 1);
    else if (activePeriod === 'minggu') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    periodAnchor = d;
    renderRekap();
  });

  $('#btn-next').addEventListener('click', () => {
    const d = new Date(periodAnchor);
    if (activePeriod === 'hari') d.setDate(d.getDate() + 1);
    else if (activePeriod === 'minggu') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    periodAnchor = d;
    renderRekap();
  });

  $('#btn-today').addEventListener('click', () => { periodAnchor = new Date(); renderRekap(); });

  // ---------- Harga ----------
  // Input harga memakai format ribuan bertitik (10.000 / 100.000).
  const parseRupiahInput = (raw) => {
    const digits = String(raw || '').replace(/[^\d]/g, '');
    if (!digits) return NaN;
    return Number(digits);
  };
  const formatRupiahInput = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    return Math.round(num).toLocaleString('id-ID');
  };

  function renderPriceEditor() {
    const box = $('#price-editor');
    box.textContent = '';
    MENU.forEach(item => {
      const row = el('div', 'price-row');
      const label = el('label', null, item.name);
      label.htmlFor = 'price-' + item.id;
      row.append(label);

      const wrap = el('div', 'price-input');
      wrap.append(el('span', null, 'Rp'));

      const input = el('input');
      input.type = 'text';
      input.id = 'price-' + item.id;
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.value = formatRupiahInput(priceOf(item.id));
      input.addEventListener('input', () => {
        const caretAtEnd = input.selectionStart === input.value.length;
        const digits = input.value.replace(/[^\d]/g, '').slice(0, 9);
        input.value = digits ? Number(digits).toLocaleString('id-ID') : '';
        if (caretAtEnd) {
          const len = input.value.length;
          input.setSelectionRange(len, len);
        }
      });
      wrap.append(input);
      row.append(wrap);
      box.append(row);
    });

    $('#save-note').textContent = '';
  }

  $('#btn-save-prices').addEventListener('click', () => {
    const next = {};
    let invalid = null;
    MENU.forEach(item => {
      const input = document.getElementById('price-' + item.id);
      const v = parseRupiahInput(input.value);
      if (!Number.isFinite(v) || v < 0 || v > 999999999) { invalid = item.name; return; }
      next[item.id] = Math.round(v);
    });
    if (invalid) {
      $('#save-note').textContent = `Harga ${invalid} tidak valid. Pakai angka, contoh 10.000.`;
      return;
    }

    state.prices = Object.assign({}, state.prices, next);
    if (save()) {
      $('#save-note').textContent = 'Harga tersimpan.';
      toast('Harga diperbarui');
      renderMenu();
      renderCart();
    }
  });

  $('#btn-reset-prices').addEventListener('click', () => {
    if (!confirm('Kembalikan semua harga ke harga awal?')) return;
    state.prices = defaults().prices;
    if (save()) {
      renderPriceEditor();
      renderMenu();
      renderCart();
      toast('Harga dikembalikan');
    }
  });

  // ---------- Printer settings ----------
  function renderPrinterSettings() {
    const s = state.settings;
    $('#receipt-name').value = s.receiptName;
    $('#receipt-footer').value = s.receiptFooter;
    $('#auto-print').checked = !!s.autoPrint;
    $('#use-bridge').checked = !!(s.useBridge && !isMobile);
    $('#bridge-url').value = s.bridgeUrl;
    $('#printer-ip').value = s.printerIp;
    $('#paper-width').value = s.paperWidth || '58';
    $('#printer-note').textContent = '';
    renderBtDevices();
    applyDeviceUi();
  }

  function renderBtDevices() {
    const sel = $('#bt-device');
    if (!sel) return;
    sel.textContent = '';
    const empty = el('option', null, '- pilih printer -');
    empty.value = '';
    sel.append(empty);
    if (state.settings.btAddress) {
      const saved = el('option', null, `${state.settings.btName || 'Printer'} (${state.settings.btAddress})`);
      saved.value = state.settings.btAddress;
      sel.append(saved);
      sel.value = state.settings.btAddress;
    }
  }

  async function scanBtDevices() {
    const plugin = nativePrinter();
    const status = $('#bt-status');
    if (!status) return;
    if (!plugin) {
      status.textContent = 'Pencarian printer hanya tersedia di aplikasi Android. Di browser, pakai Bagikan / Salin struk.';
      return;
    }
    status.textContent = 'Mencari printer...';
    try {
      const { devices } = await plugin.devices();
      const sel = $('#bt-device');
      sel.textContent = '';
      const empty = el('option', null, '- pilih printer -');
      empty.value = '';
      sel.append(empty);
      (devices || []).forEach((d) => {
        const o = el('option', null, `${d.name} (${d.address})`);
        o.value = d.address;
        sel.append(o);
      });
      if (state.settings.btAddress) sel.value = state.settings.btAddress;
      status.textContent = (devices || []).length
        ? `${devices.length} printer terpasang. Pilih satu lalu Simpan pengaturan.`
        : 'Belum ada printer terpasang. Pasangkan dulu di Setelan Bluetooth Android.';
    } catch (err) {
      status.textContent = 'Gagal mencari printer: ' + ((err && err.message) || err);
    }
  }

  $('#btn-save-printer').addEventListener('click', () => {
    state.settings = {
      ...state.settings,
      receiptName: $('#receipt-name').value.trim() || 'MoodA',
      receiptFooter: $('#receipt-footer').value.trim(),
      autoPrint: $('#auto-print').checked,
      useBridge: isMobile ? false : $('#use-bridge').checked,
      bridgeUrl: $('#bridge-url').value.trim() || DEFAULT_SETTINGS.bridgeUrl,
      printerIp: $('#printer-ip').value.trim(),
      btAddress: $('#bt-device') ? $('#bt-device').value : '',
      btName: $('#bt-device') && $('#bt-device').selectedOptions[0]
        ? $('#bt-device').selectedOptions[0].textContent.replace(/\s*\([^)]*\)\s*$/, '').trim()
        : '',
      paperWidth: $('#paper-width').value
    };
    if (save()) {
      $('#printer-note').textContent = 'Pengaturan printer tersimpan.';
      toast('Pengaturan disimpan');
    }
  });

  $('#btn-bridge-scan').addEventListener('click', scanBridge);
  $('#btn-bridge-test').addEventListener('click', testBridge);
  if ($('#btn-bt-scan')) $('#btn-bt-scan').addEventListener('click', scanBtDevices);

  const SAMPLE_ORDER = () => ({
    id: 'TRX-TEST',
    at: new Date().toISOString(),
    method: 'Cash',
    methodLabel: 'Cash',
    received: 50000,
    change: 15000,
    customer: 'Tes Printer',
    total: 35000,
    lines: [
      { name: 'Wonton Mini', qty: 1, price: 15000, subtotal: 15000, variant: '' },
      { name: 'Nasi Ayam Selimut', qty: 1, price: 12000, subtotal: 12000, variant: '' },
      { name: 'Signature Chocolate MoodA', qty: 1, price: 8000, subtotal: 8000, variant: 'Less ice * No sugar' }
    ]
  });

  $('#btn-share-test').addEventListener('click', () => shareReceipt(SAMPLE_ORDER()));
  $('#btn-copy-test').addEventListener('click', () => copyReceipt(SAMPLE_ORDER()));
  $('#btn-download-test').addEventListener('click', () => downloadReceipt(SAMPLE_ORDER()));

  $('#btn-print-test').addEventListener('click', () => {
    printOrder(SAMPLE_ORDER());
  });

  $('#btn-print-example').addEventListener('click', () => {
    const data = lastOrder || state.orders[state.orders.length - 1];
    if (!data) { toast('Belum ada transaksi untuk dipratinjau'); return; }
    previewReceipt(data);
  });

  // ---------- Ekspor / backup ----------
  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Ekspor PDF (lewat lembar cetak ukuran A4, tanpa library) ----------
  // Tidak memakai API key / layanan luar: PDF dihasilkan oleh dialog cetak browser,
  // user memilih "Save as PDF". Struktur laporan dibuat di DOM lalu dicetak.
  function buildReportNode(period, start, end, orders) {
    const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const s = state.settings;
    const omzet = orders.reduce((a, o) => a + o.total, 0);
    const itemQty = orders.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0);
    const avg = orders.length ? omzet / orders.length : 0;

    const tally = new Map();
    orders.forEach(o => o.lines.forEach(l => {
      const key = l.name + (l.variant ? ' (' + l.variant + ')' : '');
      const cur = tally.get(key) || { name: key, qty: 0, revenue: 0 };
      cur.qty += l.qty;
      cur.revenue += l.subtotal;
      tally.set(key, cur);
    }));
    const top = [...tally.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);

    const sheet = el('div', 'report');

    const head = el('div', 'rpt-head');
    head.append(el('div', 'rpt-brand', (s.receiptName || 'MoodA').toUpperCase()));
    head.append(el('div', 'rpt-sub', 'Laporan Penjualan'));
    sheet.append(head);

    const meta = el('div', 'rpt-meta');
    const metaRow = (k, v) => {
      const row = el('div', 'rpt-meta-row');
      row.append(el('span', null, k));
      row.append(el('b', null, v));
      return row;
    };
    meta.append(metaRow('Periode', periodLabelText(period, periodAnchor)));
    meta.append(metaRow('Dibuat', new Date().toLocaleString('id-ID', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })));
    sheet.append(meta);

    const stats = el('div', 'rpt-stats');
    const stat = (label, value, money) => {
      const box = el('div', 'rpt-stat');
      box.append(el('span', 'rpt-stat-label', label));
      box.append(el('strong', money ? 'money' : null, value));
      return box;
    };
    stats.append(stat('Omzet', rupiah(omzet), true));
    stats.append(stat('Transaksi', String(orders.length)));
    stats.append(stat('Item terjual', String(itemQty)));
    stats.append(stat('Rata-rata', rupiah(avg), true));
    sheet.append(stats);

    sheet.append(el('h3', 'rpt-h3', 'Rincian transaksi'));
    const table = el('table', 'rpt-table');
    const thead = el('thead');
    const hrow = el('tr');
    ['No', 'Waktu', 'Metode', 'Atas nama', 'Item', 'Total'].forEach((t, i) => {
      const th = el('th', i === 5 ? 'num' : null, t);
      hrow.append(th);
    });
    thead.append(hrow);
    table.append(thead);

    const tbody = el('tbody');
    const sorted = [...orders].sort((a, b) => new Date(a.at) - new Date(b.at));
    sorted.forEach((o, idx) => {
      const tr = el('tr');
      tr.append(el('td', null, String(idx + 1)));
      tr.append(el('td', null, new Date(o.at).toLocaleString('id-ID', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      })));
      tr.append(el('td', null, o.methodLabel || o.method));
      tr.append(el('td', null, o.customer || '-'));
      tr.append(el('td', 'items', o.lines.map(l => `${l.qty}x ${l.name}${l.variant ? ' (' + l.variant + ')' : ''}`).join(', ')));
      tr.append(el('td', 'num money', rupiah(o.total)));
      tbody.append(tr);
    });
    table.append(tbody);

    const tfoot = el('tfoot');
    const frow = el('tr');
    const fcell = el('td', 'num', 'TOTAL');
    fcell.colSpan = 5;
    frow.append(fcell);
    frow.append(el('td', 'num money', rupiah(omzet)));
    tfoot.append(frow);
    table.append(tfoot);
    sheet.append(table);

    if (top.length) {
      sheet.append(el('h3', 'rpt-h3', 'Menu terlaris'));
      const t2 = el('table', 'rpt-table');
      const th2 = el('thead');
      const hr2 = el('tr');
      ['#', 'Menu', 'Qty', 'Omzet'].forEach((t, i) => hr2.append(el('th', i >= 2 ? 'num' : null, t)));
      th2.append(hr2);
      t2.append(th2);
      const tb2 = el('tbody');
      top.slice(0, 15).forEach((t, i) => {
        const tr = el('tr');
        tr.append(el('td', null, String(i + 1)));
        tr.append(el('td', null, t.name));
        tr.append(el('td', 'num', String(t.qty)));
        tr.append(el('td', 'num money', rupiah(t.revenue)));
        tb2.append(tr);
      });
      t2.append(tb2);
      sheet.append(t2);
    }

    const foot = el('div', 'rpt-foot');
    foot.append(el('span', null, `${bulan[start.getMonth()]} - dibuat otomatis oleh MoodA`));
    foot.append(el('span', null, 'Tanda tangan: ____________________'));
    sheet.append(foot);

    return sheet;
  }

  function exportPdf() {
    const { start, end } = periodRange(activePeriod, periodAnchor);
    const orders = ordersInRange(start, end);
    if (orders.length === 0) { toast('Tidak ada transaksi untuk diekspor'); return; }

    const area = $('#print-area');
    area.textContent = '';
    area.append(buildReportNode(activePeriod, start, end, orders));

    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup);
      area.textContent = '';
      document.body.classList.remove('printing-report');
    };
    document.body.classList.add('printing-report');
    window.addEventListener('afterprint', cleanup);

    window.print();
    // Safari/iOS kadang tidak memicu afterprint; bersihkan setelah jeda.
    setTimeout(cleanup, 60000);
  }

  $('#btn-export-pdf').addEventListener('click', exportPdf);

  $('#btn-export-csv').addEventListener('click', () => {
    const { start, end } = periodRange(activePeriod, periodAnchor);
    const orders = ordersInRange(start, end);
    if (orders.length === 0) { toast('Tidak ada transaksi untuk diekspor'); return; }

    const rows = [['ID', 'Waktu', 'Metode', 'Atas nama', 'Item', 'Varian', 'Qty', 'Harga', 'Subtotal', 'Total Order']];
    orders.forEach(o => o.lines.forEach(l => {
      rows.push([o.id, new Date(o.at).toLocaleString('id-ID'), o.methodLabel || o.method, o.customer || '',
        l.name, l.variant || '', l.qty, l.price, l.subtotal, o.total]);
    }));

    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`mooda-rekap-${activePeriod}-${localDateKey(start)}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
  });

  $('#btn-backup').addEventListener('click', () => {
    download(`mooda-backup-${localDateKey(new Date())}.json`, JSON.stringify(state, null, 2), 'application/json');
  });

  $('#input-restore').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.orders)) throw new Error('Format tidak dikenali');
        if (!confirm(`Pulihkan backup dengan ${data.orders.length} transaksi? Data saat ini diganti.`)) return;
        state = {
          version: 4,
          prices: Object.assign(defaults().prices, data.prices || {}),
          orders: data.orders,
          images: (data.images && typeof data.images === 'object') ? data.images : {},
          settings: Object.assign({ ...DEFAULT_SETTINGS }, data.settings || {})
        };
        save();
        renderMenu(); renderCart(); renderRekap(); renderPriceEditor(); renderImageEditor(); renderPrinterSettings();
        toast('Backup dipulihkan');
      } catch (err) {
        toast('File backup tidak valid');
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---------- Kunci PIN (lokal, tanpa API key) ----------
  // PIN tidak pernah disimpan apa adanya: hanya hash SHA-256 + salt acak.
  const PIN_KEY = 'mooda.pin.v1';

  function randomSalt() {
    const arr = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(text) {
    if (!(window.crypto && crypto.subtle)) {
      // Fallback untuk file:// lama: hash sederhana, tetap tidak menyimpan PIN asli.
      let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return 'fnv:' + (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
    }
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function readPinRecord() {
    try {
      const raw = localStorage.getItem(PIN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function savePin(pin) {
    const salt = randomSalt();
    const hash = await sha256Hex(salt + '|' + pin);
    localStorage.setItem(PIN_KEY, JSON.stringify({ v: 1, salt, hash, at: new Date().toISOString() }));
  }

  async function verifyPin(pin) {
    const rec = readPinRecord();
    if (!rec) return false;
    const hash = await sha256Hex(rec.salt + '|' + pin);
    return hash === rec.hash;
  }

  let unlockResolve = null;
  function requirePin() {
    const screen = $('#lock-screen');
    if (!screen) return Promise.resolve();

    const rec = readPinRecord();
    screen.hidden = false;
    $('#lock-setup').hidden = !!rec;
    $('#lock-entry').hidden = !rec;
    $('#lock-sub').textContent = rec ? 'Masukkan PIN untuk membuka' : 'Buat PIN dulu untuk mengamankan kasir';
    $('#lock-error').textContent = '';
    setTimeout(() => (rec ? $('#pin-input') : $('#pin-new')).focus(), 120);

    return new Promise((resolve) => { unlockResolve = resolve; });
  }

  function unlockApp() {
    const screen = $('#lock-screen');
    if (screen) screen.hidden = true;
    $('#pin-input').value = '';
    $('#pin-new').value = '';
    $('#pin-confirm').value = '';
    $('#lock-error').textContent = '';
    if (unlockResolve) { unlockResolve(); unlockResolve = null; }
  }

  (function wirePinUi() {
    const create = $('#btn-pin-create');
    const unlock = $('#btn-pin-unlock');
    const pinInput = $('#pin-input');

    if (create) {
      create.addEventListener('click', async () => {
        const a = $('#pin-new').value.trim();
        const b = $('#pin-confirm').value.trim();
        if (!/^\d{4,6}$/.test(a)) { $('#lock-error').textContent = 'PIN harus 4-6 angka.'; return; }
        if (a !== b) { $('#lock-error').textContent = 'PIN tidak sama.'; return; }
        await savePin(a);
        toast('PIN aktif');
        unlockApp();
      });
    }

    if (unlock) {
      unlock.addEventListener('click', async () => {
        const pin = pinInput.value.trim();
        if (!pin) return;
        const ok = await verifyPin(pin);
        if (ok) { unlockApp(); return; }
        $('#lock-error').textContent = 'PIN salah.';
        pinInput.value = '';
        pinInput.focus();
      });
    }

    if (pinInput) {
      pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-pin-unlock').click(); });
      pinInput.addEventListener('input', () => {
        pinInput.value = pinInput.value.replace(/[^\d]/g, '').slice(0, 6);
      });
    }
    ['#pin-new', '#pin-confirm'].forEach((sel) => {
      const n = $(sel);
      if (!n) return;
      n.addEventListener('input', () => { n.value = n.value.replace(/[^\d]/g, '').slice(0, 6); });
    });
  })();

  // ---------- Init ----------
  applyDeviceUi();
  renderMenu();
  renderCart();

  // Kunci layar hanya bila PIN sudah pernah dibuat, supaya pemakaian pertama tidak terhambat.
  if (readPinRecord()) {
    requirePin();
  }
})();
