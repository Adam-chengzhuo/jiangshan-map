#!/usr/bin/env node
/**
 * Fail if dist/ still contains redistributable-forbidden administrative boundaries.
 *
 *   node scripts/check_public_dist.js [distDir]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, loadPublicAtlas, publicChinaGeo } = require('./public_dist');

const TEXT_ALLOW = new Set(['NOTICE.txt', 'index.html', 'PUBLIC_BUILD.json']);
// The running app names the omitted layers in its notice. Those sentences are not the geometries.
const NOTICE_COPY_ALLOW = new Set([
  'NOTICE.txt',
  'index.html',
  'PUBLIC_BUILD.json',
  'js/app.js',
  'js/public_notice.js',
]);

const FORBIDDEN_PATTERNS = [
  { name: 'CHGIS', re: /CHGIS/ },
  { name: 'Hartwell', re: /Hartwell/ },
  { name: 'DataV', re: /DataV/ },
  { name: 'GeoAtlas', re: /GeoAtlas/ },
  { name: 'Amap attribution', re: /高德/ },
  { name: 'prefecture redistribution clause', re: /do not redistribute/i },
  { name: 'non-GPL prefecture clause', re: /not licensed under GPL-3\.0/ },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

function loadBundle(file) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox.window;
}

function snapshotEntries(snapshots) {
  const out = [];
  for (const [key, snap] of Object.entries(snapshots || {})) {
    if (!snap || Array.isArray(snap) || typeof snap !== 'object') continue;
    out.push([key, snap]);
  }
  return out;
}

function checkDist(distDir, { compareToSource = true } = {}) {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  if (!fs.existsSync(distDir)) {
    return [`${distDir} does not exist. Run: node scripts/build_public.js`];
  }

  const required = [
    'index.html',
    'LICENSE',
    'NOTICE.txt',
    'js/app.js',
    'js/atlas_boot.js',
    'js/atlas_snapshots.js',
    'js/china_geo_data.js',
    'js/map_data.js',
    'js/lore_core.js',
    'css/style.css',
    'assets/terrain_relief.webp',
    'assets/favicon.svg',
  ];
  for (const rel of required) {
    if (!fs.existsSync(path.join(distDir, rel))) fail(`missing ${rel}`);
  }
  if (!fs.existsSync(path.join(distDir, 'js/app.js'))) return problems;

  const files = walk(distDir);
  for (const abs of files) {
    const rel = path.relative(distDir, abs);
    const lower = rel.replace(/\\/g, '/');
    if (lower.startsWith('data/') || lower.includes('/data/atlas/')) fail(`restricted source tree copied: ${rel}`);
    if (lower.startsWith('workers/') || lower.startsWith('scripts/') || lower.startsWith('geojson/')) {
      fail(`non-runtime path copied: ${rel}`);
    }
    if (lower.endsWith('.geojson')) fail(`geojson must not be deployed: ${rel}`);
    const base = path.basename(abs);
    if (base.startsWith('hero_demo_') || base.startsWith('preview_')) fail(`demo image must not be deployed: ${rel}`);
    if (fs.statSync(abs).size > 25 * 1024 * 1024) fail(`file exceeds the 25 MiB Pages limit: ${rel}`);
  }

  const boot = loadBundle(path.join(distDir, 'js/atlas_boot.js'));
  const full = loadBundle(path.join(distDir, 'js/atlas_snapshots.js'));
  if (boot.ATLAS_FULL_SNAPSHOTS_LOADED) fail('atlas_boot.js must not mark the full bundle loaded');
  if (full.ATLAS_FULL_SNAPSHOTS_LOADED !== true) fail('atlas_snapshots.js must mark the full bundle loaded');

  const expectEmpty = (label, snapshots, key, field) => {
    const snap = snapshots && snapshots[key];
    if (!snap) {
      fail(`${label} missing snapshot ${key}`);
      return;
    }
    const list = snap[field] || [];
    if (list.length) fail(`${label} ${key}.${field} still has ${list.length} features`);
  };
  const expectSome = (label, snapshots, key, field) => {
    const snap = snapshots && snapshots[key];
    const list = (snap && snap[field]) || [];
    if (!list.length || !list.some((f) => f && f.shape)) fail(`${label} ${key}.${field} lost its geometry`);
  };

  expectSome('boot', boot.ATLAS_SNAPSHOTS, 's_zhanguo_a', 'polities');
  expectEmpty('boot', boot.ATLAS_SNAPSHOTS, 's_qin_a', 'prefectures');
  expectEmpty('boot', boot.ATLAS_SNAPSHOTS, 's_qin_a', 'regions');
  expectSome('boot', boot.ATLAS_SNAPSHOTS, 's_qin_a', 'polities');
  expectSome('full', full.ATLAS_SNAPSHOTS, 's_tang_a', 'polities');
  expectSome('full', full.ATLAS_SNAPSHOTS, 's_tang_a', 'regions');
  expectEmpty('full', full.ATLAS_SNAPSHOTS, 's_tang_a', 'prefectures');
  expectSome('full', full.ATLAS_SNAPSHOTS, 's_ming_a', 'polities');
  expectEmpty('full', full.ATLAS_SNAPSHOTS, 's_ming_a', 'prefectures');
  expectSome('full', full.ATLAS_SNAPSHOTS, 's_qin', 'polities');
  expectEmpty('full', full.ATLAS_SNAPSHOTS, 's_qin', 'prefectures');
  expectEmpty('full', full.ATLAS_SNAPSHOTS, 's_qin', 'regions');

  let nonemptyPref = 0;
  let prefShapes = 0;
  for (const [key, snap] of snapshotEntries(full.ATLAS_SNAPSHOTS)) {
    const prefs = snap.prefectures || [];
    if (prefs.length) nonemptyPref += 1;
    for (const feature of prefs) {
      if (feature && feature.shape) prefShapes += 1;
    }
    if (snap.prefRef) fail(`${key} still has prefRef`);
  }
  if (nonemptyPref || prefShapes) {
    fail(`full bundle still exposes prefectures (${nonemptyPref} snapshots, ${prefShapes} shapes)`);
  }
  for (const [key, snap] of snapshotEntries(full.ATLAS_SNAPSHOTS)) {
    for (const feature of snap.regions || []) {
      if (feature && feature.category === '郡') fail(`${key} still publishes a commandery region "${feature.title}"`);
    }
  }

  const china = loadBundle(path.join(distDir, 'js/china_geo_data.js'));
  if (!Array.isArray(china.PROVINCE_OUTLINES) || china.PROVINCE_OUTLINES.length !== 0) {
    fail(`PROVINCE_OUTLINES must be an empty list, got ${china.PROVINCE_OUTLINES && china.PROVINCE_OUTLINES.length}`);
  }
  const rivers = china.HYDRO_DATA && china.HYDRO_DATA.rivers;
  if (!Array.isArray(rivers) || rivers.length < 10) fail('hydrography was removed with the province outlines');

  const lore = fs.readFileSync(path.join(distDir, 'js/lore_detail.js'), 'utf8');
  if (!lore.includes('郡')) fail('place lore lost commandery names in the prose; only boundary geometries should be removed');

  const notice = fs.readFileSync(path.join(distDir, 'NOTICE.txt'), 'utf8');
  if (!notice.includes('江山时序') || !notice.includes('Jiangshan Atlas') || !notice.includes('DeanChensj/jiangshan-map')) {
    fail('NOTICE.txt must credit 江山时序 Jiangshan Atlas and the upstream repository');
  }
  if (!notice.includes('GPL-3.0') || !fs.readFileSync(path.join(distDir, 'LICENSE'), 'utf8').includes('GNU GENERAL PUBLIC LICENSE')) {
    fail('GPL LICENSE text or the GPL reference in NOTICE.txt is missing');
  }
  const index = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  if (!index.includes('id="restricted-layer-notice"') || !index.includes('CHGIS')) {
    fail('index.html must carry the visible restricted-layer notice');
  }

  for (const abs of files) {
    const rel = path.relative(distDir, abs).replace(/\\/g, '/');
    if (TEXT_ALLOW.has(rel)) continue;
    if (!/\.(js|css|html|json|txt|xml|webmanifest|svg)$/i.test(abs)) continue;
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (_) {
      continue;
    }
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (!pattern.re.test(text)) continue;
      if (NOTICE_COPY_ALLOW.has(rel) && pattern.name !== 'prefecture redistribution clause' && pattern.name !== 'non-GPL prefecture clause') {
        continue;
      }
      fail(`${rel} contains ${pattern.name}`);
    }
  }

  if (compareToSource && fs.existsSync(path.join(ROOT, 'data/atlas/index.json'))) {
    const expected = loadPublicAtlas(ROOT);
    const china = publicChinaGeo(ROOT);
    const same = (rel, want) => {
      const got = fs.readFileSync(path.join(distDir, rel), 'utf8');
      if (got !== want) fail(`${rel} does not match a fresh public encode (${got.length} bytes vs ${want.length})`);
    };
    same('js/atlas_boot.js', expected.boot);
    same('js/atlas_snapshots.js', expected.full);
    same('js/china_geo_data.js', china);
  }

  return problems;
}

function main(argv) {
  const distDir = path.resolve(argv[2] || path.join(ROOT, 'dist'));
  const problems = checkDist(distDir);
  if (problems.length) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    return 1;
  }
  console.log(`✓ ${distDir} has no CHGIS/Hartwell prefecture layer and no DataV province outlines`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (err) {
    console.error(`✗ ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { checkDist };
