async (page) => {
  // @@PROBE@@ route=__ROUTE__ vp=__VP__
  const ROUTE = '__ROUTE__';
  const VP = [__W__, __H__];
  const PROBES = __PROBES__;
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
