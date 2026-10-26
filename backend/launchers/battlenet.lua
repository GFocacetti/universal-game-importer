-- Battle.net: installed products are listed in the agent's product.db (a protobuf file)
local fs = require("fs")
local utils = require("utils")
local common = require("launchers.common")

local M = {
    id = "battlenet",
    name = "Battle.net",
    os = "windows",
    supports_path = true,
}

local function agent_dir(custom)
    return custom or fs.join(utils.getenv("ProgramData") or [[C:\ProgramData]], "Battle.net", "Agent")
end

function M.is_installed(custom)
    return fs.exists(fs.join(agent_dir(custom), "product.db"))
end

-- Product code -> name and launch id. Table from Steam ROM Manager (GPL-3.0),
-- which credits steamgriddb-manager.
local GAMES = {
    d3 = { name = "Diablo III", launch = "D3" },
    dst2 = { name = "Destiny 2", launch = "DST2" },
    hero = { name = "Heroes of the Storm", launch = "Hero" },
    odin = { name = "Call of Duty: Modern Warfare", launch = "ODIN" },
    pro = { name = "Overwatch 2", launch = "Pro" },
    s1 = { name = "Starcraft Remastered", launch = "S1" },
    s2 = { name = "Starcraft 2", launch = "S2" },
    viper = { name = "Call of Duty: Black Ops 4", launch = "VIPR" },
    w3 = { name = "Warcraft 3: Reforged", launch = "W3" },
    hsb = { name = "Hearthstone", launch = "WTCG" },
    wlby = { name = "Crash Bandicoot 4", launch = "WLBY" },
    wow = { name = "World of Warcraft", launch = "WoW" },
    zeus = { name = "Call of Duty: Black Ops Cold War", launch = "ZEUS" },
    fenris = { name = "Diablo IV", launch = "Fen" },
    anbs = { name = "Diablo Immortal", launch = "ANBS" },
    osi = { name = "Diablo II: Resurrected", launch = "OSI" },
    rtro = { name = "Blizzard Arcade Collection", launch = "RTRO" },
    lazr = { name = "Call of Duty: Modern Warfare 2 Campaign Remastered", launch = "LAZR" },
    fore = { name = "Call of Duty: Vanguard", launch = "FORE" },
    auks = { name = "Call of Duty", launch = "AUKS" },
}

-- Minimal protobuf reader: returns { [field] = { values... } } for one message
local function read_message(data, from, to)
    local fields, pos = {}, from
    local function varint()
        local result, shift = 0, 0
        repeat
            local byte = data:byte(pos)
            if not byte then error("battlenet: truncated product.db") end
            pos = pos + 1
            result = result + (byte % 128) * 2 ^ shift
            shift = shift + 7
        until byte < 128
        return result
    end
    while pos <= to do
        local key = varint()
        local field, wire = math.floor(key / 8), key % 8
        local value
        if wire == 0 then
            value = varint()
        elseif wire == 2 then
            local len = varint()
            value = { from = pos, to = pos + len - 1 }
            pos = pos + len
        elseif wire == 1 then
            pos = pos + 8
        elseif wire == 5 then
            pos = pos + 4
        else
            break
        end
        fields[field] = fields[field] or {}
        table.insert(fields[field], value)
    end
    return fields
end

local function text(data, span)
    return span and data:sub(span.from, span.to) or nil
end

-- custom: another Battle.net Agent folder (the one with product.db)
function M.discover(custom)
    local db = fs.join(agent_dir(custom), "product.db")
    if not fs.exists(db) then return {} end
    local data = utils.read_file(db)
    if not data or data == "" then return {} end

    -- Database { repeated ProductInstall product_install = 1 }
    -- ProductInstall { uid = 1; product_code = 2; settings = 3 { install_path = 1 } }
    local installs, client_dir = {}, nil
    for _, span in ipairs(read_message(data, 1, #data)[1] or {}) do
        local install = read_message(data, span.from, span.to)
        local uid = text(data, (install[1] or {})[1])
        local code = text(data, (install[2] or {})[1])
        local settings = (install[3] or {})[1]
        local path = settings and text(data, (read_message(data, settings.from, settings.to)[1] or {})[1])
        if uid == "battle.net" then
            client_dir = path
        elseif code and path then
            installs[#installs + 1] = { code = code:lower(), path = path:gsub("/", "\\") }
        end
    end
    if not client_dir then return {} end
    local client = fs.join(client_dir:gsub("/", "\\"), "Battle.net.exe")

    local games = {}
    for _, install in ipairs(installs) do
        local known = GAMES[install.code]
        if known then
            games[#games + 1] = common.with_launch({
                id = "battlenet:" .. install.code,
                launcher = M.id,
                name = known.name,
                kind = "game",
            }, common.launch_through(client, '--exec="launch ' .. known.launch .. '"', install.path))
        end
    end
    return games
end

return M
