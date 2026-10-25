local logger = require("logger")
local cjson = require("json")
local helpers = require("helpers")
local config = require("config")
local steam_user = require("steam_user")
local sync = require("sync")
local millennium = require("millennium")
local client_manager = require("client_manager")

local function get_managed_shortcuts_internal()
    local vdf = require("vdf")
    local constants = require("constants")
    

    local doc = vdf.parse_shortcuts_vdf(sync.shortcuts_vdf_path())
    local shortcuts = doc.shortcuts or {}
    local enabled_set = {}

    for _, sc in ipairs(shortcuts) do
        local aumid = helpers.parse_managed_aumid_from_shortcut(sc, constants.PLUGIN_TAG)
        if aumid then
            enabled_set[aumid] = sc
        end
    end
    local games = millennium.config.get("uwp_snapshot") or {}

    local result = {}

    for _, game in ipairs(games) do
        local sc = enabled_set[tostring(game.aumid)]

        result[#result + 1] = {
            id = game.aumid,
            name = game.display_name,
            icon = game.icon,
            source = game.source,
            enabled = sc ~= nil
        }
    end

    table.sort(result, function(a, b)
        return tostring(a.name):lower() < tostring(b.name):lower()
    end)

    return result
end

local function get_settings_state_internal()
    local ids = steam_user.current_steam_user_ids()
    local disabled_shortcuts = config.get_disabled_shortcuts()
    local managed_shortcuts = get_managed_shortcuts_internal()
    return {
        current_user = {
            steamid64 = ids.steamid64,
            steam3 = ids.steam3,
            account_name = ids.account_name,
            persona_name = ids.persona_name
        },
        default_disablelist_enabled = config.get_default_disablelist_enabled(),
        auto_resync_on_startup = config.get_auto_resync_on_startup(),
        disabled_shortcuts = disabled_shortcuts,
        managed_shortcuts = managed_shortcuts,
        last_sync_at = config.get_last_sync_at(),
    }
end

-- Exported functions for frontend calls
function get_settings_state()
    logger:info("get_settings_state called")
    return cjson.encode(get_settings_state_internal())
end

function get_managed_shortcuts()
    logger:info("get_managed_shortcuts called")
    return cjson.encode(get_managed_shortcuts_internal())
end

function set_disabled_shortcuts(json)
    logger:info("set_disabled_shortcuts called with: " .. tostring(json))

    if type(json) ~= "string" or json == "" then
        logger:error("set_disabled_shortcuts expected json string")
        return false
    end

    local ok, payload = pcall(cjson.decode, json)
    if not ok or type(payload) ~= "table" then
        logger:error("set_disabled_shortcuts failed to decode json")
        return false
    end

    local ids = payload.ids
    if type(ids) ~= "table" then
        logger:error("set_disabled_shortcuts payload.ids must be table")
        return false
    end

    local normalized = config.set_disabled_shortcuts_config(ids)
    helpers.safe_call_frontend("UGI.onDisabledShortcutsChanged", { cjson.encode(normalized) })
    return true
end

function set_default_disablelist_enabled(bool)
    logger:info("set_default_disablelist_enabled called with: " .. tostring(bool))

    if type(bool) ~= "boolean" then
        logger:error("set_default_disablelist_enabled expected boolean value")
        return false
    end

    millennium.config.set("default_disablelist_enabled", bool)
    helpers.safe_call_frontend("UGI.onDefaultDisableListChanged", { bool })
    return true
end

function set_auto_resync_on_startup(bool)
    logger:info("set_auto_resync_on_startup called with: " .. tostring(bool))

    if type(bool) ~= "boolean" then
        logger:error("set_auto_resync_on_startup expected boolean value")
        return false
    end

    millennium.config.set("auto_resync_on_startup", bool)
    helpers.safe_call_frontend("UGI.onAutoResyncChanged", { bool })
    return true
end

function resync_library()
    logger:info("resync_library called")
    local ok, result = pcall(sync.sync_uwp_games_to_steam_internal)
    if not ok then
        logger:error("resync_library failed: " .. tostring(result))
        return cjson.encode({
            success = false,
            changed = false,
            message = tostring(result),
            synced_at = helpers.current_timestamp_iso8601()
        })
    end

    helpers.safe_call_frontend("UGI.onResyncFinished", {
        cjson.encode(result)
    })
    return cjson.encode(result)
end

function restart_steam_client()
    client_manager.restart_steam_client()
end

function read_image_as_data_url(path)
    if type(path) ~= "string" or path == "" then
        logger:error("read_image_as_data_url expected non-empty string path")
        return nil
    end

    local ok, data = pcall(function()
        return client_manager.read_image(path)
    end)

    if not ok then
        logger:error("read_image_as_data_url failed to read file: " .. tostring(data))
        return nil
    end

    return data
end


return {
    get_settings_state_internal = get_settings_state_internal,
    get_managed_shortcuts_internal = get_managed_shortcuts_internal,
    get_settings_state = get_settings_state,
    get_managed_shortcuts = get_managed_shortcuts,
    set_disabled_shortcuts = set_disabled_shortcuts,
    set_default_disablelist_enabled = set_default_disablelist_enabled,
    set_auto_resync_on_startup = set_auto_resync_on_startup,
    resync_library = resync_library,
    restart_steam_client = restart_steam_client,
    read_image_as_data_url = read_image_as_data_url,
}