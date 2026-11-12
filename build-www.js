#!/usr/bin/env node
/**
 * build-www.js - siapkan folder www/ untuk Capacitor (dibundel jadi APK).
 *
 * Hanya aset yang dipakai aplikasi yang disalin, supaya node_modules,
 * .git, dan file .bak tidak ikut masuk ke dalam APK.
 *
 *   node build-www.js
 *   -> www/
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'www');

const files = ['index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest'];
const dirs = ['fonts', 'icons'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of files) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
for (const d of dirs) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });

console.log(`OK  www/ siap (${files.length} file + ${dirs.length} folder)`);
