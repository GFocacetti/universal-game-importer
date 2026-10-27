local fs = require("fs")
local utils = require("utils")

local M = {}

-- Folder for UGI's generated files (scripts, icons, caches, log), inside the plugin folder
function M.data_dir()
    local dir = fs.join(utils.get_backend_path(), "..", "data")
    if not fs.exists(dir) then
        fs.create_directories(dir)
    end
    -- Clean Windows path (no "..", consistent separators): it ends up in Steam's shortcut settings
    local clean = fs.canonical(dir) or dir
    return (clean:gsub("/", "\\"))
end

-- Steam's custom artwork folders, one per Steam user
function M.grid_dirs()
    local millennium = require("millennium")
    local dirs = {}
    local userdata = fs.join(millennium.steam_path(), "userdata")
    for _, user in ipairs(fs.exists(userdata) and fs.list(userdata) or {}) do
        if user.is_directory then
            local grid = fs.join(user.path, "config", "grid")
            if fs.exists(grid) then dirs[#dirs + 1] = grid end
        end
    end
    return dirs
end

-- Appends a line to data/ugi.log (backups, restores and their problems)
function M.log(message)
    local f = io.open(fs.join(M.data_dir(), "ugi.log"), "a")
    if f then
        f:write(os.date("%Y-%m-%d %H:%M:%S "), tostring(message), "\n")
        f:close()
    end
end

return M
