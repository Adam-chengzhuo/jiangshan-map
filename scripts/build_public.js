#!/usr/bin/env node
/**
 * Build the public static site into dist/.
 *
 *   node scripts/build_public.js
 *
 * Cloudflare Pages: build command `npm run build`, output directory `dist`.
 * The repository root must not be published. Restricted CHGIS/Hartwell
 * prefecture geometries and DataV/Amap province outlines are rebuilt out of
 * the bundles that land in dist/. Source files in the git tree are left in
 * place for local use; this script does not rewrite history.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadPublicAtlas, publicChinaGeo } = require('./public_dist');
const { computeAssetHashes, applyHashesToIndexHtml } = require('./sync_version');
const { checkDist } = require('./check_public_dist');

const STAGING = path.join(ROOT, 'dist.staging');
const DIST = path.join(ROOT, 'dist');

const COPY_FILES = ['index.html', 'LICENSE', 'NOTICE.txt', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml'];

const SKIP_JS = new Set(['atlas_boot.js', 'atlas_snapshots.js', 'china_geo_data.js']);

function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(rel, destRoot) {
  const from = path.join(ROOT, rel);
  const to = path.join(destRoot, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyFilteredTree(rel, destRoot, allow) {
  const fromRoot = path.join(ROOT, rel);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = path.relative(ROOT, abs);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!allow(relPath, entry.name)) continue;
      const to = path.join(destRoot, relPath);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(abs, to);
    }
  };
  walk(fromRoot);
}

function allowAsset(relPath, name) {
  if (name.startsWith('hero_demo_') && name.endsWith('.webp')) return false;
  if (name.startsWith('preview_') && name.endsWith('.webp')) return false;
  return !relPath.split(path.sep).includes('node_modules');
}

function allowJs(_relPath, name) {
  return !SKIP_JS.has(name);
}

function directoryReport(root) {
  let files = 0;
  let bytes = 0;
  let maxBytes = 0;
  let maxFile = '';
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const size = fs.statSync(abs).size;
      files += 1;
      bytes += size;
      if (size > maxBytes) {
        maxBytes = size;
        maxFile = path.relative(root, abs);
      }
    }
  };
  walk(root);
  return { files, bytes, maxBytes, maxFile };
}

function main() {
  const atlas = loadPublicAtlas(ROOT);
  const chinaGeo = publicChinaGeo(ROOT);
  rm(STAGING);
  fs.mkdirSync(STAGING, { recursive: true });

  for (const rel of COPY_FILES) copyFile(rel, STAGING);
  copyFilteredTree('css', STAGING, () => true);
  copyFilteredTree('topics', STAGING, () => true);
  copyFilteredTree('assets', STAGING, allowAsset);
  copyFilteredTree('js', STAGING, allowJs);

  fs.writeFileSync(path.join(STAGING, 'js/atlas_boot.js'), atlas.boot);
  fs.writeFileSync(path.join(STAGING, 'js/atlas_snapshots.js'), atlas.full);
  fs.writeFileSync(path.join(STAGING, 'js/china_geo_data.js'), chinaGeo);

  const indexPath = path.join(STAGING, 'index.html');
  const hashed = applyHashesToIndexHtml(fs.readFileSync(indexPath, 'utf8'), computeAssetHashes(STAGING));
  fs.writeFileSync(indexPath, hashed);

  const report = {
    ...atlas.stats,
    ...directoryReport(STAGING),
    omitted: [
      'CHGIS V6 and Hartwell prefecture-level boundaries, including exact geometry copies listed as regions',
      'DataV GeoAtlas / Amap modern provincial outlines',
    ],
  };
  fs.writeFileSync(path.join(STAGING, 'PUBLIC_BUILD.json'), `${JSON.stringify(report, null, 2)}\n`);

  const problems = checkDist(STAGING, { compareToSource: true });
  if (problems.length) {
    rm(STAGING);
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error('Public build rejected. dist/ was not updated.');
    return 1;
  }

  rm(DIST);
  fs.renameSync(STAGING, DIST);
  const finalReport = { ...report, ...directoryReport(DIST) };
  fs.writeFileSync(path.join(DIST, 'PUBLIC_BUILD.json'), `${JSON.stringify(finalReport, null, 2)}\n`);
  console.log(
    `✓ Public site written to dist/ (${finalReport.files} files, ${finalReport.bytes} bytes, largest ${finalReport.maxFile} ${finalReport.maxBytes} bytes)`
  );
  console.log(
    `  omitted prefecture snapshots=${finalReport.prefectureSnapshots} features=${finalReport.uniquePrefectureFeatures} region features=${finalReport.uniqueRegionFeaturesOmitted}`
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    rm(STAGING);
    console.error(`✗ ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}
