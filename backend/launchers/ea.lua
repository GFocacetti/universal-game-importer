-- EA app (and Origin): each game folder has __Installer\installerdata.xml with title and content id
-- Approach derived from Steam ROM Manager's EA Desktop parser (GPL-3.0)
local common = require("launchers.common")

local M = {
    id = "ea",
    name = "EA",
    os = "windows",
}

local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'SilentlyContinue'
$roots = @("$env:ProgramFiles\EA Games", "${env:ProgramFiles(x86)}\EA Games", "${env:ProgramFiles(x86)}\Origin Games") |
  Where-Object { Test-Path $_ } | Select-Object -Unique
$out = foreach ($root in $roots) {
  foreach ($dir in (Get-ChildItem -LiteralPath $root -Directory)) {
    $file = Join-Path $dir.FullName '__Installer\installerdata.xml'
    if (-not (Test-Path $file)) { continue }
    try { [xml]$x = Get-Content -LiteralPath $file -Raw } catch { continue }
    $m = $x.DocumentElement
    $title = @($m.gameTitles.gameTitle | Where-Object { $_.locale -eq 'en_US' })[0].'#text'
    if (-not $title) { $title = @($m.gameTitles.gameTitle)[0].'#text' }
    if (-not $title) { $title = @($m.metadata.localeInfo.title)[0] }
    if (-not $title) { $title = $dir.Name }
    $content = @($m.contentIDs.contentID)[0]
    if ($content) {
      [PSCustomObject]@{ name = [string]$title; content = [string]$content; path = $dir.FullName }
    }
  }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

function M.discover()
    local games = {}
    for _, g in ipairs(common.run_powershell_json("ea", SCAN_SCRIPT)) do
        games[#games + 1] = common.with_launch({
            id = "ea:" .. g.content,
            launcher = M.id,
            name = g.name,
            kind = "game",
        }, common.launch_through("origin2://game/launch?offerIds=" .. g.content, nil, g.path))
    end
    return games
end

return M
