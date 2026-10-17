async (page) => {
  // Confirms the residual /trends desktop shift mechanism:
  //   heading row is `flex flex-wrap items-start`; the min-w-0 column + ShareLink toggle
  //   between two flex lines (one line) -> row height 179 vs 137.
  // Runs at 1280 twice: with the reserve CSS (fixed) and without (baseline).
  try { await page.unrouteAll({ behavior: 'ignoreErrors' }); } catch (e) {}

  const INIT = 'jobs/tier1-cls-diagnosis/scripts/cls-init.js';
  const CSS =
    '@media (max-width:639px){main > p.text-sm{min-height:4260px}}' +
    '@media (min-width:640px){main > p.text-sm{min-height:2295px}}' +
    'main > div > div.flex.flex-wrap.items-start > div.min-w-0 > p.mt-1{min-height:80px}';

  const PROBES = [
    { k: 'h1row', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start' },
    { k: 'h1col', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start > div.min-w-0' },
    { k: 'h1p', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start > div.min-w-0 > p.mt-1' },
    { k: 'share', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start > *:last-child', text: 40 },
    { k: 'colA', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start > div.min-w-0 > p.mt-1', text: 46 },
  ];

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
      o.docH = document.documentElement.scrollHeight;
      return o;
    };
    let last = '';
    const tick = () => {
      const f = fp();
      const k = JSON.stringify(f);
      if (k !== last && S.rows.length < 60) { last = k; S.rows.push({ t: Math.round(performance.now()), v: f }); }
      if (S.rows.length < 60) requestAnimationFrame(tick);
    };
    const start = () => requestAnimationFrame(tick);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  })();`;
  await page.addInitScript({ content: SAMPLER });
  await page.addInitScript({ path: INIT });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 900,
  });

  const out = [];
  for (const mode of ['baseline', 'fixed']) {
    const M = (url) => url.pathname === '/trends';
    const H = async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      if (mode === 'fixed') body = body.replace('</head>', '<style id="cls-fix">' + CSS + '</style></head>');
      await route.fulfill({ response: resp, body });
    };
    if (mode === 'fixed') await page.route(M, H);

    await cdp.send('Network.clearBrowserCache');
    await page.goto('https://off-market-radar-nyc.vercel.app/trends', { waitUntil: 'load' });
    await page.waitForTimeout(9000);
    const d = await page.evaluate(() => ({
      rows: window.__P.rows,
      clsRaw: window.__LS.clsRaw,
      shiftN: window.__LS.shifts.length,
      shiftPaths: window.__LS.shifts.map((s) => s.t + '|' + s.value + '|' + s.sources.map((x) => (x.node && x.node.path) || '').join('~')),
    }));

    out.push('## ' + mode + '  1280x900  clsRaw=' + d.clsRaw + ' shifts=' + d.shiftN);
    for (const p of d.shiftPaths) out.push('  shift ' + p);
    for (const r of d.rows) {
      const v = r.v;
      out.push('  t=' + r.t + ' docH=' + v.docH +
        ' h1row=' + JSON.stringify(v.h1row) +
        ' h1col=' + JSON.stringify(v.h1col) +
        ' h1p=' + JSON.stringify(v.h1p) +
        ' share=' + JSON.stringify(v.share));
    }
    if (mode === 'fixed') { try { await page.unroute(M, H); } catch (e) {} }
  }
  return 'TRES2<\n' + out.join('\n') + '\n>TRES2';
}
