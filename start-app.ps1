param(
  [int]$Port = 8765,
  [switch]$NoOpen
)

$Root = Join-Path $PSScriptRoot "app"
$Prefix = "http://localhost:$Port/"

$MimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
}

$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add($Prefix)
$Listener.Start()
Write-Host "MoneyFlow running at $Prefix (Press Ctrl+C to stop)"

if (-not $NoOpen) {
  Start-Process $Prefix
}

try {
  while ($Listener.IsListening) {
    $Ctx = $Listener.GetContext()
    $Rel = $Ctx.Request.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($Rel)) { $Rel = "index.html" }
    $Rel = $Rel -replace '/', '\'
    $FilePath = [System.IO.Path]::GetFullPath((Join-Path $Root $Rel))

    if (-not $FilePath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $FilePath -PathType Leaf)) {
      $Ctx.Response.StatusCode = 404
      $Ctx.Response.Close()
      continue
    }

    $Ext = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
    $Ctx.Response.ContentType = if ($MimeTypes.ContainsKey($Ext)) { $MimeTypes[$Ext] } else { "application/octet-stream" }
    $Bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $Ctx.Response.ContentLength64 = $Bytes.Length
    $Ctx.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Ctx.Response.OutputStream.Close()
  }
} finally {
  $Listener.Stop()
}
