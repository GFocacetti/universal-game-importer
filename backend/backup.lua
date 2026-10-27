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

local grid_dirs = paths.grid_dirs

-- A PowerShell single-quoted string
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

-- ---------- Background jobs ----------
-- Zipping, unzipping and copying hundreds of MB take longer than a backend call may last: they run
-- in a hidden PowerShell started on its own, and the frontend asks for their state until they end.

local function job_marker(name)
    return fs.join(paths.data_dir(), name .. "_done.txt")
end

local function job_pid(name)
    return fs.join(paths.data_dir(), name .. "_pid.txt")
end

-- Created by ugi_job_cancel: the job checks it between steps and stops by itself
local function job_stop(name)
    return fs.join(paths.data_dir(), name .. "_stop.txt")
end

local note = paths.log

-- cleanup: PowerShell lines run when the job fails (and by ugi_job_cancel's own clean-up)
local function start_job(name, body, cleanup)
    local dir = paths.data_dir()
    local marker = job_marker(name)
    if fs.exists(marker) then fs.remove(marker) end
    if fs.exists(job_stop(name)) then fs.remove(job_stop(name)) end
    local script = fs.join(dir, name .. "_job.ps1")
    utils.write_file(script, table.concat({
        "$ErrorActionPreference = 'Stop'",
        "$PID | Out-File -FilePath " .. ps_quote(job_pid(name)) .. " -Encoding ascii",
        -- Called between steps: a requested stop ends the job like an error, with its clean-up
        "function Check-Stop { if (Test-Path -LiteralPath " .. ps_quote(job_stop(name)) .. ") { throw 'cancelled' } }",
        "try {",
        body,
        "  Check-Stop",
        "  'ok' | Out-File -FilePath " .. ps_quote(marker) .. " -Encoding utf8",
        "} catch {",
        "  $failure = $_.Exception.Message",
        cleanup or "",
        "  $result = if ($failure -eq 'cancelled') { 'cancelled' } else { 'error: ' + $failure }",
        "  $result | Out-File -FilePath " .. ps_quote(marker) .. " -Encoding utf8",
        "}",
    }, "\n"))
    -- Start-Process makes a separate process that shares no handles with the backend, so the call
    -- returns at once (a child started otherwise would keep the backend waiting until it ends)
    common.run_powershell_json("job_start", string.format(
        "Start-Process -FilePath %s -ArgumentList '-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File \"%s\"' -WindowStyle Hidden; ConvertTo-Json @('ok')",
        ps_quote(common.POWERSHELL), script))
end

-- "running", "ok" or "error: ..."
function ugi_job_status(a_name)
    local marker = job_marker(tostring(a_name))
    if not fs.exists(marker) then return "running" end
    local text = (utils.read_file(marker) or ""):gsub("^\239\187\191", ""):gsub("%s+$", "")
    return text ~= "" and text or "running"
end

-- Stops a job and removes what it left half done (its "cleanup" paths)
local JOB_LEFTOVERS = {}

function ugi_job_cancel(a_name)
    local name = tostring(a_name)
    -- First the stop request (the job sees it between files); then the process is ended, for the
    -- long single steps like zipping
    utils.write_file(job_stop(name), "stop")
    local pid_path = job_pid(name)
    local pid = fs.exists(pid_path) and tonumber(((utils.read_file(pid_path) or ""):gsub("%D", ""))) or nil
    if pid then
        local out = common.run_powershell_json("job_cancel", string.format(
            "Stop-Process -Id %d -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; ConvertTo-Json @([bool](Get-Process -Id %d -ErrorAction SilentlyContinue))",
            pid, pid))
        note(name .. " cancelled, process " .. pid .. (out[1] and " still running" or " ended"))
    end
    for _, path in ipairs(JOB_LEFTOVERS[name] or {}) do
        if fs.exists(path) then
            if fs.is_directory(path) then fs.remove_all(path) else fs.remove(path) end
        end
    end
    utils.write_file(job_marker(name), "cancelled")
    return true
end

local function ps_list(items)
    local quoted = {}
    for _, item in ipairs(items) do quoted[#quoted + 1] = ps_quote(item) end
    return "@(" .. table.concat(quoted, ",\n") .. ")"
end

-- a_state: UGI's state as JSON; b_appids: JSON list of the apps whose artwork goes in the backup.
-- Starts the "backup" job; returns {"path": "...zip", "files": n} or {"error": "..."}
function ugi_backup_export(a_state, b_appids)
    local ok, result = pcall(function()
        local ok_ids, appids = pcall(cjson.decode, b_appids or "[]")
        local wanted = {}
        for _, appid in ipairs(ok_ids and type(appids) == "table" and appids or {}) do
            for _, suffix in ipairs(SUFFIXES) do wanted[tostring(appid) .. suffix] = true end
        end
        local dir = staging("backup")
        utils.write_file(fs.join(dir, "state.json"), tostring(a_state))

        -- One pass over Steam's grid folder (it can hold thousands of files)
        local files, seen = {}, {}
        for _, grid in ipairs(grid_dirs()) do
            for _, entry in ipairs(fs.list(grid) or {}) do
                if entry.is_file and wanted[fs.stem(entry.path)] and not seen[entry.name] then
                    seen[entry.name] = true
                    files[#files + 1] = entry.path
                end
            end
        end

        local zip = fs.join(backup_dir(), "UGI-backup-" .. os.date("%Y-%m-%d_%H-%M") .. ".zip")
        -- Built under a temporary name and moved next to the other backups only when complete,
        -- so a half-made backup never shows up nor can be restored
        local partial = fs.join(paths.data_dir(), "backup_partial.zip")
        local icons = fs.join(paths.data_dir(), "icons")
        JOB_LEFTOVERS.backup = { dir, partial }
        start_job("backup", table.concat({
            "  $dir = " .. ps_quote(dir),
            "  $grid = Join-Path $dir 'grid'",
            "  New-Item -ItemType Directory -Path $grid -Force | Out-Null",
            "  foreach ($f in " .. ps_list(files) .. ") { Check-Stop; Copy-Item -LiteralPath $f -Destination $grid -Force }",
            "  if (Test-Path -LiteralPath " .. ps_quote(icons) .. ") { Copy-Item -LiteralPath " .. ps_quote(icons) .. " -Destination (Join-Path $dir 'icons') -Recurse -Force }",
            "  if (Test-Path -LiteralPath " .. ps_quote(partial) .. ") { Remove-Item -LiteralPath " .. ps_quote(partial) .. " -Force }",
            "  Compress-Archive -Path (Join-Path $dir '*') -DestinationPath " .. ps_quote(partial),
            "  Check-Stop",
            "  Move-Item -LiteralPath " .. ps_quote(partial) .. " -Destination " .. ps_quote(zip) .. " -Force",
            "  Remove-Item -LiteralPath $dir -Recurse -Force",
        }, "\n"), table.concat({
            "  Remove-Item -LiteralPath " .. ps_quote(partial) .. " -Force -ErrorAction SilentlyContinue",
            "  Remove-Item -LiteralPath " .. ps_quote(dir) .. " -Recurse -Force -ErrorAction SilentlyContinue",
        }, "\n"))
        logger:info("backup started: " .. zip .. " (" .. #files .. " artwork files)")
        return { path = zip, files = #files }
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

-- Moves a backup to the Recycle Bin (it can still be taken back from there)
function ugi_backup_delete(a_zip)
    local zip = tostring(a_zip)
    if not zip:lower():match("%.zip$") or not fs.exists(zip) then return false end
    common.run_powershell_json("backup_delete", string.format(
        "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(%s, 'OnlyErrorDialogs', 'SendToRecycleBin'); ConvertTo-Json @('ok')",
        ps_quote(zip)))
    return not fs.exists(zip)
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

-- Starts the "unzip" job for a backup; ugi_backup_state then reads what it holds
function ugi_backup_open(a_zip)
    local dir = staging("restore")
    start_job("unzip", "  Expand-Archive -LiteralPath " .. ps_quote(a_zip) .. " -DestinationPath " .. ps_quote(dir) .. " -Force")
    return true
end

-- The unpacked backup's state.json ("" if it isn't a UGI backup)
function ugi_backup_state()
    local state = fs.join(paths.data_dir(), "restore", "state.json")
    return fs.exists(state) and (utils.read_file(state) or "") or ""
end


-- Puts the unpacked artwork back (the "restore" job copies it). a_appids: JSON {"old appid": new appid}
-- for shortcuts created again with another id; b_steam: JSON list of Steam apps (their icons also go
-- to Steam's library cache). Returns {"files": n, "icons": {"appid": "icon path"}} with the shortcut
-- icons to set once the job is over, or {"error": "..."}
function ugi_backup_restore(a_appids, b_steam)
    local ok_map, map = pcall(cjson.decode, a_appids or "{}")
    if not ok_map or type(map) ~= "table" then map = {} end
    local ok_steam, steam = pcall(cjson.decode, b_steam or "[]")
    local is_steam = {}
    for _, appid in ipairs(ok_steam and type(steam) == "table" and steam or {}) do is_steam[tostring(appid)] = true end

    local ok, result = pcall(function()
        local dir = fs.join(paths.data_dir(), "restore")
        local sources, targets = {}, {}
        local function copy(from, to)
            sources[#sources + 1] = from
            targets[#targets + 1] = to
        end
        local count = 0
        local grids = grid_dirs()
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
                else
                    for _, grid in ipairs(grids) do copy(entry.path, fs.join(grid, appid .. rest)) end
                end
                count = count + 1
            end
        end

        local icons = {}
        local icons_dir = fs.join(paths.data_dir(), "icons")
        if not fs.exists(icons_dir) then fs.create_directories(icons_dir) end
        for _, entry in ipairs(fs.exists(fs.join(dir, "icons")) and fs.list(fs.join(dir, "icons")) or {}) do
            local old, rest = string.match(entry.is_file and entry.name or "", "^(%d+)(_icon%..+)$")
            if old then
                local appid = tostring(map[old] or old)
                icons[appid] = fs.join(icons_dir, appid .. rest)
                copy(entry.path, icons[appid])
            end
        end

        start_job("restore", table.concat({
            "  $from = " .. ps_list(sources),
            "  $to = " .. ps_list(targets),
            "  for ($i = 0; $i -lt $from.Count; $i++) { Copy-Item -LiteralPath $from[$i] -Destination $to[$i] -Force }",
            "  Remove-Item -LiteralPath " .. ps_quote(dir) .. " -Recurse -Force",
        }, "\n"))
        note("restore: " .. count .. " pictures, " .. #sources .. " copies started")
        return { files = count, icons = icons }
    end)
    if not ok then
        note("restore failed: " .. tostring(result))
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

-- Every non-Steam shortcut of every Steam user: [{appid, name, exe, start_dir, launch_options}]
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
                        start_dir = entry.StartDir or "",
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

-- Apps with custom artwork in Steam's grid folder, whoever set it (Steam's own dialog, Easy SteamGrid,
-- UGI). Non-Steam shortcuts have the top bit of their id set and are left out.
function ugi_custom_scan()
    local found, ids = {}, {}
    for _, grid in ipairs(grid_dirs()) do
        for _, entry in ipairs(fs.list(grid) or {}) do
            local id = entry.is_file and fs.stem(entry.path):match("^(%d+)p?$")
                or entry.is_file and fs.stem(entry.path):match("^(%d+)_hero$")
                or entry.is_file and fs.stem(entry.path):match("^(%d+)_logo$")
                or entry.is_file and fs.stem(entry.path):match("^(%d+)_icon$")
            local appid = tonumber(id or "")
            if appid and appid < 2147483648 and not found[appid] then
                found[appid] = true
                ids[#ids + 1] = appid
            end
        end
    end
    return cjson.encode(ids)
end

-- Same as ugi_custom_mark for a JSON list of apps, in one call
function ugi_custom_mark_many(a_appids)
    local ok, appids = pcall(cjson.decode, a_appids or "[]")
    local list = customized()
    for _, appid in ipairs(ok and type(appids) == "table" and appids or {}) do list[tostring(appid)] = true end
    utils.write_file(customized_path(), cjson.encode(list))
    return true
end

function ugi_custom_list()
    local ids = {}
    for appid in pairs(customized()) do ids[#ids + 1] = tonumber(appid) end
    return cjson.encode(ids)
end
