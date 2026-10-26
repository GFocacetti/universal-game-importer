local logger = require("logger")
local millennium = require("millennium")
local cjson = require("json")
local launchers = require("launchers.registry")
local state = require("state")
require("images") -- registers the ugi_sgdb_* / ugi_download* / ugi_missing_images calls

-- Frontend calls. Arguments arrive by name; JSON strings keep complex data intact.

-- a_options: JSON { enabled = { [id] = bool }, paths = { [id] = "custom folder" } }
function ugi_scan(a_options)
    local ok, options = pcall(cjson.decode, a_options or "{}")
    if not ok or type(options) ~= "table" then options = {} end
    local result = launchers.scan(type(options.enabled) == "table" and options.enabled or {},
        type(options.paths) == "table" and options.paths or {})
    logger:info("scan: " .. #result.games .. " games")
    local json = cjson.encode(result)
    logger:info("scan: result encoded, " .. #json .. " bytes")
    return json
end

function ugi_get_state()
    return cjson.encode(state.load())
end

function ugi_save_state(json)
    local ok, decoded = pcall(cjson.decode, json or "")
    if not ok or type(decoded) ~= "table" then
        logger:error("ugi_save_state: invalid json")
        return false
    end
    state.save(decoded)
    return true
end

-- Startup diagnostics from the frontend, appended to data/frontend.log
function ugi_log(a_message)
    local f = io.open(require("fs").join(require("paths").data_dir(), "frontend.log"), "a")
    if f then
        f:write(os.date("%Y-%m-%d %H:%M:%S "), tostring(a_message), "\n")
        f:close()
    end
    return true
end

local function on_load()
    logger:info("UGI backend loading, Millennium " .. tostring(millennium.version()))
    -- Ready first: nothing slow may run before this, or Steam's startup waits for it
    millennium.ready()
    -- Leftover from an earlier build that cached Store lookups in the plugin config
    if millennium.config.get("ugi_xbox_kinds") ~= nil then millennium.config.delete("ugi_xbox_kinds") end
    launchers.prepare_all()
end

local function on_unload()
    logger:info("UGI backend unloaded")
end

local function on_frontend_loaded()
    logger:info("UGI frontend loaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
    on_frontend_loaded = on_frontend_loaded,
}
