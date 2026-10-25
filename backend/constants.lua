local PLUGIN_TAG = "__ugi_xbox_aumid="
local STEAM_EXE = [[C:\Windows\explorer.exe]]
local STEAM_STARTDIR = [[C:\Windows]]
local STEAMID64_BASE = "76561197960265728"

-- Binary VDF type constants
local TYPE_MAP = 0
local TYPE_STRING = 1
local TYPE_NUMBER = 2
local TYPE_END = 0x08

return {
    PLUGIN_TAG = PLUGIN_TAG,
    STEAM_EXE = STEAM_EXE,
    STEAM_STARTDIR = STEAM_STARTDIR,
    STEAMID64_BASE = STEAMID64_BASE,
    TYPE_MAP = TYPE_MAP,
    TYPE_STRING = TYPE_STRING,
    TYPE_NUMBER = TYPE_NUMBER,
    TYPE_END = TYPE_END,
}