local logger = require("logger")
local millennium = require("millennium")

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function safe_call_frontend(method, args)
    local ok, result = pcall(function()
        return millennium.call_frontend_method(method, args or {})
    end)

    if not ok then
        logger:error("Failed to call frontend method " .. tostring(method) .. ": " .. tostring(result))
        return nil
    end

    return result
end

local function list_to_set(items)
    local set = {}
    for _, item in ipairs(items or {}) do
        set[tostring(item)] = true
    end
    return set
end

local function normalize_string_list(items)
    local out = {}
    local seen = {}
    for _, item in ipairs(items or {}) do
        local s = tostring(item or "")
        if s ~= "" and not seen[s] then
            seen[s] = true
            out[#out + 1] = s
        end
    end
    return out
end

local function current_timestamp_iso8601()
    return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function parse_managed_aumid_from_shortcut(sc, PLUGIN_TAG)
    local path = tostring(sc.ShortcutPath or "")
    local prefix = PLUGIN_TAG
    if path:sub(1, #prefix) == prefix then
        return path:sub(#prefix + 1)
    end
    return nil
end

return {
    trim = trim,
    safe_call_frontend = safe_call_frontend,
    list_to_set = list_to_set,
    normalize_string_list = normalize_string_list,
    current_timestamp_iso8601 = current_timestamp_iso8601,
    parse_managed_aumid_from_shortcut = parse_managed_aumid_from_shortcut,
}