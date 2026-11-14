-- Updating UGI from its GitHub releases, on the user's request (Settings → Updates).
-- Until Millennium's own plugin list carries UGI, this is how a manual install gets a new version.

local logger = require("logger")
local cjson = require("json")
local http = require("http")
local fs = require("fs")
local utils = require("utils")
local paths = require("paths")

local REPO = "GFocacetti/universal-game-importer"

local function plugin_dir()
    local dir = fs.join(utils.get_backend_path(), "..")
    return ((fs.canonical(dir) or dir):gsub("/", "\\"))
end

local function installed_version()
    local raw = utils.read_file(fs.join(plugin_dir(), "plugin.json")) or ""
    return raw:match('"version"%s*:%s*"([%d%.]+)"') or "0"
end

-- "0.67.10" > "0.67.9"
local function newer(a, b)
    local x, y = {}, {}
    for n in a:gmatch("%d+") do x[#x + 1] = tonumber(n) end
    for n in b:gmatch("%d+") do y[#y + 1] = tonumber(n) end
    for i = 1, math.max(#x, #y) do
        if (x[i] or 0) ~= (y[i] or 0) then return (x[i] or 0) > (y[i] or 0) end
    end
    return false
end

local function latest()
    local res, err = http.get("https://api.github.com/repos/" .. REPO .. "/releases/latest", {
        headers = { ["Accept"] = "application/vnd.github+json", ["User-Agent"] = "UGI" },
        timeout = 20,
    })
    if not res or res.status ~= 200 then
        logger:error("update: GitHub answered " .. tostring(res and res.status or err))
        return nil
    end
    local ok, release = pcall(cjson.decode, res.body)
    if not ok or type(release) ~= "table" then return nil end
    local version = tostring(release.tag_name or ""):match("^v?([%d%.]+)$")
    local zip
    for _, asset in ipairs(type(release.assets) == "table" and release.assets or {}) do
        local name = tostring(asset.name or "")
        if name:match("^UGI%-[%d%.]+%.zip$") then zip = tostring(asset.browser_download_url) end
    end
    if not version or not zip then return nil end
    return { version = version, zip = zip, url = tostring(release.html_url or "") }
end

-- {"current":"0.67.3","latest":"0.67.4","url":"<release page>"}; "latest" is missing when GitHub
-- couldn't be read, and equal to "current" when UGI is up to date
function ugi_update_check()
    local current = installed_version()
    local release = latest()
    if not release then return cjson.encode({ current = current }) end
    return cjson.encode({ current = current, latest = newer(release.version, current) and release.version or current, url = release.url })
end

-- Downloads the latest release and copies it over the plugin's files (UGI's data folder stays as
-- it is); the new version runs after Steam restarts. Returns the installed version, or "".
function ugi_update_install()
    local release = latest()
    if not release or not newer(release.version, installed_version()) then return "" end

    local work = fs.join(paths.data_dir(), "update")
    local zip = fs.join(work, "ugi.zip")
    local unpacked = fs.join(work, "unpacked")
    local system = utils.getenv("SystemRoot") or [[C:\Windows]]
    utils.exec(string.format('cmd /c rmdir /s /q "%s"', work))
    fs.create_directories(unpacked)

    utils.exec(string.format('%s\\System32\\curl.exe -s -L --max-time 120 -o "%s" "%s"', system, zip, release.zip))
    utils.exec(string.format('%s\\System32\\tar.exe -x -f "%s" -C "%s"', system, zip, unpacked))
    -- The zip holds one folder, universal-game-importer
    local source = fs.join(unpacked, "universal-game-importer")
    local manifest = utils.read_file(fs.join(source, "plugin.json")) or ""
    if not fs.exists(fs.join(source, "backend", "main.lua")) or manifest:match('"version"%s*:%s*"([%d%.]+)"') ~= release.version then
        logger:error("update: the downloaded release looks incomplete")
        utils.exec(string.format('cmd /c rmdir /s /q "%s"', work))
        return ""
    end

    -- robocopy: exit codes below 8 mean success
    local _, code = utils.exec(string.format('cmd /c robocopy "%s" "%s" /E /NFL /NDL /NJH /NJS /NP', source, plugin_dir()))
    utils.exec(string.format('cmd /c rmdir /s /q "%s"', work))
    if installed_version() ~= release.version then
        logger:error("update: copying the new files failed (" .. tostring(code) .. ")")
        return ""
    end
    logger:info("update: installed " .. release.version .. ", active after Steam restarts")
    return release.version
end
