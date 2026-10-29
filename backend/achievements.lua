-- Achievements of imported games: GOG from Galaxy's database, Xbox from OpenXBL (with the user's key)
-- or the Xbox app's cache (only the games opened in the app), Epic from its store (signed in for the unlocked ones)
local cjson = require("json")
local logger = require("logger")
local common = require("launchers.common")

local GOG_SCRIPT = [==[
$ErrorActionPreference = 'Stop'
$db = Join-Path $env:ProgramData 'GOG.com\Galaxy\storage\galaxy-2.0.db'
if (-not (Test-Path $db)) { '[]'; return }
__SQLITE__
$same = "x.gameReleaseKey = a.gameReleaseKey AND x.apikey = a.apikey"
$sql = "SELECT a.apikey,
  COALESCE(l.name, e.name, (SELECT x.name FROM LocalizedAchievements x WHERE $same LIMIT 1)),
  COALESCE(l.description, e.description, (SELECT x.description FROM LocalizedAchievements x WHERE $same LIMIT 1)),
  a.imageUnlockedUrl, a.imageLockedUrl, a.isVisible, a.rarity,
  (SELECT MAX(x.isUnlocked) FROM UserAchievements x WHERE $same),
  (SELECT MAX(x.unlockTime) FROM UserAchievements x WHERE $same AND x.isUnlocked = 1)
FROM Achievements a
LEFT JOIN LocalizedAchievements l ON l.gameReleaseKey = a.gameReleaseKey AND l.apikey = a.apikey AND l.languageId = (SELECT id FROM Languages WHERE code = '__LANG__')
LEFT JOIN LocalizedAchievements e ON e.gameReleaseKey = a.gameReleaseKey AND e.apikey = a.apikey AND e.languageId = (SELECT id FROM Languages WHERE code = 'en-US')
WHERE a.gameReleaseKey = 'gog___ID__'"
$out = foreach ($r in [UgiSqlite]::Query($db, $sql, 9)) {
  [PSCustomObject]@{
    id = $r[0]; name = $r[1]; description = $r[2]; image = $r[3]; image_locked = $r[4]
    secret = $r[5] -eq '0'; rarity = [double]$r[6]; unlocked = $r[7] -eq '1'
    # Galaxy keeps the time in UTC, without the zone
    time = if ($r[8]) { ($r[8] -replace ' ', 'T') + 'Z' } else { $null }
  }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

-- The cache is keyed by Xbox title id: found from the package family through the cached store product
local XBOX_SCRIPT = [==[
$ErrorActionPreference = 'Stop'
$db = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.GamingApp_8wekyb3d8bbwe\LocalState\AsyncCache.db'
if (-not (Test-Path $db)) { '[]'; return }
__SQLITE__
function Cached($where) {
  # The list as one value: returned row by row, PowerShell would spread each row into loose strings
  ,[UgiSqlite]::Query($db, "SELECT key, CAST(value AS TEXT) FROM AsyncCache WHERE $where", 2)
}
$product = $null
foreach ($r in (Cached "scope = 'product_altid_pfn' AND key = '__FAMILY__'")) { $product = ($r[1] | ConvertFrom-Json).data }
if (-not $product) { '[]'; return }
$title = $null
foreach ($r in (Cached "scope = 'product_summary' AND key = '$product'")) {
  $title = (($r[1] | ConvertFrom-Json).data.alternateIds | Where-Object { $_.idType -eq 'XBOXTITLEID' } | Select-Object -First 1).id
}
if (-not $title) {
  foreach ($r in (Cached "scope = 'product_altid_titleid' AND CAST(value AS TEXT) LIKE '%`"$product`"%'")) { $title = $r[0] }
}
if (-not $title) { '[]'; return }
$list = @()
foreach ($r in (Cached "scope = 'achievements' AND key LIKE 'achievements%' AND substr(key, -length('_$title')) = '_$title'")) {
  # ConvertFrom-Json hands a JSON list over as one value: ForEach-Object takes it apart
  $items = @($r[1] | ConvertFrom-Json | ForEach-Object { $_ })
  if ($items.Count -gt $list.Count) { $list = $items }
}
$out = foreach ($a in $list) {
  $unlocked = $a.isUnlocked -eq $true -or $a.progressState -eq 'Achieved'
  [PSCustomObject]@{
    id = $a.id; name = $a.name
    description = if ($unlocked -and $a.description.unlocked) { $a.description.unlocked } else { $a.description.locked }
    image = $a.imageUrl; secret = $a.isSecret -eq $true; unlocked = $unlocked
    rarity = $a.rarity.currentPercentage; time = if ($unlocked) { $a.timeUnlocked } else { $null }
    gamerscore = $a.gamerscore
  }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

local function with_sqlite(script)
    return script:gsub("__SQLITE__", function() return common.SQLITE_READER end)
end

local function local_items(script)
    local ok, items = pcall(common.run_powershell_json, "achievements", script)
    if not ok then
        logger:error("achievements: " .. tostring(items))
        return {}
    end
    return items
end

-- ---------- Web requests ----------

-- Epic's store is behind a bot check that lets Windows' own curl.exe through (not PowerShell's
-- requests). The request (with its token) goes in a config file for curl, deleted afterwards.
local function config_quote(text)
    return '"' .. (tostring(text):gsub('[\\"]', "\\%0")) .. '"'
end

-- request: { url, method, headers, body, type }; returns status, decoded JSON body (or nil)
local function web(request)
    local fs = require("fs")
    local utils = require("utils")
    local dir = require("paths").data_dir()
    local config = fs.join(dir, "web_request.txt")
    local body_file = fs.join(dir, "web_body.txt")
    local out = fs.join(dir, "web_response.json")
    if fs.exists(out) then fs.remove(out) end

    local lines = {
        "url = " .. config_quote(request.url),
        "request = " .. (request.method or "GET"),
        "silent",
        "max-time = 20",
        "output = " .. config_quote(out),
        'write-out = "%{http_code}"',
    }
    for name, header in pairs(request.headers or {}) do
        if name == "User-Agent" then
            lines[#lines + 1] = "user-agent = " .. config_quote(header)
        else
            lines[#lines + 1] = "header = " .. config_quote(name .. ": " .. header)
        end
    end
    if request.body then
        local f = io.open(body_file, "wb")
        if not f then return 0, nil end
        f:write(request.body)
        f:close()
        lines[#lines + 1] = "header = " .. config_quote("Content-Type: " .. (request.type or "application/json"))
        lines[#lines + 1] = "data-binary = " .. config_quote("@" .. body_file)
    end
    local f = io.open(config, "wb")
    if not f then return 0, nil end
    f:write(table.concat(lines, "\n"), "\n")
    f:close()

    local system = utils.getenv("SystemRoot") or [[C:\Windows]]
    local status = tonumber((utils.exec(string.format('%s\\System32\\curl.exe -K "%s"', system, config)) or ""):match("(%d%d%d)%s*$")) or 0
    if fs.exists(config) then fs.remove(config) end
    if fs.exists(body_file) then fs.remove(body_file) end

    local raw = fs.exists(out) and (utils.read_file(out) or "") or ""
    if fs.exists(out) then fs.remove(out) end
    -- An empty text is never decoded: the JSON module can't take it
    if not raw:match("^%s*[%[{]") then return status, nil end
    local ok, body = pcall(cjson.decode, raw)
    return status, ok and body or nil
end

-- JSON null comes back as a special value: plain nil instead
local function value(x)
    if x == nil or type(x) == "userdata" then return nil end
    return x
end

-- ---------- Xbox: OpenXBL (a free key from xbl.io) ----------

local function xbox_online(title, key, lang)
    local status, body = web({
        url = "https://xbl.io/api/v2/achievements/title/" .. title,
        method = "GET",
        headers = { ["X-Authorization"] = key, ["Accept-Language"] = lang, ["Accept"] = "application/json" },
    })
    if status ~= 200 or type(body) ~= "table" or type(body.achievements) ~= "table" then
        logger:error("achievements: OpenXBL answered " .. tostring(status))
        return nil
    end
    local items = {}
    for _, a in ipairs(body.achievements) do
        local unlocked = value(a.progressState) == "Achieved"
        local image
        for _, asset in ipairs(value(a.mediaAssets) or {}) do
            if value(asset.type) == "Icon" then image = value(asset.url) break end
        end
        local gamerscore
        for _, reward in ipairs(value(a.rewards) or {}) do
            if value(reward.type) == "Gamerscore" then gamerscore = tonumber(value(reward.value)) end
        end
        local time = value((value(a.progression) or {}).timeUnlocked)
        items[#items + 1] = {
            id = tostring(value(a.id) or #items),
            name = value(a.name),
            description = (unlocked and value(a.description)) or value(a.lockedDescription) or value(a.description),
            image = image,
            secret = value(a.isSecret) == true,
            unlocked = unlocked,
            rarity = tonumber(value((value(a.rarity) or {}).currentPercentage)),
            time = (unlocked and time and not time:match("^0001")) and time or nil,
            gamerscore = gamerscore,
        }
    end
    return items
end

-- ---------- Epic: signed in with the launcher's own sign-in, as Legendary does ----------

local EPIC_OAUTH = "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token"
-- Client id and secret of the Epic Games Launcher (from Legendary, GPL-3.0)
local EPIC_BASIC = "Basic MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y="
local EPIC_GRAPHQL = "https://store.epicgames.com/graphql"
local EPIC_UA = "EpicGamesLauncher/15.17.1-35104619+++Portal+Release-Live"

local function epic_file()
    return require("fs").join(require("paths").data_dir(), "epic_account.json")
end

local function epic_load()
    local path = epic_file()
    if not require("fs").exists(path) then return nil end
    local raw = require("utils").read_file(path) or ""
    if not raw:match("^%s*{") then return nil end
    local ok, account = pcall(cjson.decode, raw)
    return ok and type(account) == "table" and account or nil
end

local function epic_token(form)
    local status, body = web({
        url = EPIC_OAUTH,
        method = "POST",
        headers = { ["Authorization"] = EPIC_BASIC, ["User-Agent"] = EPIC_UA },
        body = form .. "&token_type=eg1",
        type = "application/x-www-form-urlencoded",
    })
    if status ~= 200 or type(body) ~= "table" or not value(body.access_token) then
        logger:error("achievements: Epic sign-in answered " .. tostring(status))
        return nil
    end
    local account = {
        access_token = body.access_token,
        refresh_token = value(body.refresh_token),
        account_id = value(body.account_id),
        display_name = value(body.displayName) or "",
        -- A minute early, to never use an expired token
        expires = os.time() + (tonumber(value(body.expires_in)) or 0) - 60,
    }
    local f = io.open(epic_file(), "wb")
    if f then
        f:write(cjson.encode(account))
        f:close()
    end
    return account
end

local function encode_form(text)
    return (tostring(text):gsub("[^%w%-_%.~]", function(c) return string.format("%%%02X", c:byte()) end))
end

-- The saved account with a valid token (renewed when expired), or nil when not signed in
local function epic_account()
    local account = epic_load()
    if not account then return nil end
    if os.time() < (tonumber(account.expires) or 0) then return account end
    if not account.refresh_token then return nil end
    return epic_token("grant_type=refresh_token&refresh_token=" .. encode_form(account.refresh_token))
end

local function epic_graphql(account, query, variables)
    local headers = { ["User-Agent"] = EPIC_UA, ["Accept"] = "application/json" }
    if account then headers["Authorization"] = "bearer " .. account.access_token end
    local status, body = web({
        url = EPIC_GRAPHQL,
        method = "POST",
        headers = headers,
        body = cjson.encode({ query = query, variables = variables }),
        type = "application/json",
    })
    if status ~= 200 or type(body) ~= "table" then
        logger:error("achievements: Epic store answered " .. tostring(status))
        return nil
    end
    return value(body.data)
end

local EPIC_DEFINITIONS = [[query Achievement($sandboxId: String!, $locale: String!) {
  Achievement { productAchievementsRecordBySandbox(sandboxId: $sandboxId, locale: $locale) {
    achievements { achievement { name hidden unlockedDisplayName lockedDisplayName unlockedDescription lockedDescription unlockedIconLink lockedIconLink rarity { percent } } }
  } }
}]]

local EPIC_PLAYER = [[query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) {
  PlayerAchievement { playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) {
    records { playerAchievements { playerAchievement { unlocked unlockDate achievementName } } }
  } }
}]]

-- The game's achievements; signed_out is true when the unlocked ones can't be known
local function epic_online(sandbox, lang)
    local account = epic_account()
    local data = epic_graphql(account, EPIC_DEFINITIONS, { sandboxId = sandbox, locale = lang })
    local record = value(value((value((data or {}).Achievement) or {}).productAchievementsRecordBySandbox) or {}) or {}
    local definitions = value(record.achievements) or {}
    if #definitions == 0 then return nil end

    local state = {}
    if account and account.account_id then
        local player = epic_graphql(account, EPIC_PLAYER, { epicAccountId = account.account_id, sandboxId = sandbox })
        local records = value(value((value((player or {}).PlayerAchievement) or {}).playerAchievementGameRecordsBySandbox) or {}) or {}
        for _, rec in ipairs(value(records.records) or {}) do
            for _, entry in ipairs(value(rec.playerAchievements) or {}) do
                local p = value(entry.playerAchievement)
                if p and value(p.achievementName) then state[p.achievementName] = p end
            end
        end
    end

    local items = {}
    for _, entry in ipairs(definitions) do
        local a = value(entry.achievement)
        if a and value(a.name) then
            local p = state[a.name]
            local unlocked = p ~= nil and value(p.unlocked) == true
            items[#items + 1] = {
                id = a.name,
                name = unlocked and value(a.unlockedDisplayName) or value(a.lockedDisplayName) or value(a.unlockedDisplayName),
                description = unlocked and value(a.unlockedDescription) or value(a.lockedDescription) or value(a.unlockedDescription),
                image = value(a.unlockedIconLink),
                image_locked = value(a.lockedIconLink),
                secret = value(a.hidden) == true,
                unlocked = unlocked,
                rarity = tonumber(value((value(a.rarity) or {}).percent)),
                time = unlocked and value(p.unlockDate) or nil,
            }
        end
    end
    return items, account == nil
end

-- a_code: what the Epic page shows after signing in (the code, or the whole text with it)
-- Returns the account name, or "" when it didn't work
function ugi_epic_sign_in(a_code)
    local text = tostring(a_code or "")
    local code = text:match('"authorizationCode"%s*:%s*"(%w+)"') or text:match("^%s*(%w+)%s*$")
    if not code then return "" end
    local account = epic_token("grant_type=authorization_code&code=" .. code)
    return account and account.display_name or ""
end

-- The signed-in account's name, or ""
function ugi_epic_account()
    local account = epic_load()
    return account and (account.display_name or "") or ""
end

function ugi_epic_sign_out()
    local fs = require("fs")
    if fs.exists(epic_file()) then fs.remove(epic_file()) end
    return true
end

-- ---------- The frontend call ----------

-- a_id: the imported game's id ("gog:1207658754", "xbox:<family>!<app>", "epic:<app name>"); b_lang: "it-IT"
-- c_extra: JSON { title = Xbox title id, key = OpenXBL key, sandbox = Epic namespace }
-- Returns {"source":"gog","items":[...]} (plus "signed_out" for Epic), or {"items":[]} when there is nothing
function ugi_achievements(a_id, b_lang, c_extra)
    local id = tostring(a_id or "")
    local lang = tostring(b_lang or ""):match("^%a%a%-%a%a$") or "en-US"
    local ok, extra = pcall(cjson.decode, c_extra or "{}")
    if not ok or type(extra) ~= "table" then extra = {} end

    local gog = id:match("^gog:(%d+)$")
    local family = id:match("^xbox:([%w%._%-]+)!")
    local items, source, signed_out
    if gog then
        source = "gog"
        items = local_items(with_sqlite(GOG_SCRIPT):gsub("__ID__", gog):gsub("__LANG__", lang))
    elseif family then
        source = "xbox"
        local title = tostring(value(extra.title) or ""):match("^%d+$")
        local key = tostring(value(extra.key) or "")
        if title and key ~= "" then items = xbox_online(title, key, lang) end
        -- Without a key (or if OpenXBL fails): the Xbox app's cache
        if not items or #items == 0 then
            items = local_items(with_sqlite(XBOX_SCRIPT):gsub("__FAMILY__", function() return family end))
        end
    elseif id:match("^epic:") then
        source = "epic"
        local sandbox = tostring(value(extra.sandbox) or ""):match("^[%w%-_]+$")
        if sandbox then items, signed_out = epic_online(sandbox, lang:sub(1, 2)) end
    end
    if not items or #items == 0 then return '{"items":[]}' end
    return cjson.encode({ source = source, items = items, signed_out = signed_out or nil })
end
