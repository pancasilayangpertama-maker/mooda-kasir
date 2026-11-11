# MoodA — Kasir Kafe

Aplikasi kasir untuk kafe MoodA. HTML + CSS + JavaScript murni, tanpa framework, tanpa build step. Data tersimpan di perangkat (localStorage).

## 0. Pasang di iPhone / Android / Windows (paling cepat)

**Opsi A · satu file lewat WhatsApp** (tanpa install, tanpa akun apa pun)

File: `dist/MoodA-Single.html` (1,3 MB). Semua CSS, JS, ikon, dan font sudah ditanam di dalamnya — cukup kirim satu file itu sebagai dokumen WhatsApp.

- **Android:** download file → ketuk → **buka dengan Chrome**. Jalan penuh, data tersimpan.
- **Windows:** download → klik dua kali → terbuka di browser default.
- **iPhone:** download → ketuk → **Bagikan → Safari** (atau buka lewat aplikasi Files). Tampil sebagai halaman, bukan ikon aplikasi; penyimpanan data di iOS untuk file lokal bisa terbatas.

Buat ulang file setelah aplikasi diubah:

```bash
node build-single.js      # hasil: dist/MoodA-Single.html
```

**Opsi B · URL langsung** (paling nyaman untuk iPhone)

**Buka: https://pancasilayangpertama-maker.github.io/mooda-kasir/**

- **iPhone (Safari):** tombol Share → **Add to Home Screen**
- **Android (Chrome):** menu ⋮ → **Add to Home screen** / **Install app**
- **Windows (Chrome/Edge):** ikon install di address bar, atau ⋮ → **Install MoodA**

Ikon MoodA muncul di home screen, terbuka tanpa address bar, dan tetap jalan offline setelah sekali dibuka.

**Kenapa tidak ada APK?** File `.apk` hanya bisa dipasang di Android, dan membuatnya butuh JDK + Android SDK (sekitar 4 GB). Untuk iPhone, iOS menolak memasang aplikasi dari file yang dikirim lewat WhatsApp — hanya lewat App Store / TestFlight, yang butuh Apple Developer Program ($99/tahun).

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
