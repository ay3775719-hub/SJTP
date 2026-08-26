param(
  [Parameter(Mandatory = $true)][string]$Helper,
  [Parameter(Mandatory = $true)][string]$LibraryOriginals
)

Add-Type -AssemblyName System.Windows.Forms

$files = @(Get-ChildItem -LiteralPath $LibraryOriginals -File -Recurse |
  Where-Object { $_.Extension -in '.jpg', '.jpeg', '.png' } |
  Select-Object -First 2)
if ($files.Count -lt 2) { throw 'Two test images are required' }

$multi = ($files | ForEach-Object {
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.FullName))
}) -join "`n"
$multi | & $Helper | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Multi-file clipboard helper failed: $LASTEXITCODE" }
$multiDrop = [Windows.Forms.Clipboard]::GetFileDropList()
if ($multiDrop.Count -ne 2) { throw "Expected 2 clipboard files, got $($multiDrop.Count)" }

$single = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($files[0].FullName))
$single | & $Helper | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Single-file clipboard helper failed: $LASTEXITCODE" }
$singleDrop = [Windows.Forms.Clipboard]::GetFileDropList()
$image = [Windows.Forms.Clipboard]::GetImage()
if ($singleDrop.Count -ne 1) { throw "Expected 1 clipboard file, got $($singleDrop.Count)" }
if ($null -eq $image) { throw 'Expected bitmap clipboard format' }

[PSCustomObject]@{
  MultiFileDropCount = $multiDrop.Count
  SingleFileDropCount = $singleDrop.Count
  SingleBitmap = $true
  BitmapWidth = $image.Width
  BitmapHeight = $image.Height
  Filename = [IO.Path]::GetFileName($singleDrop[0])
} | Format-List
$image.Dispose()
