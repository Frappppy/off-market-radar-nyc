async (page) => {
  // Resolves the residual /trends desktop shift: which element above the chart grid
  // shrinks 42 px between the loading and live states, with the reserve CSS applied.
  try { await page.unrouteAll({ behavior: 'ignoreErrors' }); } catch (e) {}

  const INIT = 'jobs/tier1-cls-diagnosis/scripts/cls-init.js';
  const CSS =
    '@media (max-width:639px){main > p.text-sm{min-height:4260px}}' +
    '@media (min-width:640px){main > p.text-sm{min-height:2295px}}' +
    'main > div > div.flex.flex-wrap.items-start > div.min-w-0 > p.mt-1{min-height:80px}';

  const M = (url) => url.pathname === '/trends';
  const H = async (route) => {
    const resp = await route.fetch();
    const body = (await resp.text()).replace('</head>', '<style id="cls-fix">' + CSS + '</style></head>');
    await route.fulfill({ response: resp, body });
  };
  await page.route(M, H);
  await page.addInitScript({ path: INIT });

  const PROBES = [
    { k: 'h1', sel: 'h1', text: 70 },
    { k: 'h1row', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start' },
    { k: 'h1col', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start > div.min-w-0' },
    { k: 'h1p', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start > div.min-w-0 > p.mt-1', text: 100 },
    { k: 'fallback', sel: 'main > p.text-sm', text: 60 },
    { k: 'grid', sel: 'main .grid.gap-3' },
    { k: 'kpidl', sel: 'main dl' },
    { k: 'foot', sel: 'footer' },
    { k: 'main', sel: 'main' },
  ];

  // sampler (self-contained; no external file needed)
  const SAMPLER = `(() => {
    const PROBES = ${JSON.stringify(PROBES)};
    const S = { rows: [] };
    window.__P = S;
    const fp = () => {
      const o = {};
      for (const p of PROBES) {
        const els = Array.from(document.querySelectorAll(p.sel)).slice(0, p.max || 1);
        if (!els.length) { o[p.k] = null; continue; }
        o[p.k] = els.map((el) => {
          const r = el.getBoundingClientRect();
          const v = [Math.round(r.y), Math.round(r.height), Math.round(r.width)];
          if (p.text) v.push((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, p.text));
          return v;
        });
      }
      o.doc = [document.documentElement.scrollHeight, window.innerHeight];
      return o;
    };
    let last = '';
    const tick = () => {
      const f = fp();
      const k = JSON.stringify(f);
      if (k !== last && S.rows.length < 120) { last = k; S.rows.push({ t: Math.round(performance.now()), v: f }); }
      if (S.rows.length < 120) requestAnimationFrame(tick);
    };
    const start = () => requestAnimationFrame(tick);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  })();`;
  await page.addInitScript({ content: SAMPLER });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });

  const out = {};
  for (const [w, h] of [[1280, 900], [1350, 940]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: h,
    });
    await cdp.send('Network.clearBrowserCache');
    await page.goto('https://off-market-radar-nyc.vercel.app/trends', { waitUntil: 'load' });
    await page.waitForTimeout(9000);
    const d = await page.evaluate(() => ({
      rows: window.__P.rows,
      cls: window.__LS ? { raw: window.__LS.clsRaw, shifts: window.__LS.shifts.length } : null,
      shiftDetail: window.__LS ? window.__LS.shifts.map((s) => ({ t: s.t, v: s.value, n: s.sources.length, s0: s.sources[0] && s.sources[0].node && s.sources[0].node.path })) : null,
      fix: !!document.getElementById('cls-fix'),
    }));
    out[w + 'x' + h] = d;
  }
  return 'TRES<' + JSON.stringify(out) + '>';
}
