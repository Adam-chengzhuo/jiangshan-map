/**
 * Shows the restricted-layer notice when the loaded bundles omit them.
 * Deferred so it stays out of the first-paint script budget.
 * Local builds that still contain the layers leave the notice hidden.
 */
(function () {
  'use strict';

  function zh(app, text) {
    if (app.locale === 'zh-tw' && window.ZH_HANT_CONV) return window.ZH_HANT_CONV.toHant(text);
    return text;
  }

  function apply() {
    const app = window.atlasApp;
    if (!app || typeof document === 'undefined') return;
    let pref = false;
    let region = false;
    for (const snap of Object.values(app.snapshots || {})) {
      if (!snap || Array.isArray(snap)) continue;
      if (snap.prefectures && snap.prefectures.length) pref = true;
      if (snap.regions && snap.regions.length) region = true;
    }
    const provinces = !!(app.provinces && app.provinces.length);
    const missing = !pref || !provinces;
    const en = app.locale === 'en';
    const notice = document.getElementById('restricted-layer-notice');
    if (notice) notice.hidden = !missing;
    const omit = document.getElementById('txt-layer-omission');
    if (omit) {
      omit.hidden = !missing;
      if (missing) {
        omit.textContent = en
          ? 'Commandery, prefecture and fu boundaries, and modern province outlines, are not provided.'
          : zh(app, '郡、州、府边界与现代省界不提供。');
      }
    }
    const label = document.getElementById('lbl-prefectures');
    if (label && !pref) {
      label.textContent = region
        ? en
          ? 'Circuits & provinces'
          : zh(app, '道省政区')
        : en
          ? 'First-level divisions'
          : zh(app, '一级政区');
    }
    if (!provinces) {
      const prov = document.getElementById('chk-provinces');
      const names = document.getElementById('chk-prov-names');
      if (prov) {
        prov.checked = false;
        prov.disabled = true;
      }
      if (names) {
        names.checked = false;
        names.disabled = true;
      }
      if (app.grpProvinces) app.grpProvinces.classList.add('is-hidden');
      if (app.grpProvNames) app.grpProvNames.classList.add('is-hidden');
    }
    const text = document.getElementById('txt-restricted-notice');
    if (text && missing && en) {
      text.textContent =
        'This public build does not include CHGIS V6 / Hartwell commandery, prefecture and fu boundaries, or DataV GeoAtlas (Amap) modern province boundaries. Dynasty realms, the timeline, cities and people still work.';
    }
    const disclaimer = document.getElementById('txt-disclaimer');
    if (disclaimer && missing) {
      const mark = en ? 'Restricted administrative boundary layers' : '受限行政区划图层';
      if (!disclaimer.textContent.includes(mark)) {
        disclaimer.textContent += en
          ? ' Restricted administrative boundary layers are not included. Jiangshan Atlas (江山时序) · GPL-3.0 · https://github.com/DeanChensj/jiangshan-map'
          : zh(app, ' 本页不提供受限行政区划图层。江山时序 Jiangshan Atlas · GPL-3.0 · https://github.com/DeanChensj/jiangshan-map');
      }
    }
  }

  function boot() {
    const app = window.atlasApp;
    if (!app) return;
    if (!app._publicNoticeWrapped) {
      app._publicNoticeWrapped = true;
      const load = app._ensureFullSnapshots.bind(app);
      app._ensureFullSnapshots = function () {
        return load().then((snaps) => {
          apply();
          return snaps;
        });
      };
      const locale = app.applyLocale.bind(app);
      app.applyLocale = function () {
        const result = locale();
        apply();
        return result;
      };
    }
    apply();
  }

  // atlasApp is created on DOMContentLoaded, which is after deferred scripts.
  document.addEventListener('DOMContentLoaded', boot);
  setTimeout(boot, 0);
})();
