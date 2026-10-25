local logger = require("logger")
local millennium = require("millennium")
local cjson = require("json")
local launchers = require("launchers.registry")
local state = require("state")

-- Frontend calls. Arguments arrive by name; JSON strings keep complex data intact.

function ugi_scan()
    local result = launchers.scan({})
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
