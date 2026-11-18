$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $projectPath '.env.docker'

if (Test-Path -LiteralPath $environmentPath) {
    $existing = Get-Content -Raw -LiteralPath $environmentPath
    if ($existing -notmatch '(?m)^JWT_SECRET=([^\r\n]{32,})\r?$') {
        throw 'Isi JWT_SECRET di .env.docker dengan string acak minimal 32 karakter.'
    }
    Write-Output 'Konfigurasi .env.docker sudah tersedia.'
    exit 0
}

$secretBytes = New-Object byte[] 32
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $generator.GetBytes($secretBytes)
} finally {
    $generator.Dispose()
}
$secret = [BitConverter]::ToString($secretBytes).Replace('-', '').ToLowerInvariant()
$template = Get-Content -Raw -LiteralPath (Join-Path $projectPath '.env.docker.example')
$content = $template -replace '(?m)^JWT_SECRET=\r?$', ('JWT_SECRET=' + $secret)
$encoding = New-Object Text.UTF8Encoding($false)
$stream = [IO.File]::Open($environmentPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
    $bytes = $encoding.GetBytes($content)
    $stream.Write($bytes, 0, $bytes.Length)
} finally {
    $stream.Dispose()
}
Write-Output 'File .env.docker dibuat dengan JWT_SECRET acak. Jalankan docker compose up --build -d.'
