local fs = require("fs")
local utils = require("utils")

local M = {}

-- Folder for UGI's generated files (scan scripts, launch helpers), inside the plugin folder
function M.data_dir()
    local dir = fs.join(utils.get_backend_path(), "..", "data")
    if not fs.exists(dir) then
        fs.create_directories(dir)
    end
    -- Clean Windows path (no "..", consistent separators): it ends up in Steam's shortcut settings
    local clean = fs.canonical(dir) or dir
    return (clean:gsub("/", "\\"))
end

return M
