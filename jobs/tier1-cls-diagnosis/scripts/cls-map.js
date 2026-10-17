async (page) => {
  // @@META@@ route=/map nofonts=false tag=map
  const ROUTE = '/map';
  const BLOCK_FONTS = false;
  const TAG = 'map';
  const INIT = 'jobs/tier1-cls-diagnosis/scripts/cls-init.js';
  const combos = [
    [390, 844],
    [1280, 900],
    [1350, 940],
  ];
  const summary = {};
  await page.addInitScript({ path: INIT });
  if (BLOCK_FONTS) {
    await page.route((url) => /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url.pathname), (r) => r.abort());
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  for (const [w, h] of combos) {
    // Device emulation, not window resize: this is what actually changes layout width.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: w,
      screenHeight: h,
    });
    await cdp.send('Network.clearBrowserCache');
    const t0 = Date.now();
    await page.goto('https://off-market-radar-nyc.vercel.app' + ROUTE, { waitUntil: 'load' });
    await page.waitForTimeout(9000);
    const data = await page.evaluate(() => {
      const s = window.__LS;
      return {
        clsRaw: s.clsRaw,
        clsFiltered: s.clsFiltered,
        inputs: s.inputs,
        fcp: s.fcp,
        lcp: s.lcp,
        fontsReady: s.fontsReady,
        shiftCount: s.shifts.length,
        shifts: s.shifts,
        samples: s.samples,
        mutations: s.mutations,
        docH: document.documentElement.scrollHeight,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        mq1024: window.matchMedia('(min-width: 1024px)').matches,
        mq768: window.matchMedia('(min-width: 768px)').matches,
        mq640: window.matchMedia('(min-width: 640px)').matches,
      };
    });
    data.wallMs = Date.now() - t0;
    data.route = ROUTE;
    data.tag = TAG;
    data.blockFonts = BLOCK_FONTS;
    data.viewport = w + 'x' + h;
    await page.evaluate((d) => {
      const s = JSON.stringify(d);
      const CH = 6000;
      for (let i = 0; i < s.length; i += CH) {
        console.log('@@CLS@@' + d.tag + '@@' + d.viewport + '@@' + i + '@@' + s.slice(i, i + CH));
      }
      console.log('@@CLSEND@@' + d.tag + '@@' + d.viewport + '@@' + s.length);
    }, data);
    summary[w + 'x' + h] = {
      clsRaw: data.clsRaw,
      clsFiltered: data.clsFiltered,
      shiftCount: data.shiftCount,
      inputs: data.inputs.length,
      fcp: data.fcp,
      lcp: data.lcp,
      docH: data.docH,
      innerW: data.innerW,
      mq640: data.mq640,
      mq768: data.mq768,
      mq1024: data.mq1024,
      sampleRows: data.samples.length,
      mutationRows: data.mutations.length,
    };
  }
  return 'CLSSUMMARY<' + TAG + '>' + JSON.stringify(summary) + '</CLSSUMMARY>';
}
