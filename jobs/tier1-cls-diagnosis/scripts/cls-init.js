// Read-only CLS instrumentation. Runs before any page script on every navigation.
// Records: raw layout-shift entries with resolved sources, real input events,
// paint/LCP/font timing, DOM mutations, and per-frame geometry samples.
(() => {
  const state = {
    navStart: Math.round(performance.timeOrigin),
    shifts: [],
    clsRaw: 0,
    clsFiltered: 0,
    fcp: null,
    lcp: null,
    realInputs: [],
    inputs: [],
    fontsReady: null,
    mutations: [],
    samples: [],
    ua: navigator.userAgent,
    dpr: window.devicePixelRatio,
    vw: window.innerWidth,
    vh: window.innerHeight,
  };
  window.__LS = state;
  window.__LS_DONE = false;

  const shortPath = (el) => {
    if (!el || !el.tagName) return '#' + (el && el.nodeName ? el.nodeName : 'null');
    const parts = [];
    let n = el;
    let depth = 0;
    while (n && n.tagName && depth < 4) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      else if (typeof n.className === 'string' && n.className.trim()) {
        const c = n.className.trim().split(/\s+/).slice(0, 3).join('.');
        if (c) s += '.' + c;
      }
      parts.unshift(s);
      n = n.parentElement;
      depth++;
    }
    return parts.join(' > ');
  };
  window.__shortPath = shortPath;

  const describe = (node) => {
    if (!node) return null;
    if (node.nodeType === 3) {
      const p = node.parentElement;
      return {
        textNode: true,
        path: shortPath(p),
        snippet: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      };
    }
    const el = node;
    let rect = null;
    try {
      const r = el.getBoundingClientRect();
      rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    } catch (e) {}
    return {
      path: shortPath(el),
      tag: el.tagName ? el.tagName.toLowerCase() : '',
      id: el.id || '',
      cls: typeof el.className === 'string' ? el.className.slice(0, 140) : '',
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      rect,
    };
  };
  window.__describe = describe;

  // ---- layout shift ----
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        state.shifts.push({
          t: Math.round(e.startTime),
          value: Number(e.value.toFixed(5)),
          hadRecentInput: e.hadRecentInput,
          lastInputTime: Math.round(e.lastInputTime || 0),
          sources: (e.sources || []).map((s) => ({
            prev: s.previousRect
              ? { x: Math.round(s.previousRect.x), y: Math.round(s.previousRect.y), w: Math.round(s.previousRect.width), h: Math.round(s.previousRect.height) }
              : null,
            cur: s.currentRect
              ? { x: Math.round(s.currentRect.x), y: Math.round(s.currentRect.y), w: Math.round(s.currentRect.width), h: Math.round(s.currentRect.height) }
              : null,
            node: describe(s.node),
          })),
        });
        state.clsRaw = Number((state.clsRaw + e.value).toFixed(5));
        if (!e.hadRecentInput) state.clsFiltered = Number((state.clsFiltered + e.value).toFixed(5));
      }
    });
    po.observe({ type: 'layout-shift', buffered: true });
  } catch (e) {
    state.obsError = String(e);
  }

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') state.fcp = Math.round(e.startTime);
    }).observe({ type: 'paint', buffered: true });
  } catch (e) {}

  try {
    new PerformanceObserver((l) => {
      const es = l.getEntries();
      const last = es[es.length - 1];
      if (last) state.lcp = Math.round(last.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}

  // ---- real input events (proves whether hadRecentInput is a real user) ----
  ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click', 'wheel'].forEach((t) => {
    window.addEventListener(
      t,
      (ev) => {
        if (state.inputs.length < 40) state.inputs.push({ type: t, t: Math.round(ev.timeStamp) });
      },
      true
    );
  });
  state.realInputs = state.inputs; // same array

  try {
    document.fonts.ready.then(() => {
      state.fontsReady = Math.round(performance.now());
    });
  } catch (e) {}

  // ---- DOM mutation log (bounded) ----
  const startMutations = () => {
  try {
    const MAXM = 800;
    const mo = new MutationObserver((recs) => {
      if (state.mutations.length >= MAXM) return;
      for (const r of recs) {
        const added = [];
        for (const n of r.addedNodes) added.push(n.tagName ? shortPath(n) : '#text');
        const info = {
          t: Math.round(r.timeStamp),
          type: r.type,
          target: shortPath(r.target),
          added: added.slice(0, 8),
          addedN: r.addedNodes.length,
          removedN: r.removedNodes.length,
          attr: r.attributeName || null,
        };
        if (info.addedN || info.removedN || (r.type === 'attributes' && /^(class|style)$/.test(r.attributeName || '')))
          state.mutations.push(info);
        if (state.mutations.length >= MAXM) {
          mo.disconnect();
          return;
        }
      }
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  } catch (e) {
    state.mutationError = String(e);
  }
  };

  // ---- per-frame geometry sampler (only records changes) ----
  const start = () => {
    state.mutationsStarted = true;
    startMutations();
    const lastSeen = new Map();
    let frames = 0;
    const tick = () => {
      frames++;
      const els = [];
      const push = (el) => {
        if (el && els.indexOf(el) === -1) els.push(el);
      };
      push(document.querySelector('header'));
      push(document.querySelector('main'));
      push(document.querySelector('footer'));
      document.querySelectorAll('main > div > *').forEach(push);
      document.querySelectorAll('.panel').forEach(push);
      const now = {};
      for (const el of els) {
        const r = el.getBoundingClientRect();
        now[shortPath(el)] = [Math.round(r.y), Math.round(r.height), Math.round(r.width)];
      }
      const changed = {};
      let any = false;
      for (const k of Object.keys(now)) {
        const prev = lastSeen.get(k);
        const cur = now[k];
        if (!prev || prev[0] !== cur[0] || prev[1] !== cur[1] || prev[2] !== cur[2]) {
          changed[k] = cur;
          lastSeen.set(k, cur);
          any = true;
        }
      }
      for (const k of Array.from(lastSeen.keys())) if (!(k in now)) lastSeen.delete(k);
      if (any && state.samples.length < 900) {
        state.samples.push({
          t: Math.round(performance.now()),
          doc: [document.documentElement.scrollHeight, window.innerHeight],
          changed,
        });
      }
      if (frames < 900) requestAnimationFrame(tick);
      else window.__LS_DONE = true;
    };
    requestAnimationFrame(tick);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
