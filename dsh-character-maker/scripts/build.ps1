# dsh-character-maker build (Windows / no-bash fallback)
# 1) link build deps (installation layout: checkout/node_modules/@deepseek-ai)
# 2) compile host src/ -> lib/ with checkout tsc
# 3) drop host-compiled lib/client/ (replaced by the tsdown client bundle lib/client.js)
#
# NOTE: keep this file ASCII-only. A previous revision carried CJK comments whose
# byte sequence was mis-parsed by PowerShell as a block-comment opener, which
# silently swallowed the $winClient assignment line and crashed the cleanup step.
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

# -- checkout discovery --
$checkout = $env:DSH_CHECKOUT
if (-not $checkout) {
  $cands = @(
    (Join-Path $HOME 'dsh-harness'),
    (Join-Path $HOME 'dsh'),
    (Join-Path $HOME '.dsh\dsh-harness'),
    'F:\deepseek\DSH Desktop\dsh-desktop'
  )
  foreach ($c in $cands) {
    if (Test-Path (Join-Path $c 'node_modules\@deepseek-ai')) { $checkout = $c; break }
  }
}
if (-not $checkout -or -not (Test-Path (Join-Path $checkout 'node_modules\@deepseek-ai'))) {
  Write-Error "build: cannot locate dsh checkout (set DSH_CHECKOUT)"
}
$tsc = Join-Path $checkout 'node_modules\.bin\tsc.cmd'
if (-not (Test-Path $tsc)) { $tsc = Join-Path $checkout 'node_modules\.bin\tsc' }
if (-not (Test-Path $tsc)) { Write-Error "build: tsc not found under $checkout" }

function New-Junc($src, $dst) {
  if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
  cmd /c mklink /J "`"$dst`"" "`"$src`"" | Out-Null
}

Write-Host "=== Linking build deps (checkout: $checkout) ==="
$deps = @(
  'cordis','cosmokit','schemastery','dsh-tools','dsh-llm','dsh-system-prompt','dsh-host-webserver','dsh-client-ui-slots'
)
New-Item -ItemType Directory -Path (Join-Path $ROOT 'node_modules\@deepseek-ai') -Force | Out-Null
foreach ($d in $deps) {
  $src = Join-Path $checkout "node_modules\@deepseek-ai\$d"
  if (-not (Test-Path $src)) { Write-Warning "skip missing dep: $d"; continue }
  New-Junc $src (Join-Path $ROOT "node_modules\@deepseek-ai\$d")
}
$typesSrc = Join-Path $checkout 'node_modules\@types\node'
if (Test-Path $typesSrc) { New-Junc $typesSrc (Join-Path $ROOT 'node_modules\@types\node') }

Write-Host "=== Compiling host src -> lib ==="
& $tsc -p (Join-Path $ROOT 'tsconfig.json')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Host tsc also emits lib/client/*; the tsdown client bundle (lib/client.js) supersedes it.
$winClient = Join-Path $ROOT 'lib\client'
if ($winClient -and (Test-Path -LiteralPath $winClient)) {
  Remove-Item -LiteralPath $winClient -Recurse -Force
  Write-Host "=== Removed host-compiled lib/client ==="
}
Write-Host "=== Build complete ==="
