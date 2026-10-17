async (page) => {
  // @@PROBE@@ route=/map vp=390x844
  const ROUTE = '/map';
  const VP = [390, 844];
  const PROBES = [{"k":"head","sel":"main > div.space-y-3 > div.flex.flex-wrap.items-end"},{"k":"shown","sel":"main > div.space-y-3 > div.flex.flex-wrap.items-end > p.ml-auto","text":60},{"k":"grid","sel":"main > div.space-y-3 > div.grid"},{"k":"aside","sel":"main > div.space-y-3 > div.grid > div.lg\\:sticky > aside"},{"k":"mapwrap","sel":"main > div.space-y-3 > div.grid > div.relative > div.overflow-hidden"},{"k":"footer","sel":"footer"},{"k":"main","sel":"main"}];
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
