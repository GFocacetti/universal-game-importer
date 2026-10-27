-- Amazon Games: installed games are in a SQLite database (read with common.SQLITE_READER)
local common = require("launchers.common")

local M = {
    id = "amazon",
    name = "Amazon Games",
    os = "windows",
    supports_path = true,
}

local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'Stop'
$db = Join-Path '__DATA__' 'Games\Sql\GameInstallInfo.sqlite'
if (-not (Test-Path $db)) { '[]'; return }
__SQLITE__
$rows = [UgiSqlite]::Query($db, 'SELECT Id, ProductTitle, InstallDirectory FROM DbSet WHERE Installed = 1', 3)
$out = foreach ($r in $rows) { if ($r[0] -and $r[1] -and $r[2]) { [PSCustomObject]@{ id = $r[0]; name = $r[1]; path = $r[2] } } }
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

local function data_dir(custom)
    local fs = require("fs")
    return custom or fs.join(require("utils").getenv("LOCALAPPDATA") or "", "Amazon Games", "Data")
end

function M.is_installed(custom)
    return require("fs").exists(require("fs").join(data_dir(custom), "Games", "Sql", "GameInstallInfo.sqlite"))
end

-- custom: another Amazon Games "Data" folder
function M.discover(custom)
    local dir = data_dir(custom):gsub("'", "''")
    local script = SCAN_SCRIPT:gsub("__SQLITE__", function() return common.SQLITE_READER end):gsub("__DATA__", function() return dir end)
    local games = {}
    for _, g in ipairs(common.run_powershell_json("amazon", script)) do
        games[#games + 1] = common.with_launch({
            id = "amazon:" .. g.id,
            launcher = M.id,
            name = g.name,
            kind = "game",
        }, common.launch_through("amazon-games://play/" .. g.id, nil, g.path))
    end
    return games
end

return M
