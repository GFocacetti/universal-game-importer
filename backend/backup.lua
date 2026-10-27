-- Backup (a .zip in Documents\UGI backup), restore, and the clean-up before uninstalling.
-- A backup holds UGI's state, the custom artwork files of the given apps and the shortcut icons.
local fs = require("fs")
local utils = require("utils")
local cjson = require("json")
local logger = require("logger")
local millennium = require("millennium")
local common = require("launchers.common")
local paths = require("paths")

-- Custom artwork names in Steam's grid folder: grid, wide grid, hero, logo (+ position), icon
local SUFFIXES = { "p", "", "_hero", "_logo", "_icon" }

local function grid_dirs()
    local dirs = {}
    local userdata = fs.join(millennium.steam_path(), "userdata")
    for _, user in ipairs(fs.exists(userdata) and fs.list(userdata) or {}) do
        if user.is_directory then
            local grid = fs.join(user.path, "config", "grid")
            if fs.exists(grid) then dirs[#dirs + 1] = grid end
        end
    end
    return dirs
end

local function ps_quote(text)
    return "'" .. tostring(text):gsub("'", "''") .. "'"
end

local function backup_dir()
    local found = common.run_powershell_json("documents", "ConvertTo-Json @([Environment]::GetFolderPath('MyDocuments'))")
    local documents = found[1] or fs.join(utils.getenv("USERPROFILE") or "C:\\", "Documents")
    local dir = fs.join(documents, "UGI backup")
    if not fs.exists(dir) then fs.create_directories(dir) end
    return dir
end

local function staging(name)
    local dir = fs.join(paths.data_dir(), name)
    if fs.exists(dir) then fs.remove_all(dir) end
    fs.create_directories(dir)
    return dir
end

-- Artwork files of one app in a grid folder (by name: "<appid>p.png", "<appid>_logo.json"...)
local function artwork_files(grid, appid)
    local wanted = {}
    for _, suffix in ipairs(SUFFIXES) do wanted[appid .. suffix] = true end
    local files = {}
    for _, entry in ipairs(fs.list(grid) or {}) do
        if entry.is_file and wanted[fs.stem(entry.path)] then files[#files + 1] = entry end
    end
    return files
end

-- a_state: UGI's state as JSON; b_appids: JSON list of the apps whose artwork goes in the backup.
-- Returns {"path": "...zip"} or {"error": "..."}
function ugi_backup_export(a_state, b_appids)
    local ok, result = pcall(function()
        local ok_ids, appids = pcall(cjson.decode, b_appids or "[]")
        if not ok_ids or type(appids) ~= "table" then appids = {} end
        local dir = staging("backup")
        utils.write_file(fs.join(dir, "state.json"), tostring(a_state))

        local grid_out = fs.join(dir, "grid")
        fs.create_directories(grid_out)
        local count = 0
        for _, grid in ipairs(grid_dirs()) do
            for _, appid in ipairs(appids) do
                for _, entry in ipairs(artwork_files(grid, tostring(appid))) do
                    local target = fs.join(grid_out, entry.name)
                    if not fs.exists(target) then
                        fs.copy(entry.path, target)
                        count = count + 1
                    end
                end
            end
        end
        local icons = fs.join(paths.data_dir(), "icons")
        if fs.exists(icons) then fs.copy_recursive(icons, fs.join(dir, "icons")) end

        local zip = fs.join(backup_dir(), "UGI-backup-" .. os.date("%Y-%m-%d_%H-%M") .. ".zip")
        if fs.exists(zip) then fs.remove(zip) end
        common.run_powershell_json("backup_zip", string.format(
            "Compress-Archive -Path (Join-Path %s '*') -DestinationPath %s -Force; ConvertTo-Json @('ok')",
            ps_quote(dir), ps_quote(zip)))
        fs.remove_all(dir)
        if not fs.exists(zip) then error("zip not created") end
        logger:info("backup: " .. zip .. " (" .. count .. " artwork files)")
        return { path = zip, files = count }
    end)
    if not ok then
        logger:error("backup failed: " .. tostring(result))
        return cjson.encode({ error = tostring(result) })
    end
    return cjson.encode(result)
end

-- The backups in Documents\UGI backup, newest first: {"dir": "...", "files": [{"name", "path"}]}
function ugi_backup_list()
    local dir = backup_dir()
    local files = {}
    for _, entry in ipairs(fs.list(dir) or {}) do
        if entry.is_file and entry.name:lower():match("%.zip$") then
            files[#files + 1] = { name = entry.name, path = entry.path }
        end
    end
    table.sort(files, function(a, b) return a.name > b.name end)
    return cjson.encode({ dir = dir, files = files })
end

-- Lets the user pick a backup file anywhere (Windows' own dialog, above Steam); "" if cancelled
function ugi_backup_pick()
    local dir = paths.data_dir()
    local script = fs.join(dir, "backup_pick.ps1")
    local out = fs.join(dir, "backup_pick.json")
    utils.write_file(script, string.format([[
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = 'UGI backup (*.zip)|*.zip'
$dialog.InitialDirectory = %s
$picked = if ($dialog.ShowDialog($owner) -eq 'OK') { $dialog.FileName } else { '' }
ConvertTo-Json @($picked) | Out-File -FilePath %s -Encoding utf8
]], ps_quote(backup_dir()), ps_quote(out)))
    if fs.exists(out) then fs.remove(out) end
    -- The dialog needs a single-threaded apartment
    utils.exec(string.format([[%s -STA -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%s"]], common.POWERSHELL, script))
    local raw = fs.exists(out) and (utils.read_file(out) or "") or ""
    local ok, list = pcall(cjson.decode, (raw:gsub("^\239\187\191", "")))
    return ok and type(list) == "table" and tostring(list[1] or "") or ""
end

-- Unpacks a backup and returns its state.json ("" if it isn't a UGI backup)
function ugi_backup_open(a_zip)
    local dir = staging("restore")
    common.run_powershell_json("backup_unzip", string.format(
        "Expand-Archive -LiteralPath %s -DestinationPath %s -Force; ConvertTo-Json @('ok')",
        ps_quote(a_zip), ps_quote(dir)))
    local state = fs.join(dir, "state.json")
    return fs.exists(state) and (utils.read_file(state) or "") or ""
end

-- Binary-safe copy (the same way downloads are written); returns true when written
local function copy_file(from, to)
    local input = io.open(from, "rb")
    if not input then return false end
    local data = input:read("*a")
    input:close()
    local output = io.open(to, "wb")
    if not output then return false end
    output:write(data)
    output:close()
    return true
end

-- Progress of a restore, in data/frontend.log next to the frontend's own notes
local function note(message)
    local f = io.open(fs.join(paths.data_dir(), "frontend.log"), "a")
    if f then
        f:write(os.date("%Y-%m-%d %H:%M:%S "), "restore: ", message, "\n")
        f:close()
    end
end

local function restore_files(map, is_steam)
    local dir = fs.join(paths.data_dir(), "restore")
    local count = 0
    local grids = grid_dirs()
    note(#grids .. " grid folders")
    for _, entry in ipairs(fs.exists(fs.join(dir, "grid")) and fs.list(fs.join(dir, "grid")) or {}) do
        local old, rest = string.match(entry.is_file and entry.name or "", "^(%d+)(.*)$")
        if old then
            local appid = tostring(map[old] or old)
            if is_steam[appid] and rest:match("^_icon%.") then
                -- Steam games read their icon from more places than the grid folder
                local f = io.open(entry.path, "rb")
                local bytes = f and f:read("*a")
                if f then f:close() end
                if bytes then require("icons").write_icon(appid, bytes, rest:match("%.(%w+)$")) end
                count = count + 1
            else
                local copied = false
                for _, grid in ipairs(grids) do copied = copy_file(entry.path, fs.join(grid, appid .. rest)) or copied end
                if copied then count = count + 1 else note("cannot copy " .. entry.name) end
            end
        end
    end
    note(count .. " pictures")

    local icons = {}
    local icons_dir = fs.join(paths.data_dir(), "icons")
    for _, entry in ipairs(fs.exists(fs.join(dir, "icons")) and fs.list(fs.join(dir, "icons")) or {}) do
        local old, rest = string.match(entry.is_file and entry.name or "", "^(%d+)(_icon%..+)$")
        if old then
            if not fs.exists(icons_dir) then fs.create_directories(icons_dir) end
            local appid = tostring(map[old] or old)
            local target = fs.join(icons_dir, appid .. rest)
            if copy_file(entry.path, target) then icons[appid] = target end
        end
    end
    local icon_count = 0
    for _ in pairs(icons) do icon_count = icon_count + 1 end
    note(icon_count .. " shortcut icons")
    fs.remove_all(dir)
    return { files = count, icons = icons }
end

-- Puts the unpacked artwork back. a_appids: JSON {"old appid": new appid} for shortcuts created again
-- with another id; b_steam: JSON list of Steam apps (their icons also go to Steam's library cache).
-- Returns {"files": n, "icons": {"appid": "icon path"}} with the shortcut icons to set, or {"error": "..."}
function ugi_backup_restore(a_appids, b_steam)
    local ok_map, map = pcall(cjson.decode, a_appids or "{}")
    if not ok_map or type(map) ~= "table" then map = {} end
    local ok_steam, steam = pcall(cjson.decode, b_steam or "[]")
    local is_steam = {}
    for _, appid in ipairs(ok_steam and type(steam) == "table" and steam or {}) do is_steam[tostring(appid)] = true end

    note("started")
    local ok, result = pcall(restore_files, map, is_steam)
    if not ok then
        note("failed: " .. tostring(result))
        logger:error("restore failed: " .. tostring(result))
        return cjson.encode({ error = tostring(result) })
    end
    return cjson.encode(result)
end

-- ---------- Steam's non-Steam shortcuts (shortcuts.vdf, binary VDF) ----------

-- Reads one binary VDF map: 0x00 = nested map, 0x01 = string, 0x02 = 32-bit integer, 0x08 = end
local function read_vdf_map(data, pos)
    local map = {}
    while pos <= #data do
        local kind = data:byte(pos)
        pos = pos + 1
        if kind == 8 then return map, pos end
        local key_end = data:find("\0", pos, true)
        if not key_end then return map, #data + 1 end
        local key = data:sub(pos, key_end - 1):lower()
        pos = key_end + 1
        if kind == 0 then
            map[key], pos = read_vdf_map(data, pos)
        elseif kind == 1 then
            local value_end = data:find("\0", pos, true) or #data + 1
            map[key] = data:sub(pos, value_end - 1)
            pos = value_end + 1
        elseif kind == 2 then
            local b1, b2, b3, b4 = data:byte(pos, pos + 3)
            map[key] = (b1 or 0) + (b2 or 0) * 256 + (b3 or 0) * 65536 + (b4 or 0) * 16777216
            pos = pos + 4
        else
            return map, #data + 1
        end
    end
    return map, pos
end

-- Every non-Steam shortcut of every Steam user: [{appid, name, exe, launch_options}]
function ugi_shortcuts()
    local list = {}
    local userdata = fs.join(millennium.steam_path(), "userdata")
    for _, user in ipairs(fs.exists(userdata) and fs.list(userdata) or {}) do
        local path = fs.join(user.path, "config", "shortcuts.vdf")
        if user.is_directory and fs.exists(path) then
            local f = io.open(path, "rb")
            local data = f and f:read("*a") or ""
            if f then f:close() end
            local ok, root = pcall(read_vdf_map, data, 1)
            for _, entry in pairs(ok and type(root) == "table" and type(root.shortcuts) == "table" and root.shortcuts or {}) do
                if type(entry) == "table" and entry.appid then
                    list[#list + 1] = {
                        appid = entry.appid,
                        name = entry.appname or "",
                        exe = entry.exe or "",
                        launch_options = entry.launchoptions or "",
                    }
                end
            end
        end
    end
    return cjson.encode(list)
end

-- Before uninstalling: removes what UGI wrote in its data folder (icons, game information, scripts, logs)
function ugi_cleanup()
    local dir = paths.data_dir()
    for _, entry in ipairs(fs.list(dir) or {}) do
        if entry.is_directory then fs.remove_all(entry.path) else fs.remove(entry.path) end
    end
    logger:info("cleanup: data folder emptied")
    return true
end

-- Opens a folder in Explorer
function ugi_open_folder(a_path)
    utils.exec(string.format('explorer.exe "%s"', tostring(a_path):gsub('"', "")))
    return true
end

-- ---------- Steam apps whose artwork UGI changed (to reset them on removal) ----------

local function customized_path()
    return fs.join(paths.data_dir(), "customized.json")
end

local function customized()
    -- utils.read_file fails on a missing file
    local path = customized_path()
    if not fs.exists(path) then return {} end
    local ok, list = pcall(cjson.decode, utils.read_file(path) or "{}")
    return ok and type(list) == "table" and list or {}
end

function ugi_custom_mark(a_appid)
    local list = customized()
    list[tostring(a_appid)] = true
    utils.write_file(customized_path(), cjson.encode(list))
    return true
end

function ugi_custom_list()
    local ids = {}
    for appid in pairs(customized()) do ids[#ids + 1] = tonumber(appid) end
    return cjson.encode(ids)
end
