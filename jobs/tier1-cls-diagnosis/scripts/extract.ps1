param(
  [Parameter(Mandatory=$true)][string]$Log,
  [Parameter(Mandatory=$true)][string]$Out,
  [Parameter(Mandatory=$true)][string]$Tag
)
# Reassemble @@CLS@@<tag>@@<viewport>@@<offset>@@<chunk> console lines (playwright log
# format: "[LOG] " prefix and " @ :N" source suffix) into JSON per viewport.
$lines = [System.IO.File]::ReadAllLines($Log)
$buf = @{}
foreach ($ln in $lines) {
  $idx = $ln.IndexOf('@@CLS@@')
  if ($idx -lt 0) { continue }
  $rest = $ln.Substring($idx + 7)
  $rest = [System.Text.RegularExpressions.Regex]::Replace($rest, '\s@\s*:?\d+$', '')
  $parts = $rest -split '@@'
  if ($parts.Count -lt 4) { continue }
  $t = $parts[0]
  if ($t -ne $Tag) { continue }
  $vp = $parts[1]
  $off = [int]$parts[2]
  $chunk = ($parts[3..($parts.Count-1)] -join '@@')
  $key = "$t|$vp"
  if (-not $buf.ContainsKey($key)) { $buf[$key] = @{ } }
  $buf[$key][$off] = $chunk
}
$result = @{}
foreach ($key in ($buf.Keys | Sort-Object)) {
  $vp = $key.Split('|')[1]
  $offs = ($buf[$key].Keys | Sort-Object)
  $sb = New-Object System.Text.StringBuilder
  foreach ($o in $offs) { [void]$sb.Append($buf[$key][$o]) }
  $json = $sb.ToString()
  try { $obj = $json | ConvertFrom-Json } catch {
    Write-Output ("PARSE FAIL " + $vp + ": " + $_.Exception.Message); continue
  }
  $result[$vp] = $obj
}
$json2 = ([PSCustomObject]$result) | ConvertTo-Json -Depth 40 -Compress
[System.IO.File]::WriteAllText($Out, $json2)
Write-Output ("WROTE " + $Out + " bytes=" + $json2.Length + " viewports=" + (($result.Keys | Sort-Object) -join ','))
