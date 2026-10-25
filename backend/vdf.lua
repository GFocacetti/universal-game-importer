local logger = require("logger")
local constants = require("constants")

-- Low-level binary helpers
local function read_u32_le(data, pos)
    local b1, b2, b3, b4 = data:byte(pos, pos + 3)
    if not b1 or not b2 or not b3 or not b4 then
        error("read_u32_le: eof at " .. tostring(pos))
    end
    local n = b1 + b2 * 256 + b3 * 65536 + b4 * 16777216
    return n, pos + 4
end

local function read_cstring(data, pos)
    local len = #data
    local start = pos
    while pos <= len do
        local b = data:byte(pos, pos)
        if not b then
            error("read_cstring: eof before terminator at " .. tostring(start))
        end
        if b == 0 then
            if pos == start then
                return "", pos + 1
            else
                return data:sub(start, pos - 1), pos + 1
            end
        end
        pos = pos + 1
    end
    error("read_cstring: unterminated string at " .. tostring(start))
end

local function write_cstring(s)
    s = tostring(s or "")
    if s:find("\0", 1, true) then
        s = s:gsub("%z", "")
    end
    return s .. "\0"
end

local function write_u32_le(n)
    n = tonumber(n) or 0
    if n < 0 then n = 0 end
    n = n % 4294967296
    local b1 = n % 256
    n = (n - b1) / 256
    local b2 = n % 256
    n = (n - b2) / 256
    local b3 = n % 256
    n = (n - b3) / 256
    local b4 = n % 256
    return string.char(b1, b2, b3, b4)
end

-- Generic VDF reader/writer

local function read_vdf_pair(data, pos)
    local len = #data
    if pos > len then
        return "", { type = constants.TYPE_END, value = nil }, pos
    end

    local tid = data:byte(pos, pos)
    if not tid then
        return "", { type = constants.TYPE_END, value = nil }, pos
    end
    pos = pos + 1

    if tid == constants.TYPE_END then
        return "", { type = constants.TYPE_END, value = nil }, pos
    end

    local key
    key, pos = read_cstring(data, pos)

    local v = { type = tid, value = nil }

    if tid == constants.TYPE_MAP then
        local map = {}
        while true do
            local child_key, child_v
            child_key, child_v, pos = read_vdf_pair(data, pos)
            if child_v.type == constants.TYPE_END then
                break
            end
            map[#map + 1] = { key = child_key, value = child_v }
        end
        v.value = map
    elseif tid == constants.TYPE_NUMBER then
        local num
        num, pos = read_u32_le(data, pos)
        v.value = num
    elseif tid == constants.TYPE_STRING then
        local str
        str, pos = read_cstring(data, pos)
        v.value = str
    else
        error("read_vdf_pair: unknown type id " .. tostring(tid))
    end

    return key, v, pos
end

local function write_vdf_map(map)
    local chunks = {}
    for i = 1, #map do
        local entry = map[i]
        local v = entry.value
        chunks[#chunks + 1] = string.char(v.type)
        chunks[#chunks + 1] = write_cstring(entry.key)

        if v.type == constants.TYPE_MAP then
            chunks[#chunks + 1] = write_vdf_map(v.value)
        elseif v.type == constants.TYPE_NUMBER then
            chunks[#chunks + 1] = write_u32_le(v.value or 0)
        elseif v.type == constants.TYPE_STRING then
            chunks[#chunks + 1] = write_cstring(v.value or "")
        else
            error("write_vdf_map: unknown type id " .. tostring(v.type))
        end
    end
    chunks[#chunks + 1] = string.char(constants.TYPE_END)
    return table.concat(chunks)
end

local function write_vdf_root_shortcuts(shortcuts)
    local root_children = {}
    for i = 1, #shortcuts do
        root_children[#root_children + 1] = {
            key = tostring(i - 1),
            value = { type = constants.TYPE_MAP, value = shortcuts[i] }
        }
    end

    local chunks = {}
    chunks[#chunks + 1] = string.char(constants.TYPE_MAP)
    chunks[#chunks + 1] = write_cstring("shortcuts")
    chunks[#chunks + 1] = write_vdf_map(root_children)
    chunks[#chunks + 1] = string.char(constants.TYPE_END)

    return table.concat(chunks)
end

-- Shortcut conversion

local function shortcut_from_map(map)
    local sc = {
        appid = 0,
        appname = "",
        exe = "\"\"",
        StartDir = "\"\"",
        icon = "\"\"",
        ShortcutPath = "\"\"",
        LaunchOptions = "\"\"",
        IsHidden = 0,
        AllowDesktopConfig = 0,
        AllowOverlay = 1,
        openvr = 0,
        Devkit = 0,
        DevkitGameID = "",
        DevkitOverrideAppID = 0,
        LastPlayTime = 0,
        FlatpakAppID = "",
        tags = {}
    }

    for i = 1, #map do
        local key = map[i].key
        local v = map[i].value
        local lk = key:lower()

        if v.type == constants.TYPE_NUMBER then
            if lk == "appid" then
                sc.appid = v.value or 0
            elseif lk == "ishidden" then
                sc.IsHidden = v.value or 0
            elseif lk == "allowdesktopconfig" then
                sc.AllowDesktopConfig = v.value or 0
            elseif lk == "allowoverlay" then
                sc.AllowOverlay = v.value or 0
            elseif lk == "openvr" then
                sc.openvr = v.value or 0
            elseif lk == "devkit" then
                sc.Devkit = v.value or 0
            elseif lk == "devkitoverrideappid" then
                sc.DevkitOverrideAppID = v.value or 0
            elseif lk == "lastplaytime" then
                sc.LastPlayTime = v.value or 0
            end
        elseif v.type == constants.TYPE_STRING then
            if lk == "appname" then
                sc.appname = v.value or ""
            elseif lk == "exe" then
                sc.exe = v.value or ""
            elseif lk == "startdir" then
                sc.StartDir = v.value or ""
            elseif lk == "icon" then
                sc.icon = v.value or ""
            elseif lk == "shortcutpath" then
                sc.ShortcutPath = v.value or ""
            elseif lk == "launchoptions" then
                sc.LaunchOptions = v.value or ""
            elseif lk == "devkitgameid" then
                sc.DevkitGameID = v.value or ""
            elseif lk == "flatpakappid" then
                sc.FlatpakAppID = v.value or ""
            end
        elseif v.type == constants.TYPE_MAP and lk == "tags" then
            local tags = {}
            local tag_map = v.value or {}
            for j = 1, #tag_map do
                local tagv = tag_map[j].value
                if tagv.type == constants.TYPE_STRING and tagv.value ~= nil then
                    tags[#tags + 1] = tagv.value
                end
            end
            sc.tags = tags
        end
    end

    return sc
end

local function shortcut_to_map(sc)
    local map = {}

    local function num_field(name, value)
        map[#map + 1] = { key = name, value = { type = constants.TYPE_NUMBER, value = value or 0 } }
    end

    local function str_field(name, value)
        map[#map + 1] = { key = name, value = { type = constants.TYPE_STRING, value = value or "" } }
    end

    num_field("appid", sc.appid or 0)
    str_field("appname", sc.appname or "")
    str_field("exe", sc.exe or "\"\"")
    str_field("StartDir", sc.StartDir or "\"\"")
    str_field("icon", sc.icon or "\"\"")
    str_field("ShortcutPath", sc.ShortcutPath or "\"\"")
    str_field("LaunchOptions", sc.LaunchOptions or "\"\"")
    num_field("IsHidden", sc.IsHidden or 0)
    num_field("AllowDesktopConfig", sc.AllowDesktopConfig or 0)
    num_field("AllowOverlay", sc.AllowOverlay or 1)
    num_field("openvr", sc.openvr or 0)
    num_field("Devkit", sc.Devkit or 0)
    str_field("DevkitGameID", sc.DevkitGameID or "")
    num_field("DevkitOverrideAppID", sc.DevkitOverrideAppID or 0)
    num_field("LastPlayTime", sc.LastPlayTime or 0)
    str_field("FlatpakAppID", sc.FlatpakAppID or "")

    local tags = sc.tags or {}
    local tag_children = {}
    for i = 1, #tags do
        tag_children[#tag_children + 1] = {
            key = tostring(i - 1),
            value = { type = constants.TYPE_STRING, value = tags[i] }
        }
    end
    map[#map + 1] = {
        key = "tags",
        value = { type = constants.TYPE_MAP, value = tag_children }
    }

    return map
end

-- shortcuts.vdf parse/serialize

local function parse_shortcuts_vdf(path)
    local fs = require("fs")
    local utils = require("utils")

    if not fs.exists(path) then
        return { shortcuts = {} }
    end

    local data, err = utils.read_file(path)
    if not data then
        error("parse_shortcuts_vdf: failed to read " .. tostring(path) .. ": " .. tostring(err))
    end

    local key, root_v = read_vdf_pair(data, 1)
    if root_v.type ~= constants.TYPE_MAP or key ~= "shortcuts" then
        error("parse_shortcuts_vdf: invalid root, expected Map 'shortcuts'")
    end

    local shortcuts = {}
    local root_children = root_v.value or {}
    for i = 1, #root_children do
        local child = root_children[i]
        local v = child.value
        if v.type == constants.TYPE_MAP then
            shortcuts[#shortcuts + 1] = shortcut_from_map(v.value or {})
        end
    end

    return { shortcuts = shortcuts }
end

local function serialize_shortcuts_vdf(doc)
    local shortcuts = doc.shortcuts or {}
    local shortcut_maps = {}
    for i = 1, #shortcuts do
        shortcut_maps[i] = shortcut_to_map(shortcuts[i])
    end
    logger:info("Serializing " .. tostring(#shortcuts) .. " shortcuts to VDF")
    return write_vdf_root_shortcuts(shortcut_maps)
end

return {
    parse_shortcuts_vdf = parse_shortcuts_vdf,
    serialize_shortcuts_vdf = serialize_shortcuts_vdf,
}