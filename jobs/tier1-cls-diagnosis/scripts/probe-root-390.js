async (page) => {
  // @@PROBE@@ route=/ vp=390x844
  const ROUTE = '/';
  const VP = [390, 844];
  const PROBES = [{"k":"hero","sel":"main > div.space-y-4 > section.panel"},{"k":"eyebrow","sel":"main > div.space-y-4 > section.panel > p.eyebrow","text":60},{"k":"h1","sel":"main > div.space-y-4 > section.panel > h1","text":90},{"k":"intro","sel":"main > div.space-y-4 > section.panel > p.mt-3","text":90},{"k":"scope","sel":"main > div.space-y-4 > section.panel > p.mt-2","text":90},{"k":"ctas","sel":"main > div.space-y-4 > section.panel > div.mt-4"},{"k":"kpidl","sel":"main > div.space-y-4 > section.panel > dl"},{"k":"kpicells","sel":"main > div.space-y-4 > section.panel > dl > div","max":8},{"k":"kpival","sel":"main > div.space-y-4 > section.panel > dl > div > dd","max":12,"text":30},{"k":"explorer","sel":"main > div.space-y-4 > div.space-y-3"},{"k":"fallback","sel":"main > div.space-y-4 > p.text-sm","text":40},{"k":"toolbar","sel":"main > div.space-y-4 > div.space-y-3 > div.panel"},{"k":"showcount","sel":"main > div.space-y-4 > div.space-y-3 > div.panel > span.text-xs","max":3,"text":40},{"k":"map","sel":"main > div.space-y-4 > div.space-y-3 > div.overflow-hidden"},{"k":"insights","sel":"main > div.space-y-4 > section.grid"},{"k":"footer","sel":"footer"},{"k":"main","sel":"main"}];
  await page.addInitScript({ path: 'jobs/tier1-cls-diagnosis/scripts/probe-init.js' });
  await page.addInitScript((probes) => {
    window.__PROBE_CFG__ = probes;
  }, PROBES);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VP[0], height: VP[1], deviceScaleFactor: 1, mobile: false, screenWidth: VP[0], screenHeight: VP[1],
  });
  await cdp.send('Network.clearBrowserCache');
  await page.goto('https://off-market-radar-nyc.vercel.app' + ROUTE, { waitUntil: 'load' });
  await page.waitForTimeout(9000);
  const rows = await page.evaluate(() => window.__PROBE.rows);
  return 'PROBEJSON<' + JSON.stringify(rows) + '>PROBEJSON';
}
