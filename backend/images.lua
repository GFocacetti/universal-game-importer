-- SteamGridDB access and local artwork checks.
-- One HTTP request per backend call: loops run in the frontend (see Easy SteamGrid's approach).
local fs = require("fs")
local utils = require("utils")
local http = require("http")
local logger = require("logger")
local millennium = require("millennium")

local API = "https://www.steamgriddb.com/api/v2/"
-- 3 MiB raw = 4 MiB base64: safely below Millennium's 8 MiB return limit, and a multiple of 3
-- so that base64 chunks can be concatenated
local CHUNK = 3 * 1024 * 1024
local downloads = {}

function ugi_sgdb_get(a_key, b_endpoint)
    local res, err = http.get(API .. tostring(b_endpoint), {
        headers = { ["Authorization"] = "Bearer " .. tostring(a_key), ["Accept"] = "application/json" },
        timeout = 20,
    })
    if not res then
        logger:error("sgdb: request failed: " .. tostring(err))
        return '{"http_status":0}'
    end
    if res.status ~= 200 then
        return string.format('{"http_status":%d}', res.status)
    end
    return res.body
end

-- Downloads an image (binary-safe: to a file, read back in binary mode); returns its size (0 on failure)
function ugi_download(a_url)
    local tmp = fs.join(require("paths").data_dir(), "download.bin")
    local res, err = http.download(tostring(a_url), tmp)
    if not res or res.status ~= 200 then
        logger:error("download failed: " .. tostring(a_url) .. " " .. tostring(err or (res and res.status)))
        os.remove(tmp)
        return 0
    end
    local f = io.open(tmp, "rb")
    if not f then return 0 end
    local data = f:read("*a")
    f:close()
    os.remove(tmp)
    downloads[a_url] = data
    return #data
end

function ugi_download_chunk(a_url, b_index)
    local data = downloads[a_url]
    if not data then return "" end
    local from = (tonumber(b_index) or 0) * CHUNK + 1
    if from > #data then return "" end
    return utils.base64_encode(data:sub(from, from + CHUNK - 1)) or ""
end

function ugi_download_release(a_url)
    downloads[a_url] = nil
    return true
end

-- Writes a downloaded image to the data folder (non-Steam shortcuts need an icon file); returns the path
function ugi_download_save(a_url, b_name)
    local data = downloads[a_url]
    if not data then return "" end
    local dir = fs.join(require("paths").data_dir(), "icons")
    if not fs.exists(dir) then fs.create_directories(dir) end
    local path = fs.join(dir, (tostring(b_name):gsub("[^%w%._-]", "_")))
    local f = io.open(path, "wb")
    if not f then return "" end
    f:write(data)
    f:close()
    return path
end

-- Steam games: the icon is written as files where Steam reads it (original kept for reset)
function ugi_icon_apply(a_url, b_appid)
    local data = downloads[a_url]
    if not data then return false end
    local ext = tostring(a_url):lower():match("%.(%w+)$") or "png"
    return require("icons").write_icon(b_appid, data, ext)
end

function ugi_icon_reset(a_appid)
    return require("icons").clear_icon(a_appid)
end

-- ---------- Missing images ----------

-- Image types: 0 = grid, 1 = hero, 2 = logo, 3 = wide grid, 4 = icon
local CUSTOM_SUFFIXES = { [0] = "p", [1] = "_hero", [2] = "_logo", [3] = "", [4] = "_icon" }

local function grid_stems()
    local stems = {}
    local userdata = fs.join(millennium.steam_path(), "userdata")
    for _, user in ipairs(fs.exists(userdata) and fs.list(userdata) or {}) do
        if user.is_directory then
            local grid = fs.join(user.path, "config", "grid")
            for _, entry in ipairs(fs.exists(grid) and fs.list(grid) or {}) do
                if entry.is_file then stems[string.lower(fs.stem(entry.path))] = true end
            end
        end
    end
    return stems
end

-- Official asset names, optionally followed by a language suffix (e.g. header_italian)
local function official_type(stem)
    local function is(base)
        if stem == base then return true end
        local lang = string.match(stem, "^" .. base .. "_(%a+)$")
        return lang ~= nil and lang ~= "blur"
    end
    if is("library_600x900") or is("library_capsule") then return 0 end
    if is("library_hero") then return 1 end
    if is("logo") then return 2 end
    if is("header") or is("library_header") then return 3 end
    return nil
end

-- Real vertical capsules are JPEGs; for apps without one, Steam serves a generated
-- placeholder (the header stretched over a blurred background) that is a PNG named .jpg
local function is_png(path)
    local f = io.open(path, "rb")
    if not f then return false end
    local head = f:read(4)
    f:close()
    return head == "\137PNG"
end

local function scan_official(dir, found, is_root)
    for _, entry in ipairs(fs.list(dir) or {}) do
        if entry.is_directory then
            if is_root then scan_official(entry.path, found, false) end
        elseif entry.is_file then
            local stem = string.lower(fs.stem(entry.path))
            local t = official_type(stem)
            if t == 0 and is_png(entry.path) then
                -- generated placeholder: the grid counts as missing
            elseif t then
                found[t] = true
            elseif is_root and #stem == 40 and string.match(stem, "^%x+$") then
                found[4] = true
            end
        end
    end
end

-- For a JSON list of appids returns { [appid] = "0,1,3" } with the missing image types
function ugi_missing_images(a_appids)
    local ok, appids = pcall(require("json").decode, a_appids or "[]")
    if not ok or type(appids) ~= "table" then return "{}" end
    local stems = grid_stems()
    local cache = fs.join(millennium.steam_path(), "appcache", "librarycache")
    local out = {}
    for _, appid in ipairs(appids) do
        local id = string.format("%d", appid)
        local found = {}
        local dir = fs.join(cache, id)
        if fs.exists(dir) then scan_official(dir, found, true) end
        local missing = {}
        for t = 0, 4 do
            if stems[id .. CUSTOM_SUFFIXES[t]] then found[t] = true end
            if not found[t] then missing[#missing + 1] = tostring(t) end
        end
        out[id] = table.concat(missing, ",")
    end
    return require("json").encode(out)
end

return {}
