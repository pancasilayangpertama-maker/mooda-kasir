# MoodA — Kasir Kafe

Aplikasi kasir untuk kafe MoodA. HTML + CSS + JavaScript murni, tanpa framework, tanpa build step. Data tersimpan di perangkat (localStorage).

## 1. Menjalankan

**Langsung:** buka `index.html` di Chrome/Edge/Safari. Selesai.

**Lewat server lokal** (disarankan, supaya service worker/PWA aktif):

```bash
python -m http.server 8080
# buka http://localhost:8080
```

## 2. Fitur

- **Kasir** — 8 menu, keranjang, ubah qty, ubah varian minuman saat masuk keranjang.
- **Varian minuman** — Es normal / Less ice, dan Gula normal / Less sugar / No sugar.
- **Pembayaran** — Cash (dengan kembalian), QRIS, **E-Wallet** (GoPay / OVO / DANA / ShopeePay), Transfer.
- **Rekap** — harian, mingguan, bulanan; omzet, transaksi, item terjual, rata-rata, menu terlaris, riwayat + cetak ulang.
- **Harga** — ubah harga per menu dari dalam aplikasi.
- **Struk** — thermal 58mm, desain kop logo, nomor struk, badge metode bayar.
- **Cetak** — dialog cetak sistem, atau langsung via WiFi dengan `bridge.js` (ESC/POS).
- **Backup** — ekspor CSV per periode, backup/pulihkan JSON.

## 3. Struktur file

| File | Fungsi |
| --- | --- |
| `index.html` | struktur halaman |
| `styles.css` | tampilan + CSS cetak 58mm |
| `app.js` | logika kasir, rekap, harga, struk |
| `bridge.js` | jembatan cetak ESC/POS via WiFi (Node, tanpa dependency) |
| `manifest.webmanifest` | manifest PWA |
| `sw.js` | service worker (offline) |
| `icons/` | ikon aplikasi |
| `fonts/` | Baloo 2 |

## 4. Menjadi aplikasi Android / iPhone

Aplikasi web ini dibungkus dengan **Capacitor** agar jadi aplikasi asli.

```bash
npm install
npx cap init MoodA com.mooda.kasir --web-dir=.
npx cap add android     # butuh Android Studio + JDK 17
npx cap add ios         # HANYA di macOS + Xcode
npx cap sync
npx cap open android    # build APK dari Android Studio
```

Catatan penting:
- **APK hanya untuk Android.** iPhone tidak bisa memasang file `.apk`.
- **Build iOS wajib macOS + Xcode.** Di Windows tidak bisa.
- Setelah mengubah `index.html` / `app.js` / `styles.css`, jalankan `npx cap sync` lagi.

## 5. PWA (cara tercepat di tiga OS)

Buka lewat `http://localhost` atau HTTPS, lalu:

- **Android (Chrome):** menu ⋮ → *Add to Home screen*
- **iPhone (Safari):** tombol Share → *Add to Home Screen*
- **Windows (Chrome/Edge):** ikon instal di address bar, atau ⋮ → *Install MoodA*

Hasilnya ikon di home screen, terbuka tanpa address bar, dan tetap jalan offline setelah sekali dibuka.

## 6. Printer struk 58mm

**Metode 1 — dialog cetak (paling mudah).** Pasang printer di perangkat dulu:
- Windows: *Settings → Bluetooth & devices → Printers & scanners → Add device*
- Android: aplikasi printer mereknya (mis. Xprinter, RawBT)
- iPhone: AirPrint (printer harus mendukung AirPrint)

Lalu di MoodA: tab **Printer** → aktifkan *Cetak struk otomatis* atau tekan **Cetak struk uji**.

**Metode 2 — langsung via WiFi (ESC/POS).**

```bash
node bridge.js                                   # port 9110
MOODA_PRINTER_IP=192.168.1.50 node bridge.js     # kunci IP printer
SUBNET=192.168.1 node bridge.js                  # batasi pemindaian
```

Di MoodA: tab **Printer** → isi alamat bridge → **Cari printer** → **Tes koneksi** → centang *Pakai bridge WiFi* → Simpan.

Batasan yang perlu diketahui: browser dan aplikasi mobile **tidak bisa** membuka TCP port 9100 sendiri, jadi bridge harus berjalan di komputer yang satu jaringan dengan printer. Tanpa bridge, pakai Metode 1.

## 7. Uji

```bash
node _test_cdp.js
```

Menjalankan Chrome headless lewat DevTools Protocol dan menguji menu, varian, metode bayar, struk 58mm, rekap, harga, persistensi, serta layout 375 / 390 / 768 / 1280 px. Hasil terakhir: **20/20 lulus**.

## 8. Catatan data

Data disimpan di `localStorage` perangkat itu saja. Ganti perangkat atau bersihkan data browser = transaksi hilang. Biasakan klik **Backup data (JSON)** di tab Rekap.
