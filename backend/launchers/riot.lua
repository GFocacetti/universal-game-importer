-- Riot Client: every installed game has an uninstall entry ("Riot Game <product>.<patchline>")
-- with its name, its folder and the Riot Client that manages it
local common = require("launchers.common")

local M = {
    id = "riot",
    name = "Riot Games",
    os = "windows",
}

local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'SilentlyContinue'
$roots = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
$seen = @{}
$out = foreach ($key in (Get-ChildItem $roots | Where-Object { $_.PSChildName -like 'Riot Game *' })) {
  $p = Get-ItemProperty $key.PSPath
  # "C:\Riot Games\Riot Client\RiotClientServices.exe" --uninstall-product=valorant --uninstall-patchline=live
  if ($p.UninstallString -notmatch '^"([^"]+)"\s.*--uninstall-product=(\S+)\s+--uninstall-patchline=(\S+)') { continue }
  $client, $product, $patchline = $Matches[1], $Matches[2], $Matches[3]
  $dir = ($p.InstallLocation -replace '/', '\').TrimEnd('\')
  if (-not $dir -or -not (Test-Path $dir) -or -not (Test-Path $client)) { continue }
  $id = "$product.$patchline"
  if ($seen[$id]) { continue }
  $seen[$id] = $true
  $name = if ($p.DisplayName) { $p.DisplayName } else { Split-Path $dir -Leaf }
  [PSCustomObject]@{ id = $id; name = $name; client = $client; product = $product; patchline = $patchline; path = $dir }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

function M.is_installed()
    local fs = require("fs")
    local data = require("utils").getenv("ProgramData") or [[C:\ProgramData]]
    return fs.exists(fs.join(data, "Riot Games", "RiotClientInstalls.json"))
end

function M.discover()
    local games = {}
    for _, g in ipairs(common.run_powershell_json("riot", SCAN_SCRIPT)) do
        local arguments = string.format("--launch-product=%s --launch-patchline=%s", g.product, g.patchline)
        games[#games + 1] = common.with_launch({
            id = "riot:" .. g.id,
            launcher = M.id,
            name = g.name,
            kind = "game",
        }, common.launch_through(g.client, arguments, g.path))
    end
    return games
end

return M
