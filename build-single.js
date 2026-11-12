#!/usr/bin/env node
/**
 * build-single.js - gabungkan MoodA jadi SATU file HTML mandiri.
 *
 * Semua CSS, JS, ikon, dan font ditanam (base64 / inline) sehingga file
 * bisa dikirim lewat WhatsApp dan dibuka tanpa folder pendamping.
 *
 *   node build-single.js
 *   -> dist/MoodA-Single.html
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'MoodA-Single.html');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const b64 = (p, mime) => `data:${mime};base64,` + fs.readFileSync(path.join(ROOT, p)).toString('base64');

function main() {
  let html = read('index.html');
  const css = read('styles.css');
  const js = read('app.js');

  // 1. Font -> base64 di dalam CSS
  let cssInlined = css
    .replace(/url\('fonts\/Baloo2-ExtraBold\.ttf'\)/g, `url('${b64('fonts/Baloo2-ExtraBold.ttf', 'font/ttf')}')`)
    .replace(/url\('fonts\/Baloo2-Bold\.ttf'\)/g, `url('${b64('fonts/Baloo2-Bold.ttf', 'font/ttf')}')`);

  // 2. Logo brand (foto) -> data URI
  const brandPng = b64('icons/brand-256.png', 'image/png');
  const heroPng = b64('icons/brand-512.png', 'image/png');

  // 3. Ikon PNG untuk struk -> data URI
  const iconPng = b64('icons/icon-192.png', 'image/png');

  // 4. Ganti link CSS dengan <style>
  html = html.replace(
    /<link rel="stylesheet" href="styles\.css">/,
    `<style>\n${cssInlined}\n</style>`
  );

  // 5. Ganti <script src="app.js"> dengan <script> inline
  html = html.replace(
    /<script src="app\.js"><\/script>/,
    `<script>\n${js}\n</script>`
  );

  // 6. Ganti manifest (tidak berguna di file://, tapi jangan sampai 404)
  html = html.replace(
    /<link rel="manifest" href="manifest\.webmanifest">/,
    '<!-- manifest dihilangkan pada versi satu-file (tidak berlaku di file://) -->'
  );

  // 7. ikon apple-touch + favicon -> data URI
  html = html.replace(
    /<link rel="icon" href="icons\/icon-192\.png" type="image\/png">/,
    `<link rel="icon" href="${iconPng}" type="image/png">`
  );
  html = html.replace(
    /<link rel="apple-touch-icon" href="icons\/icon-192\.png">/,
    `<link rel="apple-touch-icon" href="${iconPng}">`
  );

  // 8. Gambar hero + logo brand di markup
  html = html.replace(/<img src="icons\/brand-256\.png"/g, `<img src="${brandPng}"`);
  html = html.replace(/<img src="icons\/brand-512\.png"/g, `<img src="${heroPng}"`);

  // 9. app.js memakai 'icons/icon-192.png' untuk logo struk -> data URI
  html = html.replace(
    /logo\.src = 'icons\/icon-192\.png';/,
    `logo.src = ${JSON.stringify(iconPng)};`
  );

  // 10. Service worker tidak berlaku di file:// - hapus registrasinya
  html = html.replace(
    /<script>\s*if \('serviceWorker' in navigator[\s\S]*?<\/script>/,
    '<!-- service worker tidak dipakai pada versi satu-file -->'
  );

  // 11. Penanda versi satu-file
  html = html.replace(
    '</head>',
    '<meta name="mooda-build" content="single-file">\n</head>'
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`OK  ${path.relative(ROOT, OUT)}  (${kb} KB)`);

  // pastikan tidak ada referensi file eksternal yang tersisa
  const leftovers = [...html.matchAll(/(?:src|href)="(?!data:|#|mailto:)([^"]+)"/g)]
    .map((m) => m[1])
    .filter((v) => !v.startsWith('http'));
  if (leftovers.length) {
    console.log('PERINGATAN referensi eksternal tersisa:', [...new Set(leftovers)].join(', '));
  } else {
    console.log('OK  tidak ada referensi file eksternal');
  }
}

main();
