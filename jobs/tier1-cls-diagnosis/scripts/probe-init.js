// Per-frame probe of specific selectors. Records a row only when the fingerprint changes.
(() => {
  const PROBES = window.__PROBE_CFG__ || [];
  const state = { rows: [], nav: null };
  window.__PROBE = state;
  const path = (el) => {
    if (!el || !el.tagName) return null;
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s;
  };
  const fingerprint = () => {
    const out = {};
    for (const p of PROBES) {
      const els = Array.from(document.querySelectorAll(p.sel)).slice(0, p.max || 1);
      if (els.length === 0) {
        out[p.k] = null;
        continue;
      }
      const rows = els.map((el) => {
        const r = el.getBoundingClientRect();
        const o = [Math.round(r.y), Math.round(r.height), Math.round(r.width)];
        if (p.text) {
          const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          o.push(txt.slice(0, p.text));
        }
        return o;
      });
      out[p.k] = rows.length === 1 ? rows[0] : rows;
    }
    out['doc'] = [document.documentElement.scrollHeight, window.innerHeight];
    out['fonts'] = document.fonts ? document.fonts.status : 'n/a';
    return out;
  };
  let last = '';
  let frames = 0;
  let lastT = 0;
  const tick = () => {
    frames++;
    const t = Math.round(performance.now());
    if (t - lastT >= 80) {
      lastT = t;
      const fp = fingerprint();
      const key = JSON.stringify(fp);
      if (key !== last && state.rows.length < 260) {
        last = key;
        state.rows.push({ t: t, v: fp });
      }
    }
    if (frames < 1500) requestAnimationFrame(tick);
  };
  const start = () => requestAnimationFrame(tick);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
