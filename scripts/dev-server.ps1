param([int]$Port = 5500)

$root = (Resolve-Path "$PSScriptRoot\..").Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Sirviendo $root en http://localhost:$Port/"

$mimeMap = @{
    ".html" = "text/html"; ".js" = "application/javascript"; ".css" = "text/css"
    ".json" = "application/json"; ".png" = "image/png"; ".svg" = "image/svg+xml"
    ".ico" = "image/x-icon"
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $reqPath = $context.Request.Url.LocalPath
    if ($reqPath -eq "/") { $reqPath = "/login.html" }
    $filePath = Join-Path $root ($reqPath.TrimStart("/"))

    if (Test-Path $filePath -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($filePath)
        $contentType = $mimeMap[$ext]
        if (-not $contentType) { $contentType = "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $context.Response.ContentType = $contentType
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $context.Response.StatusCode = 404
    }
    $context.Response.OutputStream.Close()
}
