-- Epic Games Store: install manifests in ProgramData
local fs = require("fs")
local utils = require("utils")
local cjson = require("json")
local logger = require("logger")
local common = require("launchers.common")

local M = {
    id = "epic",
    name = "Epic Games",
    os = "windows",
    supports_path = true,
}

local function manifests_dir()
    local program_data = utils.getenv("ProgramData") or [[C:\ProgramData]]
    return fs.join(program_data, "Epic", "EpicGamesLauncher", "Data", "Manifests")
end

local function has_category(item, category)
    for _, c in ipairs(type(item.AppCategories) == "table" and item.AppCategories or {}) do
        if c == category then return true end
    end
    return false
end

function M.is_installed(custom)
    return fs.exists(custom or manifests_dir())
end

-- custom: another manifests folder
function M.discover(custom)
    local dir = custom or manifests_dir()
    if not fs.exists(dir) then return {} end

    local games, seen = {}, {}
    for _, entry in ipairs(fs.list(dir) or {}) do
        local path = type(entry) == "table" and (entry.path or entry.name) or entry
        if type(path) == "string" and path:lower():match("%.item$") then
            local full = fs.exists(path) and path or fs.join(dir, path)
            local ok, item = pcall(cjson.decode, utils.read_file(full) or "")
            if ok and type(item) == "table" and item.AppName and item.DisplayName and item.InstallLocation
                and not item.bIsIncompleteInstall
                -- DLC manifests point to their main game
                and (item.MainGameAppName == nil or item.MainGameAppName == "" or item.MainGameAppName == item.AppName)
                and not seen[item.AppName] then
                seen[item.AppName] = true
                local uri = "com.epicgames.launcher://apps/" .. item.AppName .. "?action=launch&silent=true"
                games[#games + 1] = common.with_launch({
                    id = "epic:" .. item.AppName,
                    launcher = M.id,
                    name = item.DisplayName,
                    kind = has_category(item, "games") and "game" or "app",
                    icon = nil,
                }, common.launch_through(uri, nil, item.InstallLocation))
            elseif not ok then
                logger:error("epic: cannot read manifest " .. tostring(full))
            end
        end
    end
    return games
end

return M
