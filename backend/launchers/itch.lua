-- itch.io: games installed with the itch app are in its SQLite database (read with common.SQLITE_READER).
-- itch.io games are DRM-free: they start directly, with the executable the itch app found in the install folder.
local common = require("launchers.common")

local M = {
    id = "itch",
    name = "itch.io",
    os = "windows",
}

-- One row per installed game ("cave"); the "verdict" lists the executables found in the folder.
-- When it lists none (the itch app doesn't always look deep enough, e.g. Voices of the Void), the
-- folder is searched here. Games without a Windows executable (browser games) are left out.
local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'Stop'
$db = Join-Path $env:APPDATA 'itch\db\butler.db'
if (-not (Test-Path $db)) { '[]'; return }
__SQLITE__
# The game's program in its folder: tools, installers and crash reporters left out; the least
# deep first, then the biggest (the folder is kept as the wait folder, so a small launcher is fine)
function Find-GameExe($base) {
  $skip = '(?i)unins|setup|install|redist|vcredist|dxsetup|directx|prereq|crash|report|patch|update|desync|dotnet|ue4prereq|helper|7z|unity.?crash'
  $found = foreach ($f in (Get-ChildItem -LiteralPath $base -Recurse -Depth 4 -File -Filter '*.exe' -ErrorAction SilentlyContinue)) {
    $rel = $f.FullName.Substring($base.TrimEnd('\').Length + 1)
    if ($f.BaseName -match $skip -or $rel -match '(?i)(^|\\)(\.itch|engine|utils?|tools?|redist|_commonredist|__installer)\\') { continue }
    [PSCustomObject]@{ path = $f.FullName; depth = ($rel -split '\\').Count; size = $f.Length }
  }
  return @($found | Sort-Object depth, @{ Expression = 'size'; Descending = $true }) | Select-Object -First 1
}
$sql = "SELECT g.id, g.title, g.classification, c.verdict, COALESCE(NULLIF(c.custom_install_folder, ''), l.path || '\' || c.install_folder_name) FROM caves c JOIN games g ON g.id = c.game_id LEFT JOIN install_locations l ON l.id = c.install_location_id"
$out = foreach ($r in [UgiSqlite]::Query($db, $sql, 5)) {
  $verdict = $null
  try { $verdict = $r[3] | ConvertFrom-Json } catch {}
  $base = if ($verdict.basePath) { $verdict.basePath } else { $r[4] }
  $exes = @($verdict.candidates | Where-Object { $_.flavor -eq 'windows' })
  # 64-bit first when the game ships both
  $exe = @($exes | Where-Object { $_.arch -eq 'amd64' }) + $exes | Select-Object -First 1
  $path = if ($base -and $exe) { Join-Path $base $exe.path } else { $null }
  if ($base -and -not $exe -and (Test-Path -LiteralPath $base)) { $path = (Find-GameExe $base).path }
  if ($r[0] -and $r[1] -and $path -and (Test-Path -LiteralPath $path)) { [PSCustomObject]@{ id = $r[0]; name = $r[1]; kind = $r[2]; path = $base; exe = $path } }
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
            -- Some titles quote the game's name ("Voices Of The Void" Alpha): the quotes are dropped
            name = (tostring(g.name):gsub('"', ""):gsub("“", ""):gsub("”", ""):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")),
            kind = g.kind == "game" and "game" or "app",
        }, common.launch_through(g.exe, nil, g.path))
    end
    return games
end

return M
