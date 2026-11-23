-- Cover frames: the covers under a frame or a badge are kept here as they were, so that the frame can be
-- changed or taken away at any time. The frontend draws the frames (see frontend/frames.ts).
-- The files go through the same chunked transfer as the downloads (images.lua).
local fs = require("fs")
local utils = require("utils")

-- Image types: 0 = grid (vertical cover), 3 = wide grid (horizontal cover)
local GRID_SUFFIXES = { [0] = "p", [3] = "" }
local EXTENSIONS = { "png", "jpg", "jpeg", "webp" }

local function originals_dir()
    local dir = fs.join(require("paths").data_dir(), "frames")
    if not fs.exists(dir) then fs.create_directories(dir) end
    return dir
end

local function stem(appid, kind)
    return string.format("%d_%d", tonumber(appid) or 0, tonumber(kind) or 0)
end

local function find_original(appid, kind)
    local dir = originals_dir()
    for _, ext in ipairs(EXTENSIONS) do
        local path = fs.join(dir, stem(appid, kind) .. "." .. ext)
        if fs.exists(path) then return path, ext end
    end
    return nil
end

-- The cover Steam shows now: the newest custom file among the Steam users' grid folders
local function find_grid(appid, kind)
    local suffix = GRID_SUFFIXES[tonumber(kind)]
    if not suffix then return nil end
    local name = string.format("%d", tonumber(appid) or 0) .. suffix
    local best, best_ext, best_time
    for _, grid in ipairs(require("paths").grid_dirs()) do
        for _, ext in ipairs(EXTENSIONS) do
            local path = fs.join(grid, name .. "." .. ext)
            if fs.exists(path) then
                local time = fs.last_write_time(path) or 0
                if not best_time or time > best_time then best, best_ext, best_time = path, ext, time end
            end
        end
    end
    return best, best_ext
end

local function read(path)
    local f = io.open(path, "rb")
    if not f then return nil end
    local data = f:read("*a")
    f:close()
    return data
end

-- A kept original that was Steam's own cover (a Steam game without custom artwork) has a marker next
-- to it: taking the frame away then gives the game Steam's cover back, not a custom copy of it
local function marker(appid, kind)
    return fs.join(originals_dir(), stem(appid, kind) .. ".official")
end

local function remove_originals(appid, kind)
    local dir = originals_dir()
    for _, ext in ipairs(EXTENSIONS) do os.remove(fs.join(dir, stem(appid, kind) .. "." .. ext)) end
    os.remove(marker(appid, kind))
end

-- Steam's own cover of a Steam game, in its library cache: library_600x900 (vertical) or header
-- (horizontal), in the app's folder or one level below; the name without a language first
local OFFICIAL = { [0] = "library_600x900", [3] = "header" }
local function find_official(appid, kind)
    local base = OFFICIAL[tonumber(kind)]
    if not base then return nil end
    local root = fs.join(require("millennium").steam_path(), "appcache", "librarycache", string.format("%d", tonumber(appid) or 0))
    if not fs.exists(root) then return nil end
    local exact, localized
    local function look(dir, deep)
        for _, entry in ipairs(fs.list(dir) or {}) do
            if entry.is_directory and deep then
                look(entry.path, false)
            elseif entry.is_file then
                local name = string.lower(fs.stem(entry.path))
                local ext = string.lower(entry.path:match("%.(%w+)$") or "")
                -- A PNG named .jpg is the placeholder Steam makes for apps without a cover (images.lua)
                local head = (ext == "jpg") and read(entry.path)
                local placeholder = head and head:sub(1, 4) == "\137PNG"
                if not placeholder and (ext == "jpg" or ext == "png") then
                    if name == base then exact = exact or { entry.path, ext }
                    elseif name:match("^" .. base .. "_%a+$") and not name:match("_blur$") then localized = localized or { entry.path, ext } end
                end
            end
        end
    end
    look(root, true)
    local found = exact or localized
    if found then return found[1], found[2] end
    return nil
end

-- Puts the cover without frame in the transfer table (read with ugi_download_chunk / released with
-- ugi_download_release, under the key returned): the kept original, else the cover Steam shows now.
-- Steam games without custom artwork: Steam's own cover. Returns JSON { key, size, ext, kept, official }
-- (size 0: no cover; official: the cover is Steam's own, kept or not).
function ugi_frame_cover_load(a_appid, b_type)
    local path, ext = find_original(a_appid, b_type)
    local kept = path ~= nil
    local official = kept and fs.exists(marker(a_appid, b_type))
    if not path then path, ext = find_grid(a_appid, b_type) end
    if not path then
        path, ext = find_official(a_appid, b_type)
        official = path ~= nil
    end
    local data = path and read(path)
    if not data then return '{"size":0}' end
    local key = "cover:" .. stem(a_appid, b_type)
    require("images").put_transfer(key, data)
    return require("json").encode({ key = key, size = #data, ext = ext, kept = kept, official = official == true })
end

-- Keeps a cover without frame, sent in base64 chunks of 3 MiB of data (index 0 starts the file);
-- f_official: it is Steam's own cover
function ugi_frame_original_put(a_appid, b_type, c_ext, d_index, e_chunk, f_official)
    local ext = tostring(c_ext):lower():gsub("[^%w]", "")
    if ext == "jpeg" then ext = "jpg" end
    if ext == "" then ext = "png" end
    if tonumber(d_index) == 0 then
        remove_originals(a_appid, b_type)
        if f_official == true or f_official == "true" then
            local m = io.open(marker(a_appid, b_type), "wb")
            if m then m:close() end
        end
    end
    local f = io.open(fs.join(originals_dir(), stem(a_appid, b_type) .. "." .. ext), tonumber(d_index) == 0 and "wb" or "ab")
    if not f then return false end
    f:write(utils.base64_decode(tostring(e_chunk or "")))
    f:close()
    return true
end

-- The cover has no frame any more: its kept original goes
function ugi_frame_original_drop(a_appid, b_type)
    remove_originals(a_appid, b_type)
    return true
end

-- The appids that have a kept original, as "appid_type" (JSON list)
function ugi_frame_originals()
    local out = {}
    for _, entry in ipairs(fs.list(originals_dir()) or {}) do
        local s = entry.is_file and string.match(fs.stem(entry.path), "^%d+_%d+$")
        if s then out[#out + 1] = s end
    end
    return require("json").encode(out)
end

return {}
