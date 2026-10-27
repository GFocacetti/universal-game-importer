local millennium = require("millennium")
local cjson = require("json")

-- UGI's persistent state (shape defined by the frontend, see types.ts), stored in the plugin config.
-- imported and excluded are always present.
local KEY = "ugi_state"

local M = {}

local function empty()
    return { imported = {}, excluded = {} }
end

function M.load()
    local raw = millennium.config.get(KEY)
    if type(raw) ~= "string" or raw == "" then
        return empty()
    end
    local ok, decoded = pcall(cjson.decode, raw)
    if not ok or type(decoded) ~= "table" then
        return empty()
    end
    decoded.imported = type(decoded.imported) == "table" and decoded.imported or {}
    decoded.excluded = type(decoded.excluded) == "table" and decoded.excluded or {}
    return decoded
end

function M.save(state)
    millennium.config.set(KEY, cjson.encode(state))
end

return M
