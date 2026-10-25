local fs = require("fs")
local millennium = require("millennium")
local utils = require("utils")
local constants = require("constants")
local helpers = require("helpers")

local function parse_loginusers_vdf_text(text)
    local users = {}
    local current_userid = nil
    local current = nil

    for raw_line in tostring(text or ""):gmatch("[^\r\n]+") do
        local line = helpers.trim(raw_line)

        local quoted = {}
        for q in line:gmatch('"([^"]*)"') do
            quoted[#quoted + 1] = q
        end

        if #quoted == 1 then
            local k = quoted[1]
            if k:match("^%d+$") then
                current_userid = k
                current = {}
                users[#users + 1] = { steamid64 = current_userid, values = current }
            end
        elseif #quoted >= 2 and current then
            current[quoted[1]] = quoted[2]
        end
    end

    return users
end

local function subtract_decimal_strings(a, b)
    a = tostring(a):gsub("^0+", "")
    b = tostring(b):gsub("^0+", "")
    if a == "" then a = "0" end
    if b == "" then b = "0" end

    if #a < #b or (#a == #b and a < b) then
        error("subtract_decimal_strings: negative result")
    end

    local i, j = #a, #b
    local borrow = 0
    local out = {}

    while i > 0 do
        local da = a:byte(i) - 48
        local db = 0
        if j > 0 then
            db = b:byte(j) - 48
            j = j - 1
        end

        da = da - borrow
        if da < db then
            da = da + 10
            borrow = 1
        else
            borrow = 0
        end

        out[#out + 1] = string.char(48 + (da - db))
        i = i - 1
    end

    local res = table.concat(out):reverse():gsub("^0+", "")
    if res == "" then res = "0" end
    return res
end

local function current_steam_user_ids()
    local steam_root = millennium.steam_path()
    local loginusers_path = fs.join(steam_root, "config", "loginusers.vdf")

    local raw, err = utils.read_file(loginusers_path)
    if not raw or raw == "" then
        error("failed to read loginusers.vdf: " .. tostring(err))
    end

    local users = parse_loginusers_vdf_text(raw)
    if not users or #users == 0 then
        error("no users found in loginusers.vdf")
    end

    local most_recent = nil
    for _, entry in ipairs(users) do
        local values = entry.values or {}
        if tostring(values["MostRecent"] or values["mostrecent"] or "0") == "1" then
            most_recent = entry
            break
        end
    end

    if not most_recent then
        for _, entry in ipairs(users) do
            local values = entry.values or {}
            if tostring(values["AllowAutoLogin"] or values["allowautologin"] or values["AutoLogin"] or values["autologin"] or "0") == "1" then
                most_recent = entry
                break
            end
        end
    end

    -- Recent Steam clients may write neither MostRecent nor AllowAutoLogin: fall back to the latest login timestamp
    if not most_recent then
        local best_timestamp = -1
        for _, entry in ipairs(users) do
            local values = entry.values or {}
            local timestamp = tonumber(values["Timestamp"] or values["timestamp"] or "0") or 0
            if timestamp > best_timestamp then
                best_timestamp = timestamp
                most_recent = entry
            end
        end
    end

    if not most_recent then
        error("could not determine current Steam user from loginusers.vdf")
    end

    local steamid64 = tostring(most_recent.steamid64)
    local steam3_account_id = subtract_decimal_strings(steamid64, constants.STEAMID64_BASE)

    return {
        steamid64 = steamid64,
        steam3 = steam3_account_id,
        account_name = most_recent.values["AccountName"] or most_recent.values["accountname"] or "",
        persona_name = most_recent.values["PersonaName"] or most_recent.values["personaname"] or ""
    }
end

return {
    current_steam_user_ids = current_steam_user_ids,
}