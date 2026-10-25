local logger = require("logger")
local millennium = require("millennium")
local helpers = require("helpers")
local config = require("config")
local backend = require("backend")
local sync = require("sync")
local cjson = require("json")
local client_manager = require("client_manager")
local backend_ready = false

local function on_load()
    local pluginInfo = config.get_plugin_info()
    logger:info("UWP plugin backend v" .. (pluginInfo.version or "unknown") .. " loading with Millennium version " .. tostring(millennium.version()))

    -- Config defaults are already set in config.lua, but ensure they exist
    config.ensure_default_config("default_disablelist_enabled", true)
    config.ensure_default_config("disabled_shortcuts", "[]")
    config.ensure_default_config("auto_resync_on_startup", true)
    config.ensure_default_config("last_sync_at", nil)

    millennium.config.on_change(function(key, value)
        logger:info("Config changed: " .. tostring(key) .. " = " .. tostring(value))
        if backend_ready then
            helpers.safe_call_frontend("UGI.onConfigChanged", { tostring(key), tostring(value) })
        end
    end)


    client_manager.write_uwp_launcher_script(config.get_uwp_launcher_script_path)

    backend_ready = true
    -- Signal ready before the (slow) UWP scan, so Steam startup isn't held up by it
    millennium.ready()

    if config.get_auto_resync_on_startup() then
        local ok, err = pcall(sync.sync_uwp_games_to_steam_internal)
        if not ok then
            logger:error("UWP sync failed on load: " .. tostring(err))
        end
    else
        logger:info("Auto-resync on startup disabled")
    end
end

local function on_unload()
    logger:info("Plugin unloaded")
end

local function on_frontend_loaded()
    logger:info("Frontend loaded")
    helpers.safe_call_frontend("UGI.onBackendReady", {
        cjson.encode(backend.get_settings_state_internal())
    })
end

-- Export the plugin interface
return {
    on_load = on_load,
    on_unload = on_unload,
    on_frontend_loaded = on_frontend_loaded,
    -- Expose backend functions for direct calls from Millennium
    get_settings_state = backend.get_settings_state,
    get_managed_shortcuts = backend.get_managed_shortcuts,
    set_disabled_shortcuts = backend.set_disabled_shortcuts,
    set_default_disablelist_enabled = backend.set_default_disablelist_enabled,
    set_auto_resync_on_startup = backend.set_auto_resync_on_startup,
    resync_library = backend.resync_library,
    restart_steam_client = backend.restart_steam_client,
    read_image_as_data_url = backend.read_image_as_data_url,
}