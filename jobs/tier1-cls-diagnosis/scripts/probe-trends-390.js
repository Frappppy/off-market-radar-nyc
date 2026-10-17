async (page) => {
  // @@PROBE@@ route=/trends vp=390x844
  const ROUTE = '/trends';
  const VP = [390, 844];
  const PROBES = [{"k":"h1block","sel":"main > div.space-y-4 > div.flex.flex-wrap.items-start"},{"k":"h1copy","sel":"main > div.space-y-4 > div.flex.flex-wrap.items-start > div.min-w-0 > p.mt-1","text":130},{"k":"sharelink","sel":"main > div.space-y-4 > div.flex.flex-wrap.items-start > div.ml-auto"},{"k":"kpidl","sel":"main > div.space-y-4 > dl.grid"},{"k":"kpicells","sel":"main > div.space-y-4 > dl.grid > div","max":8},{"k":"health","sel":"main > div.space-y-4 > section.panel.p-3"},{"k":"healthHead","sel":"main > div.space-y-4 > section.panel.p-3 > div.flex.flex-wrap"},{"k":"healthDl","sel":"main > div.space-y-4 > section.panel.p-3 > dl"},{"k":"healthCells","sel":"main > div.space-y-4 > section.panel.p-3 > dl > div","max":6},{"k":"healthVal","sel":"main > div.space-y-4 > section.panel.p-3 > dl > div > dd.truncate","max":6,"text":40},{"k":"healthNote","sel":"main > div.space-y-4 > section.panel.p-3 > dl > div > dd.line-clamp-2","max":6,"text":60},{"k":"healthFoot","sel":"main > div.space-y-4 > section.panel.p-3 > p"},{"k":"charts","sel":"main > div.space-y-4 > div.grid.gap-3"},{"k":"topTable","sel":"main > div.space-y-4 > section.panel.p-4"},{"k":"footer","sel":"footer"},{"k":"main","sel":"main"}];
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
