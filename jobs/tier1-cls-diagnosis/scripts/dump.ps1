param([string]$Dir)
$files = @('cls-root.json','cls-map.json','cls-data.json','cls-trends.json')
foreach ($f in $files) {
  $p = Join-Path $Dir $f
  if (-not (Test-Path -LiteralPath $p)) { continue }
  Write-Output ("##### " + $f)
  $j = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json
  foreach ($vp in ($j.PSObject.Properties.Name | Sort-Object)) {
    $d = $j.$vp
    Write-Output ("== {0}  clsRaw={1} shifts={2} inputs={3} fcp={4} docH={5}" -f $vp, $d.clsRaw, $d.shiftCount, $d.inputs, $d.fcp, $d.docH)
    $i = 0
    foreach ($s in $d.shifts) {
      $i++
      Write-Output ("  [{0}] t={1} v={2} hadInput={3}" -f $i, $s.t, $s.value, $s.hadRecentInput)
      $n = 0
      foreach ($src in $s.sources) {
        $n++
        if ($n -gt 5) { Write-Output "        ..."; break }
        $p0 = if ($src.prev) { "[{0},{1} {2}x{3}]" -f $src.prev.x,$src.prev.y,$src.prev.w,$src.prev.h } else { "null" }
        $c0 = if ($src.cur)  { "[{0},{1} {2}x{3}]" -f $src.cur.x,$src.cur.y,$src.cur.w,$src.cur.h } else { "null" }
        $nm = if ($src.node) { if ($src.node.textNode) { "TEXT " + $src.node.path } else { $src.node.path } } else { "?" }
        Write-Output ("        prev={0} cur={1}  {2}" -f $p0, $c0, $nm)
      }
    }
  }
}
