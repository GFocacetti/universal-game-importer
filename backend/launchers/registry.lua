local logger = require("logger")
local common = require("launchers.common")

-- Every launcher module exposes: id, name, os ("windows" / "linux"), discover() and optionally prepare()
local M = {
    list = {
        require("launchers.xbox"),
        require("launchers.epic"),
        require("launchers.gog"),
        require("launchers.ea"),
        require("launchers.battlenet"),
        require("launchers.amazon"),
    },
}

local function current_os()
    return package.config:sub(1, 1) == "\\" and "windows" or "linux"
end

function M.available()
    local os_name = current_os()
    local out = {}
    for _, launcher in ipairs(M.list) do
        if launcher.os == os_name then
            out[#out + 1] = launcher
        end
    end
    return out
end

function M.prepare_all()
    local ok, err = pcall(common.prepare)
    if not ok then
        logger:error("prepare common failed: " .. tostring(err))
    end
    for _, launcher in ipairs(M.available()) do
        if launcher.prepare then
            local ok, err = pcall(launcher.prepare)
            if not ok then
                logger:error("prepare " .. launcher.id .. " failed: " .. tostring(err))
            end
        end
    end
end

-- Runs every available launcher; a failing launcher is reported but doesn't stop the others
function M.scan(enabled, paths)
    local result = { launchers = {}, games = {} }
    for _, launcher in ipairs(M.available()) do
        local entry = { id = launcher.id, name = launcher.name, enabled = enabled[launcher.id] ~= false, count = 0,
            supports_path = launcher.supports_path == true, installed = true }
        if launcher.is_installed then
            local ok_installed, installed = pcall(launcher.is_installed, paths[launcher.id])
            entry.installed = ok_installed and installed == true
        end
        if entry.enabled then
            local custom = paths[launcher.id]
            if custom == "" then custom = nil end
            local ok, games = pcall(launcher.discover, custom)
            if ok then
                entry.count = #games
                for _, game in ipairs(games) do
                    result.games[#result.games + 1] = game
                end
            else
                entry.error = tostring(games)
                logger:error("scan " .. launcher.id .. " failed: " .. entry.error)
            end
        end
        result.launchers[#result.launchers + 1] = entry
    end
    return result
end

return M
