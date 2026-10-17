async (page) => {
  const ROUTE = '/';
  const INIT = 'jobs/tier1-cls-diagnosis/scripts/cls-init.js';
  const BLOCK_FONTS = false;
  const combos = [
    [390, 844],
    [1280, 900],
    [1350, 940],
  ];
  const out = {};
  await page.addInitScript({ path: INIT });
  if (BLOCK_FONTS) {
    await page.route((url) => /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url.pathname), (r) => r.abort());
  }
  const cdp = await page.context().newCDPSession(page);
  for (const [w, h] of combos) {
    await page.setViewportSize({ width: w, height: h });
    await cdp.send('Network.clearBrowserCache');
    const t0 = Date.now();
    await page.goto('https://off-market-radar-nyc.vercel.app' + ROUTE, { waitUntil: 'load' });
    await page.waitForTimeout(10000);
    const data = await page.evaluate(() => {
      const s = window.__LS;
      return {
        clsRaw: s.clsRaw,
        clsFiltered: s.clsFiltered,
        inputs: s.inputs,
        fcp: s.fcp,
        lcp: s.lcp,
        fontsReady: s.fontsReady,
        vw: s.vw,
        vh: s.vh,
        dpr: s.dpr,
        shiftCount: s.shifts.length,
        shifts: s.shifts,
        samples: s.samples,
        mutations: s.mutations,
      };
    });
    data.wallMs = Date.now() - t0;
    data.route = ROUTE;
    data.blockFonts = BLOCK_FONTS;
    out[w + 'x' + h] = data;
  }
  return 'CLSJSON<' + JSON.stringify(out) + '>CLSJSON';
}
