-- Ubisoft Connect: installed games are listed in the registry (Launcher\Installs\<id>),
-- their names in the uninstall entries the launcher writes ("Uplay Install <id>")
local common = require("launchers.common")

local M = {
    id = "ubisoft",
    name = "Ubisoft Connect",
    os = "windows",
}

local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'SilentlyContinue'
$root = 'HKLM:\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs'
$uninstall = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
$out = foreach ($key in (Get-ChildItem $root)) {
  $id = $key.PSChildName
  $dir = (Get-ItemProperty $key.PSPath).InstallDir
  if (-not $dir) { continue }
  $dir = ($dir -replace '/', '\').TrimEnd('\')
  if (-not (Test-Path $dir)) { continue }
  $name = (Get-ItemProperty "$uninstall\Uplay Install $id").DisplayName
  if (-not $name) { $name = Split-Path $dir -Leaf }
  [PSCustomObject]@{ id = $id; name = $name; path = $dir }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

function M.is_installed()
    local out = require("utils").exec('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher" /v InstallDir')
    return out ~= nil and not out:find("ERROR")
end

function M.discover()
    local games = {}
    for _, g in ipairs(common.run_powershell_json("ubisoft", SCAN_SCRIPT)) do
        games[#games + 1] = common.with_launch({
            id = "ubisoft:" .. g.id,
            launcher = M.id,
            name = g.name,
            kind = "game",
        }, common.launch_through("uplay://launch/" .. g.id .. "/0", nil, g.path))
    end
    return games
end

return M
