-- Epic Games Store: install manifests in ProgramData. Games Epic couldn't record there (it can fail
-- to write them, and the games still work) are found by their folders: every game Epic installs has
-- a .egstore folder, and Epic's catalog cache tells which game each folder name belongs to.
local fs = require("fs")
local utils = require("utils")
local cjson = require("json")
local logger = require("logger")
local common = require("launchers.common")

local M = {
    id = "epic",
    name = "Epic Games",
    os = "windows",
    supports_path = true,
}

local function program_data()
    return utils.getenv("ProgramData") or [[C:\ProgramData]]
end

local function epic_data()
    return fs.join(program_data(), "Epic", "EpicGamesLauncher")
end

local function manifests_dir()
    return fs.join(epic_data(), "Data", "Manifests")
end

local function installed_list()
    return fs.join(program_data(), "Epic", "UnrealEngineLauncher", "LauncherInstalled.dat")
end

local function has_category(item, category)
    for _, c in ipairs(type(item.AppCategories) == "table" and item.AppCategories or {}) do
        if c == category then return true end
    end
    return false
end

-- JSON file, with or without a byte order mark; nil if it can't be read
local function read_json(path)
    local raw = utils.read_file(path)
    if not raw then return nil end
    local ok, value = pcall(cjson.decode, (raw:gsub("^\239\187\191", "")))
    return ok and type(value) == "table" and value or nil
end

local function folder_key(path)
    return (tostring(path or ""):gsub("[\\/]+$", ""):lower())
end

local function parent_of(path)
    return (tostring(path or ""):gsub("[\\/]+$", ""):match("^(.*)[\\/][^\\/]+$"))
end

local function ps_text(value)
    return "'" .. tostring(value):gsub("'", "''") .. "'"
end

local function epic_game(app_name, name, kind, location)
    local uri = "com.epicgames.launcher://apps/" .. app_name .. "?action=launch&silent=true"
    return common.with_launch({
        id = "epic:" .. app_name,
        launcher = M.id,
        name = name,
        kind = kind,
        icon = nil,
    }, common.launch_through(uri, nil, location))
end

-- Looks in the folders Epic installs games in (its setting, the usual ones on every drive and the
-- given ones) for games with a .egstore folder, leaving out the folders already known. Each game:
-- its name and app name from the catalog cache by folder name; else the app name from the folder's
-- own manifest (or the launcher's list) and the program's product name, marked uncertain.
local FOLDER_SCAN = [==[
function Read-FString($r) {
  $n = $r.ReadInt32()
  if ($n -eq 0) { return '' }
  if ($n -lt 0) { return [Text.Encoding]::Unicode.GetString($r.ReadBytes(-2 * $n)).TrimEnd([char]0) }
  return [Text.Encoding]::UTF8.GetString($r.ReadBytes($n)).TrimEnd([char]0)
}
# App name and program from a .egstore manifest: binary (header, then zlib data starting with the
# metadata), or JSON in older ones
function Read-EpicManifest($path) {
  $fs = [IO.File]::OpenRead($path)
  try {
    $r = New-Object IO.BinaryReader($fs)
    if ($r.ReadUInt32() -ne 0x44BEC00C) {
      $fs.Position = 0
      $j = (New-Object IO.StreamReader($fs)).ReadToEnd() | ConvertFrom-Json
      return @{ app = [string]$j.AppNameString; exe = [string]$j.LaunchExeString }
    }
    $headerSize = $r.ReadUInt32(); $null = $r.ReadUInt32(); $null = $r.ReadUInt32(); $null = $r.ReadBytes(20)
    $stored = $r.ReadByte()
    $fs.Position = $headerSize
    $source = $fs
    if ($stored -band 1) {
      $null = $fs.ReadByte(); $null = $fs.ReadByte()
      $source = New-Object IO.Compression.DeflateStream($fs, [IO.Compression.CompressionMode]::Decompress)
    }
    $data = New-Object IO.MemoryStream
    $buffer = New-Object byte[] 65536
    while ($data.Length -lt 65536) { $n = $source.Read($buffer, 0, $buffer.Length); if ($n -le 0) { break }; $data.Write($buffer, 0, $n) }
    $data.Position = 0
    $m = New-Object IO.BinaryReader($data)
    $null = $m.ReadUInt32(); $null = $m.ReadByte(); $null = $m.ReadUInt32(); $null = $m.ReadByte(); $null = $m.ReadUInt32()
    $app = Read-FString $m; $null = Read-FString $m; $exe = Read-FString $m
    return @{ app = $app; exe = $exe }
  } finally { $fs.Dispose() }
}
$ini = Get-ChildItem "$env:LOCALAPPDATA\EpicGamesLauncher\Saved\Config" -Recurse -Filter GameUserSettings.ini -ErrorAction SilentlyContinue
foreach ($f in $ini) { foreach ($line in (Get-Content -LiteralPath $f.FullName -ErrorAction SilentlyContinue)) { if ($line -match '^\s*DefaultAppInstallLocation\s*=\s*(.+?)\s*$') { $bases += $Matches[1] } } }
foreach ($d in [IO.DriveInfo]::GetDrives()) {
  if ($d.DriveType -eq 'Fixed' -and $d.IsReady) {
    $root = $d.RootDirectory.FullName
    $bases += @(($root + 'Epic Games'), ($root + 'EpicGames'), ($root + 'Program Files\Epic Games'), ($root + 'Program Files (x86)\Epic Games'))
  }
}
$found = @(); $done = @{}
foreach ($base in $bases) {
  foreach ($dir in (Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue)) {
    $key = $dir.FullName.TrimEnd('\').ToLower()
    if ($done[$key] -or $skip[$key]) { continue }
    $done[$key] = $true
    # Epic's own parts, installed the same way
    if (@('launcher', 'epic online services', 'directxredist') -contains $dir.Name.ToLower()) { continue }
    $store = Join-Path $dir.FullName '.egstore'
    if (-not (Test-Path -LiteralPath $store)) { continue }
    $info = $null
    foreach ($f in (Get-ChildItem -LiteralPath $store -File -Force -ErrorAction SilentlyContinue | Sort-Object Length -Descending)) {
      if ($f.Extension -ne '.manifest') { continue }
      try { $info = Read-EpicManifest $f.FullName; if ($info.app) { break } } catch {}
    }
    $found += @{ dir = $dir; key = $key; info = $info }
  }
}
$catalog = @{}
if ($found.Count -gt 0) {
  try {
    $items = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((Get-Content -LiteralPath $catalogFile -Raw))) | ConvertFrom-Json
    foreach ($item in $items) {
      $folder = [string]$item.customAttributes.FolderName.value
      if (-not $folder) { continue }
      $app = ''
      foreach ($release in $item.releaseInfo) { if (@($release.platform) -contains 'Windows') { $app = [string]$release.appId; break } }
      if (-not $app) { continue }
      $isGame = @($item.categories | ForEach-Object { $_.path }) -contains 'games'
      $known = $catalog[$folder.ToLower()]
      if (-not $known -or ($isGame -and -not $known.game)) { $catalog[$folder.ToLower()] = @{ app = $app; title = [string]$item.title; game = $isGame } }
    }
  } catch {}
}
$out = @()
foreach ($g in $found) {
  $match = $catalog[$g.dir.Name.ToLower()]
  if ($match) {
    $out += [pscustomobject]@{ app = $match.app; name = $match.title; folder = $g.dir.FullName; kind = $(if ($match.game) { 'game' } else { 'app' }) }
    continue
  }
  $app = $listed[$g.key]
  if (-not $app -and $g.info) { $app = $g.info.app }
  if (-not $app) { continue }
  $name = ''
  if ($g.info -and $g.info.exe) {
    $exe = Join-Path $g.dir.FullName $g.info.exe
    if (Test-Path -LiteralPath $exe) { $name = ([string](Get-Item -LiteralPath $exe).VersionInfo.ProductName).Trim() }
  }
  if (-not $name) { $name = $g.dir.Name -creplace '([a-z])([A-Z])', '$1 $2' }
  $out += [pscustomobject]@{ app = $app; name = $name; folder = $g.dir.FullName; kind = 'uncertain' }
}
ConvertTo-Json -Compress -InputObject @($out)
]==]

local function folder_games(bases, skip, listed)
    local lines = {}
    local base_list = {}
    for _, base in ipairs(bases) do base_list[#base_list + 1] = ps_text(base) end
    lines[#lines + 1] = "$bases = @(" .. table.concat(base_list, ", ") .. ")"
    local skip_list = {}
    for key in pairs(skip) do skip_list[#skip_list + 1] = ps_text(key) .. " = $true" end
    lines[#lines + 1] = "$skip = @{ " .. table.concat(skip_list, "; ") .. " }"
    local listed_list = {}
    for key, app in pairs(listed) do listed_list[#listed_list + 1] = ps_text(key) .. " = " .. ps_text(app) end
    lines[#lines + 1] = "$listed = @{ " .. table.concat(listed_list, "; ") .. " }"
    lines[#lines + 1] = "$catalogFile = " .. ps_text(fs.join(epic_data(), "Data", "Catalog", "catcache.bin"))
    local ok, result = pcall(common.run_powershell_json, "epic", table.concat(lines, "\n") .. "\n" .. FOLDER_SCAN)
    if not ok then
        logger:error("epic: folder scan failed: " .. tostring(result))
        return {}
    end
    return result
end

function M.is_installed(custom)
    return fs.exists(custom or manifests_dir()) or (not custom and (fs.exists(installed_list()) or fs.exists(epic_data())))
end

-- custom: another manifests folder. Second result: { unreadable = n } when some manifests couldn't be read
function M.discover(custom)
    local dir = custom or manifests_dir()
    local items, apps, unreadable = {}, {}, 0
    for _, entry in ipairs(fs.exists(dir) and fs.list(dir) or {}) do
        local path = type(entry) == "table" and (entry.path or entry.name) or entry
        if type(path) == "string" and path:lower():match("%.item$") then
            local full = fs.exists(path) and path or fs.join(dir, path)
            local item = read_json(full)
            if not item then
                unreadable = unreadable + 1
                logger:error("epic: cannot read manifest " .. tostring(full))
            elseif type(item.AppName) == "string" and type(item.InstallLocation) == "string" then
                items[#items + 1] = item
                apps[item.AppName] = true
            end
        end
    end

    -- A DLC is marked as an add-on, or points to a main game installed here. A game whose main
    -- game name points elsewhere (Epic sometimes keeps an older name there) is still a game.
    local function is_dlc(item)
        local main = item.MainGameAppName
        return has_category(item, "addons")
            or (type(main) == "string" and main ~= "" and main ~= item.AppName and apps[main] == true)
    end

    local games, seen, folders, bases = {}, {}, {}, {}
    for _, item in ipairs(items) do
        local dlc = is_dlc(item)
        local folder = folder_key(item.InstallLocation)
        if not dlc and item.DisplayName and not item.bIsIncompleteInstall and not seen[item.AppName] and not folders[folder] then
            games[#games + 1] = epic_game(item.AppName, item.DisplayName,
                has_category(item, "games") and "game" or "app", item.InstallLocation)
        end
        -- Every manifest's folder counts, DLC and unfinished installs too: the folder scan skips them
        seen[item.AppName] = true
        folders[folder] = true
        bases[#bases + 1] = parent_of(item.InstallLocation)
    end

    -- The launcher's own list: app names by folder, and more folders to look in
    local listed = {}
    local list = fs.exists(installed_list()) and read_json(installed_list()) or nil
    for _, install in ipairs(type(list) == "table" and type(list.InstallationList) == "table" and list.InstallationList or {}) do
        if type(install.AppName) == "string" and install.AppName ~= "" and type(install.InstallLocation) == "string" then
            listed[folder_key(install.InstallLocation)] = install.AppName
            bases[#bases + 1] = parent_of(install.InstallLocation)
        end
    end

    if fs.exists(epic_data()) then
        for _, g in ipairs(folder_games(bases, folders, listed)) do
            if type(g) == "table" and type(g.app) == "string" and g.app ~= "" and not seen[g.app] then
                seen[g.app] = true
                logger:info("epic: found by its folder: " .. tostring(g.name) .. " (" .. tostring(g.folder) .. ")")
                games[#games + 1] = epic_game(g.app, tostring(g.name or g.app), g.kind or "uncertain", g.folder)
            end
        end
    end
    return games, unreadable > 0 and { unreadable = unreadable } or nil
end

return M
