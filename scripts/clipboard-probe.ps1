Add-Type -AssemblyName System.Windows.Forms

$files = [System.Windows.Forms.Clipboard]::GetFileDropList()
$image = [System.Windows.Forms.Clipboard]::GetImage()

$result = [ordered]@{
  FileDropCount = $files.Count
  Files = @($files)
  HasImage = $null -ne $image
  ImageWidth = if ($null -ne $image) { $image.Width } else { 0 }
  ImageHeight = if ($null -ne $image) { $image.Height } else { 0 }
}

if ($null -ne $image) {
  $image.Dispose()
}

$result | ConvertTo-Json -Depth 3
