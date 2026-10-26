-- GOG: games installed with GOG Galaxy or the offline installers register themselves in the registry
local common = require("launchers.common")

local M = {
    id = "gog",
    name = "GOG",
    os = "windows",
}

local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'SilentlyContinue'
$root = 'HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games'
$galaxy = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\GOG.com\GalaxyClient\paths').client
$galaxyExe = if ($galaxy) { Join-Path $galaxy 'GalaxyClient.exe' } else { $null }
$out = foreach ($key in (Get-ChildItem $root)) {
  $g = Get-ItemProperty $key.PSPath
  if ($g.gameID -and $g.gameName -and $g.path -and -not $g.dependsOn) {
    [PSCustomObject]@{
      id = [string]$g.gameID
      name = $g.gameName
      path = $g.path
      exe = $g.exe
      params = $g.launchParam
      galaxy = if ($galaxyExe -and (Test-Path $galaxyExe)) { $galaxyExe } else { $null }
    }
  }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

function M.is_installed()
    local out = require("utils").exec('reg query "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com" /ve')
    return out ~= nil and not out:find("ERROR")
end

function M.discover()
    local games = {}
    for _, g in ipairs(common.run_powershell_json("gog", SCAN_SCRIPT)) do
        local launch
        if g.galaxy then
            launch = common.launch_through(g.galaxy, string.format('/command=runGame /gameId=%s /path="%s"', g.id, g.path), g.path)
        elseif g.exe then
            -- GOG games are DRM-free: without Galaxy they start directly
            launch = common.launch_through(g.exe, g.params, g.path)
        end
        if launch then
            games[#games + 1] = common.with_launch({
                id = "gog:" .. g.id,
                launcher = M.id,
                name = g.name,
                kind = "game",
            }, launch)
        end
    end
    return games
end

return M
