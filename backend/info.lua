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

local function epic_data()
    return fs.join(utils.getenv("ProgramData") or [[C:\ProgramData]], "Epic", "EpicGamesLauncher", "Data")
end

-- The namespace of one app from Epic's catalog cache (base64 JSON). PowerShell keeps the whole map
-- in data/epic_namespaces.json and hands back only the one asked for: decoding big JSON here
-- crashes Millennium's Lua host. Each app is asked once while Steam runs.
local namespace_known = {}

local function catalog_namespace(app_name)
    if namespace_known[app_name] then return namespace_known[app_name] end
    local catalog = fs.join(epic_data(), "Catalog", "catcache.bin")
    local map_path = fs.join(require("paths").data_dir(), "epic_namespaces.json")
    local quote = function(text) return "'" .. tostring(text):gsub("'", "''") .. "'" end
    local ok, result = pcall(require("launchers.common").run_powershell_json, "epic_namespace", table.concat({
        "$app = " .. quote(app_name) .. "; $mapFile = " .. quote(map_path) .. "; $catalog = " .. quote(catalog),
        [[
$ns = ''
if (Test-Path -LiteralPath $mapFile) { try { $ns = [string](Get-Content -LiteralPath $mapFile -Raw | ConvertFrom-Json).$app } catch {} }
if (-not $ns -and (Test-Path -LiteralPath $catalog)) {
  $map = @{}
  $items = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((Get-Content -LiteralPath $catalog -Raw))) | ConvertFrom-Json
  foreach ($item in $items) { foreach ($release in $item.releaseInfo) { if ($release.appId -and $item.namespace) { $map[[string]$release.appId] = [string]$item.namespace } } }
  [IO.File]::WriteAllText($mapFile, (ConvertTo-Json -Compress $map))
  $ns = [string]$map[$app]
}
ConvertTo-Json @($ns)
]],
    }, "\n"))
    local namespace = ok and type(result) == "table" and type(result[1]) == "string" and result[1] or ""
    if not ok then logger:error("info: epic catalog namespace: " .. tostring(result)) end
    namespace_known[app_name] = namespace
    return namespace
end

-- Epic: the store namespace of an installed game, read from its install manifest; when Epic
-- couldn't write one, from its catalog cache
function ugi_epic_namespace(a_app_name, b_dir)
    local app_name = tostring(a_app_name or "")
    local dir = tostring(b_dir or "")
    if dir == "" then dir = fs.join(epic_data(), "Manifests") end
    for _, entry in ipairs(fs.exists(dir) and fs.list(dir) or {}) do
        if entry.is_file and entry.path:lower():match("%.item$") then
            local ok, item = pcall(cjson.decode, utils.read_file(entry.path) or "")
            if ok and type(item) == "table" and item.AppName == app_name and item.CatalogNamespace then
                return tostring(item.CatalogNamespace)
            end
        end
    end
    return app_name ~= "" and catalog_namespace(app_name) or ""
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
