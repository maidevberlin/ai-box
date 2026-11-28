# Tinkerlings for Windows, in one line (in PowerShell):
#
#   irm https://raw.githubusercontent.com/maidevberlin/tinkerlings/main/install.ps1 | iex
#
# Puts Tinkerlings and the Node it runs on into %USERPROFILE%\.tinkerlings (nothing else on the
# computer is touched, and no admin rights are needed), then starts it and opens it in the
# browser. Run again, it updates Tinkerlings to the newest version and starts it. "Tinkerlings"
# on the desktop does the same with a double click.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # (the progress bar makes downloads many times slower)
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $Repo = 'maidevberlin/tinkerlings'
  $Port = if ($env:PORT) { $env:PORT } else { 8765 }
  $Url = "http://127.0.0.1:$Port"
  $Box = Join-Path $env:USERPROFILE '.tinkerlings'
  $App = Join-Path $Box 'app'
  $NodeDir = Join-Path $Box 'node'
  $Node = Join-Path $NodeDir 'node.exe'

  function Say($text) { Write-Host "`n$text" -ForegroundColor Cyan }
  function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
  function Running { try { Invoke-WebRequest "$Url/api/worlds" -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }
  # Downloads a zip and unpacks what is in its one folder to `$to`.
  function Unzip($from, $to) {
    $zip = Join-Path $env:TEMP "tinkerlings-$([guid]::NewGuid()).zip"
    $out = "$zip-out"
    Invoke-WebRequest $from -OutFile $zip -UseBasicParsing
    Expand-Archive $zip $out -Force
    Remove-Item $to -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item (Get-ChildItem $out | Select-Object -First 1).FullName $to
    Remove-Item $zip, $out -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (Running) {
    Say 'Tinkerlings is running already: opening it.'
    Start-Process $Url
    return
  }
  New-Item -ItemType Directory -Force $Box | Out-Null

  # ---- Node: the newest long-term version, its own copy
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $wanted = try { (Invoke-RestMethod https://nodejs.org/dist/index.json | Where-Object { $_.lts } | Select-Object -First 1).version } catch { $null }
  $have = if (Test-Path $Node) { & $Node --version } else { $null }
  if ($wanted -and $wanted -ne $have) {
    Say "Getting Node $wanted..."
    Unzip "https://nodejs.org/dist/$wanted/node-$wanted-win-$arch.zip" $NodeDir
  }
  if (-not (Test-Path $Node)) { Fail 'Node could not be downloaded. Is this computer online?' }
  $env:Path = "$NodeDir;$env:Path"

  # ---- Tinkerlings itself: the newest version. Its runs stay.
  Say 'Getting the newest Tinkerlings...'
  $new = "$App.new"
  try {
    Unzip "https://codeload.github.com/$Repo/zip/refs/heads/main" $new
    foreach ($kept in 'runs', 'node_modules') {
      if (Test-Path (Join-Path $App $kept)) { Move-Item (Join-Path $App $kept) $new }
    }
    Remove-Item $App -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item $new $App
    Push-Location $App
    & $Node (Join-Path $NodeDir 'node_modules\npm\bin\npm-cli.js') install --omit=dev --no-fund --no-audit --no-update-notifier --loglevel=error
    $installed = $LASTEXITCODE -eq 0
    Pop-Location
    if (-not $installed) { Fail "Tinkerlings' parts could not be installed." }
    Copy-Item (Join-Path $App 'install.ps1') (Join-Path $Box 'install.ps1') -Force
  } catch {
    if (-not (Test-Path (Join-Path $App 'node_modules'))) { Fail 'Tinkerlings could not be downloaded. Is this computer online?' }
    Say 'The newest version could not be fetched: starting the one that is here.'
  }

  # ---- A double click on the desktop starts it from now on.
  $desktop = [Environment]::GetFolderPath('Desktop')
  $link = Join-Path $desktop 'Tinkerlings.lnk'
  if ($desktop -and -not (Test-Path $link)) {
    try {
      $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
      $shortcut.TargetPath = 'powershell.exe'
      $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Box 'install.ps1')`""
      $shortcut.Save()
    } catch { }
  }

  # ---- Start, and open it once it answers. It runs as long as this window is open.
  Say 'Starting Tinkerlings. Keep this window open while you use it: closing it, or Ctrl+C, ends Tinkerlings.'
  $server = Start-Process $Node -ArgumentList 'src/viewer/server.ts' -WorkingDirectory $App -NoNewWindow -PassThru
  $tries = 0
  while (-not (Running)) {
    if ($server.HasExited -or ++$tries -gt 120) { Fail 'Tinkerlings did not start.' }
    Start-Sleep -Milliseconds 500
  }
  Start-Process $Url
  Say "Tinkerlings is at $Url"
  $server.WaitForExit()
}
