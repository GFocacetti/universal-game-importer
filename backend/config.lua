local millennium = require("millennium")
local cjson = require("json")
local helpers = require("helpers")
local utils = require("utils")
local fs = require("fs")

local function ensure_default_config(key, value)
    local existing = millennium.config.get(key)
    if existing == nil then
        millennium.config.set(key, value)
        return value
    end
    return existing
end

local function get_default_disablelist_enabled()
    local v = millennium.config.get("default_disablelist_enabled")
    if v == nil then
        return true
    end
    return v == true
end

local function get_auto_resync_on_startup()
    local v = millennium.config.get("auto_resync_on_startup")
    if v == nil then
        return true
    end
    return v == true
end

local function get_disabled_shortcuts()
    local v = millennium.config.get("disabled_shortcuts")

    if type(v) == "string" and v ~= "" then
        local ok, decoded = pcall(cjson.decode, v)
        if ok and type(decoded) == "table" then
            return helpers.normalize_string_list(decoded)
        end
        return {}
    end

    if type(v) == "table" then
        return helpers.normalize_string_list(v)
    end

    return {}
end

local function set_disabled_shortcuts_config(ids)
    local normalized = helpers.normalize_string_list(ids or {})
    millennium.config.set("disabled_shortcuts", cjson.encode(normalized))
    return normalized
end

local function set_last_sync_at(value)
    millennium.config.set("last_sync_at", value)
end

local function get_last_sync_at()
    return millennium.config.get("last_sync_at")
end


local function get_plugin_info()
    local pluginJson = utils.read_file(fs.join(utils.get_backend_path(), "../plugin.json"))
    local pluginInfo = cjson.decode(pluginJson or "{}")
    return {
        version = pluginInfo.version or "unknown",
        name = pluginInfo.name or "unknown",
        common_name = pluginInfo.common_name or "unknown",
        description = pluginInfo.description or "No description",
    }
end

local temp = utils.getenv("TEMP") or utils.getenv("TMP") or fs.current_path()
local launcherScriptPath = fs.join(temp, "uwp_launcher.ps1")

-- Initialize defaults
ensure_default_config("default_disablelist_enabled", true)
ensure_default_config("disabled_shortcuts", "[]")
ensure_default_config("auto_resync_on_startup", true)
ensure_default_config("last_sync_at", nil)

return {
    ensure_default_config = ensure_default_config,
    get_default_disablelist_enabled = get_default_disablelist_enabled,
    get_auto_resync_on_startup = get_auto_resync_on_startup,
    get_disabled_shortcuts = get_disabled_shortcuts,
    set_disabled_shortcuts_config = set_disabled_shortcuts_config,
    set_last_sync_at = set_last_sync_at,
    get_last_sync_at = get_last_sync_at,
    get_plugin_info = get_plugin_info,
    get_uwp_launcher_script_path = launcherScriptPath
}
