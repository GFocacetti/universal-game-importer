-- itch.io: games installed with the itch app are in its SQLite database (read with common.SQLITE_READER).
-- itch.io games are DRM-free: they start directly, with the executable the itch app found in the install folder.
local common = require("launchers.common")

local M = {
    id = "itch",
    name = "itch.io",
    os = "windows",
}

-- One row per installed game ("cave"); the "verdict" lists the executables found in the folder.
-- Games without a Windows executable (archives left to extract, browser games) are left out.
local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'Stop'
$db = Join-Path $env:APPDATA 'itch\db\butler.db'
if (-not (Test-Path $db)) { '[]'; return }
__SQLITE__
$sql = "SELECT g.id, g.title, g.classification, c.verdict, COALESCE(NULLIF(c.custom_install_folder, ''), l.path || '\' || c.install_folder_name) FROM caves c JOIN games g ON g.id = c.game_id LEFT JOIN install_locations l ON l.id = c.install_location_id"
$out = foreach ($r in [UgiSqlite]::Query($db, $sql, 5)) {
  $verdict = $null
  try { $verdict = $r[3] | ConvertFrom-Json } catch {}
  $base = if ($verdict.basePath) { $verdict.basePath } else { $r[4] }
  $exes = @($verdict.candidates | Where-Object { $_.flavor -eq 'windows' })
  # 64-bit first when the game ships both
  $exe = @($exes | Where-Object { $_.arch -eq 'amd64' }) + $exes | Select-Object -First 1
  if ($r[0] -and $r[1] -and $base -and $exe) {
    $path = Join-Path $base $exe.path
    if (Test-Path $path) { [PSCustomObject]@{ id = $r[0]; name = $r[1]; kind = $r[2]; path = $base; exe = $path } }
  }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

local function db_path()
    local fs = require("fs")
    return fs.join(require("utils").getenv("APPDATA") or "", "itch", "db", "butler.db")
end

function M.is_installed()
    return require("fs").exists(db_path())
end

function M.discover()
    local script = SCAN_SCRIPT:gsub("__SQLITE__", function() return common.SQLITE_READER end)
    local games = {}
    for _, g in ipairs(common.run_powershell_json("itch", script)) do
        -- Waiting on the folder, not the exe: many games start through a small launcher exe
        games[#games + 1] = common.with_launch({
            id = "itch:" .. g.id,
            launcher = M.id,
            name = g.name,
            kind = g.kind == "game" and "game" or "app",
        }, common.launch_through(g.exe, nil, g.path))
    end
    return games
end

return M
