-- EA app (and Origin): each game folder has __Installer\installerdata.xml with title and content id
-- Approach derived from Steam ROM Manager's EA Desktop parser (GPL-3.0)
local common = require("launchers.common")

local M = {
    id = "ea",
    name = "EA",
    os = "windows",
    supports_path = true,
}

-- __AUTO__ also looks where EA app says games are: its download folder and the games it registered
local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(__ROOTS__)
$dirs = @()
if (__AUTO__) {
  foreach ($ini in (Get-ChildItem "$env:LOCALAPPDATA\Electronic Arts\EA Desktop" -Filter 'user_*.ini')) {
    $roots += @(Select-String -LiteralPath $ini.FullName -Pattern '^user\.downloadinplacedir=(.+)$' |
      ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() })
  }
  $uninstall = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  $dirs += @(Get-ChildItem $uninstall | ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.UninstallString -like '*EAInstaller*' -and $_.InstallLocation } |
    ForEach-Object { $_.InstallLocation })
}
foreach ($root in ($roots | Where-Object { $_ -and (Test-Path -LiteralPath $_) })) {
  $dirs += @(Get-ChildItem -LiteralPath $root -Directory | ForEach-Object { $_.FullName })
}
$dirs = @($dirs | ForEach-Object { $_.TrimEnd('\') } | Sort-Object -Unique)
$out = foreach ($dir in $dirs) {
  $file = Join-Path $dir '__Installer\installerdata.xml'
  if (-not (Test-Path -LiteralPath $file)) { continue }
  try { [xml]$x = Get-Content -LiteralPath $file -Raw } catch { continue }
  $m = $x.DocumentElement
  $title = @($m.gameTitles.gameTitle | Where-Object { $_.locale -eq 'en_US' })[0].'#text'
  if (-not $title) { $title = @($m.gameTitles.gameTitle)[0].'#text' }
  if (-not $title) { $title = @($m.metadata.localeInfo.title)[0] }
  if (-not $title) { $title = Split-Path $dir -Leaf }
  $content = @($m.contentIDs.contentID)[0]
  if ($content) {
    [PSCustomObject]@{ name = [string]$title; content = [string]$content; path = $dir }
  }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

local DEFAULT_ROOTS = [["$env:ProgramFiles\EA Games", "${env:ProgramFiles(x86)}\EA Games", "${env:ProgramFiles(x86)}\Origin Games"]]

function M.is_installed(custom)
    local fs = require("fs")
    if custom then return fs.exists(custom) end
    local out = require("utils").exec('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Electronic Arts\\EA Desktop" /v ClientPath')
    if out ~= nil and not out:find("ERROR") then return true end
    local pf = require("utils").getenv("ProgramFiles") or [[C:\Program Files]]
    local pf86 = require("utils").getenv("ProgramFiles(x86)") or [[C:\Program Files (x86)]]
    return fs.exists(fs.join(pf, "EA Games")) or fs.exists(fs.join(pf86, "EA Games")) or fs.exists(fs.join(pf86, "Origin Games"))
end

-- custom: another folder that contains the EA game folders (then only that one is searched)
function M.discover(custom)
    local roots = custom and ("'" .. custom:gsub("'", "''") .. "'") or DEFAULT_ROOTS
    local script = SCAN_SCRIPT:gsub("__ROOTS__", function() return roots end)
        :gsub("__AUTO__", custom and "$false" or "$true")
    local games = {}
    for _, g in ipairs(common.run_powershell_json("ea", script)) do
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
