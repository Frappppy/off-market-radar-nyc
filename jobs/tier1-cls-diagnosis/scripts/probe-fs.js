async (page) => {
  const info = { cwd: null, fsOk: false, err: null };
  try {
    info.cwd = process.cwd();
    const fs = require('fs');
    fs.writeFileSync('C:/Users/omisg/AppData/Local/Temp/opencode/fs-probe.txt', 'fs-write-ok');
    info.fsOk = true;
  } catch (e) {
    info.err = String(e);
  }
  return JSON.stringify(info);
}