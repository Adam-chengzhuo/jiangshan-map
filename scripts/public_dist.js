#!/usr/bin/env node
/**
 * Public-deploy geometry for 江山时序 Jiangshan Atlas.
 *
 * The repository keeps its sources for local use. This module builds the two
 * atlas bundles and the modern-geography script that a public static deploy
 * is allowed to ship:
 *
 *   - Prefecture-level geometries (郡 / 州 / 府 and the other units stored in
 *     each snapshot's `prefectures` list) come from CHGIS V6 and the Hartwell
 *     China Historical GIS. Those terms are academic / non-commercial and
 *     forbid redistribution. They are omitted, including exact geometry copies
 *     that were also listed under `regions` (Qin and some Warring States
 *     commanderies).
 *   - Modern provincial outlines in js/china_geo_data.js come from DataV
 *     GeoAtlas. Alibaba's page says that data is from the Amap open platform
 *     and is for learning and exchange only. The outline payload is omitted.
 *     Rivers, lakes and the other hydrography in the same file stay; the
 *     project marks those as public domain.
 *
 * Polity outlines, hand-drawn first-level regions that are not exact copies of
 * a prefecture polygon, settlements, people and the timeline are unchanged.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadSources, encodeBundle } = require('./build_atlas');

const ROOT = path.resolve(__dirname, '..');
const CHINA_GEO = 'js/china_geo_data.js';

const PROVINCE_START = '  const P = ';
const PROVINCE_END = ';\n  for (let i = 0; i < P.length; i++) {';

function geometrySignature(feature) {
  const shape = feature && feature.shape;
  if (!shape || !shape.coordinates) return '';
  const polys =
    shape.type === 'Polygon' ? [shape.coordinates] : shape.type === 'MultiPolygon' ? shape.coordinates : null;
  if (!polys) return '';
  return JSON.stringify(polys);
}

function ringSet(feature) {
  const shape = feature && feature.shape;
  const out = new Set();
  if (!shape || !shape.coordinates) return out;
  const polys =
    shape.type === 'Polygon' ? [shape.coordinates] : shape.type === 'MultiPolygon' ? shape.coordinates : null;
  if (!polys) return out;
  for (const poly of polys) {
    if (!Array.isArray(poly)) continue;
    for (const ring of poly) out.add(JSON.stringify(ring));
  }
  return out;
}

/**
 * Returns atlas bundle source and a count of what was removed. `doc` is the
 * { features, snapshots } object from scripts/build_atlas.js loadSources().
 */
function buildPublicAtlas(doc, index) {
  const prefFeatureIds = new Set();
  const otherFeatureIds = new Set();
  let prefectureSnapshots = 0;
  let prefectureRefs = 0;
  for (const snap of Object.values(doc.snapshots)) {
    if (Array.isArray(snap)) {
      for (const id of snap) otherFeatureIds.add(id);
      continue;
    }
    if (!snap || typeof snap !== 'object') continue;
    const prefs = Array.isArray(snap.prefectures) ? snap.prefectures : [];
    if (prefs.length) prefectureSnapshots += 1;
    prefectureRefs += prefs.length;
    for (const id of prefs) prefFeatureIds.add(id);
    for (const list of ['polities', 'regions']) {
      for (const id of snap[list] || []) otherFeatureIds.add(id);
    }
  }

  const prefSignatures = new Set();
  const prefOnlyRings = new Set();
  const otherRings = new Set();
  for (const id of prefFeatureIds) {
    const feature = doc.features[id];
    const sig = geometrySignature(feature);
    if (sig) prefSignatures.add(sig);
    if (!otherFeatureIds.has(id)) {
      for (const ring of ringSet(feature)) prefOnlyRings.add(ring);
    }
  }
  for (const id of otherFeatureIds) {
    for (const ring of ringSet(doc.features[id])) otherRings.add(ring);
  }
  let ringsSharedWithOtherLayers = 0;
  for (const ring of prefOnlyRings) {
    if (otherRings.has(ring)) ringsSharedWithOtherLayers += 1;
  }

  let regionSlotsDropped = 0;
  const droppedRegionFeatures = new Set();
  const snapshots = {};
  for (const [key, snap] of Object.entries(doc.snapshots)) {
    if (Array.isArray(snap)) {
      snapshots[key] = snap.slice();
      continue;
    }
    const out = { ...snap, prefectures: [] };
    delete out.prefRef;
    if (Array.isArray(snap.regions)) {
      out.regions = [];
      for (const id of snap.regions) {
        const feature = doc.features[id];
        const sig = geometrySignature(feature);
        // Exact copies of a prefecture polygon, and any region whose own
        // category is 郡 (Qin / Warring States commanderies, including a
        // hand-adjusted 九原郡 that is not byte-identical). Grouped labels
        // such as 郡区 stay; they are not the prefecture polygons.
        if ((sig && prefSignatures.has(sig)) || (feature && feature.category === '郡')) {
          regionSlotsDropped += 1;
          droppedRegionFeatures.add(id);
          continue;
        }
        out.regions.push(id);
      }
    }
    snapshots[key] = out;
  }

  const publicDoc = { features: doc.features, snapshots };
  return {
    boot: encodeBundle(publicDoc, { keys: index.boot, isBoot: true }),
    full: encodeBundle(publicDoc, { keys: index.order, isBoot: false }),
    stats: {
      snapshots: Object.keys(doc.snapshots).length,
      prefectureSnapshots,
      prefectureRefs,
      uniquePrefectureFeatures: prefFeatureIds.size,
      prefectureSignatures: prefSignatures.size,
      regionSlotsOmitted: regionSlotsDropped,
      uniqueRegionFeaturesOmitted: droppedRegionFeatures.size,
      prefectureOnlyRings: prefOnlyRings.size,
      ringsSharedWithPolityOrRegion: ringsSharedWithOtherLayers,
      ringsOnlyOnPrefectureLayer: prefOnlyRings.size - ringsSharedWithOtherLayers,
    },
  };
}

function loadPublicAtlas(rootDir = ROOT) {
  const { index, doc } = loadSources(rootDir);
  return buildPublicAtlas(doc, index);
}

function stripProvinceOutlines(source) {
  const start = source.indexOf(PROVINCE_START);
  const end = source.indexOf(PROVINCE_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`${CHINA_GEO}: could not locate the PROVINCE_OUTLINES payload`);
  }
  const next = `${source.slice(0, start)}  const P = []${source.slice(end)}`;
  if (!next.includes('window.PROVINCE_OUTLINES = P;') || !next.includes('window.HYDRO_DATA')) {
    throw new Error(`${CHINA_GEO}: stripped file lost the province or hydrography assignment`);
  }
  if (next.includes('"code":110000') || next.includes('"title":"北京市"')) {
    throw new Error(`${CHINA_GEO}: provincial outline payload is still present after stripping`);
  }
  return next;
}

function publicChinaGeo(rootDir = ROOT) {
  return stripProvinceOutlines(fs.readFileSync(path.join(rootDir, CHINA_GEO), 'utf8'));
}

module.exports = {
  ROOT,
  CHINA_GEO,
  buildPublicAtlas,
  loadPublicAtlas,
  stripProvinceOutlines,
  publicChinaGeo,
};
