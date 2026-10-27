-- Game information (description, developer, ...) for the library page of imported games.
-- The frontend picks the source; the backend only fetches pages and keeps the cache files.
local fs = require("fs")
local utils = require("utils")
local http = require("http")
local cjson = require("json")
local logger = require("logger")

-- Only these sites can be fetched
local HOSTS = {
    ["store.steampowered.com"] = true,
    ["api.gog.com"] = true,
    ["store-content.ak.epicgames.com"] = true,
    ["store-content-ipv4.ak.epicgames.com"] = true,
    ["api.rawg.io"] = true,
}

-- Returns the body, or {"http_status":N} when the request fails
function ugi_http_get(a_url)
    local url = tostring(a_url)
    local host = url:match("^https://([^/:?]+)")
    if not host or not HOSTS[host] then
        logger:error("info: host not allowed: " .. url)
        return '{"http_status":0}'
    end
    local res, err = http.get(url, { headers = { ["Accept"] = "application/json" }, timeout = 20 })
    if not res then
        logger:error("info: request failed: " .. tostring(err))
        return '{"http_status":0}'
    end
    if res.status ~= 200 then
        return string.format('{"http_status":%d}', res.status)
    end
    return res.body
end

-- Epic: the store namespace of an installed game, read from its install manifest
function ugi_epic_namespace(a_app_name, b_dir)
    local dir = tostring(b_dir or "")
    if dir == "" then
        local program_data = utils.getenv("ProgramData") or [[C:\ProgramData]]
        dir = fs.join(program_data, "Epic", "EpicGamesLauncher", "Data", "Manifests")
    end
    if not fs.exists(dir) then return "" end
    for _, entry in ipairs(fs.list(dir) or {}) do
        if entry.is_file and entry.path:lower():match("%.item$") then
            local ok, item = pcall(cjson.decode, utils.read_file(entry.path) or "")
            if ok and type(item) == "table" and item.AppName == a_app_name then
                return tostring(item.CatalogNamespace or "")
            end
        end
    end
    return ""
end

-- ---------- Cache: one file per game in data/info ----------

local function cache_path(key)
    local dir = fs.join(require("paths").data_dir(), "info")
    if not fs.exists(dir) then fs.create_directories(dir) end
    return fs.join(dir, (tostring(key):gsub("[^%w%._-]", "_")) .. ".json")
end

function ugi_info_load(a_key)
    local path = cache_path(a_key)
    return fs.exists(path) and (utils.read_file(path) or "") or ""
end

function ugi_info_save(a_key, b_json)
    local f = io.open(cache_path(a_key), "wb")
    if not f then return false end
    f:write(tostring(b_json))
    f:close()
    return true
end
