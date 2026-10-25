local fs = require("fs")
local utils = require("utils")
local cjson = require("json")
local constants = require("constants")
local helpers = require("helpers")
local config = require("config")

local function choose_asset(game)
    if game.icon and game.icon ~= "" and fs.exists(game.icon) then return game.icon end
    if game.cover and game.cover ~= "" and fs.exists(game.cover) then return game.cover end
    if game.hero and game.hero ~= "" and fs.exists(game.hero) then return game.hero end
    return "\"\""
end

local function normalize_quoted_path(path)
    path = tostring(path or "")
    if path == "" then return "\"\"" end
    if utils.startswith(path, [["]]) and utils.endswith(path, [["]]) then
        return path
    end
    return [["]] .. path .. [["]]
end

local function normalize_tags(tags)
    local seen, out = {}, {}
    for _, tag in ipairs(tags or {}) do
        if tag and tag ~= "" and not seen[tag] then
            seen[tag] = true
            out[#out + 1] = tag
        end
    end
    return out
end

local function make_shortcut_from_game(game)
    local aumid = tostring(game.aumid or "")
    local cmd_exe = "C:\\Windows\\System32\\cmd.exe"
    local ps_cmd = string.format(
    '/c ""C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%s" -Aumid "%s""',
        config.get_uwp_launcher_script_path, aumid)

    local start_dir = ""
    local last_slash = config.get_uwp_launcher_script_path:match("(.*)[\\/]")
    if last_slash then
        start_dir = last_slash
    else
        start_dir = "C:\\Windows"
    end

    return {
        appid = 0,
        appname = tostring(game.display_name or ""),
        exe = normalize_quoted_path(cmd_exe),
        StartDir = normalize_quoted_path(start_dir),
        icon = choose_asset(game),
        ShortcutPath = constants.PLUGIN_TAG .. aumid,
        LaunchOptions = ps_cmd,
        IsHidden = 0,
        AllowDesktopConfig = 1,
        AllowOverlay = 1,
        openvr = 0,
        Devkit = 0,
        DevkitGameID = "",
        DevkitOverrideAppID = 0,
        LastPlayTime = 0,
        FlatpakAppID = "",
        tags = normalize_tags({ "UWP" })
    }
end

local function find_managed_entry(shortcuts, aumid)
    local marker = constants.PLUGIN_TAG .. tostring(aumid)
    for i = 1, #shortcuts do
        local path = shortcuts[i].ShortcutPath or ""
        if path:find(marker, 1, true) then
            return i
        end
    end
    return nil
end

local function same_tags(a, b)
    a = a or {}
    b = b or {}
    if #a ~= #b then return false end
    for i = 1, #a do
        if a[i] ~= b[i] then return false end
    end
    return true
end

local function same_shortcut(a, b)
    return (a.appname or "") == (b.appname or "")
        and (a.exe or "") == (b.exe or "")
        and (a.StartDir or "") == (b.StartDir or "")
        and (a.icon or "") == (b.icon or "")
        and (a.ShortcutPath or "") == (b.ShortcutPath or "")
        and (a.LaunchOptions or "") == (b.LaunchOptions or "")
        and (a.IsHidden or 0) == (b.IsHidden or 0)
        and (a.AllowDesktopConfig or 0) == (b.AllowDesktopConfig or 0)
        and (a.AllowOverlay or 0) == (b.AllowOverlay or 0)
        and (a.openvr or 0) == (b.openvr or 0)
        and (a.Devkit or 0) == (b.Devkit or 0)
        and (a.DevkitGameID or "") == (b.DevkitGameID or "")
        and (a.DevkitOverrideAppID or 0) == (b.DevkitOverrideAppID or 0)
        and (a.LastPlayTime or 0) == (b.LastPlayTime or 0)
        and (a.FlatpakAppID or "") == (b.FlatpakAppID or "")
        and same_tags(a.tags, b.tags)
end

local function get_default_disablelist_set()
    if not config.get_default_disablelist_enabled() then
        return {}
    end
    return helpers.list_to_set({
        "Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App", "Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App",
        "Microsoft.ScreenSketch_8wekyb3d8bbwe!App", "Microsoft.SecHealthUI_8wekyb3d8bbwe!SecHealthUI",
        "Microsoft.Windows.Photos_8wekyb3d8bbwe!App", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
        "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App", "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
        "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", "Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App",
        "MicrosoftWindows.Client.CBS_cw5n1h2txyewy!WebExperienceHost",
        "MicrosoftWindows.Client.CBS_cw5n1h2txyewy!WindowsBackup",
        "MicrosoftWindows.Client.CoreAI_cw5n1h2txyewy!ClickToDoApp",
        "NVIDIACorp.NVIDIAControlPanel_56jybvy8sckqj!NVIDIACorp.NVIDIAControlPanel",
        "Raycast.Raycast_qypenmj9wpt2a!Raycast",
        "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"
    })
end

local function should_include_game(game, disabled_set, disablelist_set)
    local aumid = tostring(game.aumid or "")
    if aumid == "" then
        return false
    end
    if disabled_set[aumid] then
        return false
    end
    if disablelist_set[aumid] then
        return false
    end
    return true
end

local function merge_games(doc, games)
    local changed = false
    local shortcuts = doc.shortcuts or {}

    local disabled_set = helpers.list_to_set(config.get_disabled_shortcuts())
    local disablelist_set = get_default_disablelist_set()

    local desired_by_aumid = {}

    for _, game in ipairs(games or {}) do
        if game.display_name and game.aumid and game.shell_target and should_include_game(game, disabled_set, disablelist_set) then
            desired_by_aumid[tostring(game.aumid)] = game
        end
    end

    for i = #shortcuts, 1, -1 do
        local sc = shortcuts[i]
        local aumid = helpers.parse_managed_aumid_from_shortcut(sc, constants.PLUGIN_TAG)
        if aumid and not desired_by_aumid[aumid] then
            table.remove(shortcuts, i)
            changed = true
        end
    end

    for _, game in pairs(desired_by_aumid) do
        local idx = find_managed_entry(shortcuts, game.aumid)
        local sc = make_shortcut_from_game(game)

        if idx then
            local existing = shortcuts[idx]
            sc.appid = existing.appid or 0
            sc.LastPlayTime = existing.LastPlayTime or 0
            if not same_shortcut(existing, sc) then
                shortcuts[idx] = sc
                changed = true
            end
        else
            shortcuts[#shortcuts + 1] = sc
            changed = true
        end
    end

    doc.shortcuts = shortcuts
    return changed, doc
end

local function powershell_discover_games()
    local temp = utils.getenv("TEMP") or utils.getenv("TMP") or fs.current_path()
    local out_json = fs.join(temp, "millennium_uwp_scan.json")
    local temp_script = fs.join(temp, "millennium_scan_worker.ps1")

    local ps = [==[
$ErrorActionPreference = 'SilentlyContinue'

$startApps = Get-StartApps

$packages = Get-AppxPackage | ForEach-Object {
  $pkg = $_
  $manifest = Get-AppxPackageManifest $pkg
  foreach ($app in $manifest.Package.Applications.Application) {
    $ve = $app.VisualElements
    $defaultTile = $null
    $square44 = $null
    $square150 = $null
    $wide310 = $null

    if ($ve) {
      $square44 = $ve.Square44x44Logo
      $square150 = $ve.Square150x150Logo
      $defaultTile = $ve.DefaultTile
      if ($defaultTile) {
        $wide310 = $defaultTile.Wide310x150Logo
      }
    }

    [PSCustomObject]@{
      Name = $pkg.Name
      PackageFamilyName = $pkg.PackageFamilyName
      ApplicationId = $app.Id
      AUMID = "$($pkg.PackageFamilyName)!$($app.Id)"
      InstallLocation = $pkg.InstallLocation
      Square44x44Logo = $square44
      Square150x150Logo = $square150
      Wide310x150Logo = $wide310
    }
  }
}

function Resolve-AssetPath {
  param([string]$InstallLocation, [string]$RelativePath)

  if ([string]::IsNullOrWhiteSpace($InstallLocation) -or [string]::IsNullOrWhiteSpace($RelativePath)) {
    return $null
  }

  $rel = $RelativePath -replace '/', '\'
  $direct = Join-Path $InstallLocation $rel
  if (Test-Path $direct) { return $direct }

  $parent = Split-Path -Parent $direct
  $leaf = Split-Path -Leaf $direct
  $stem = [System.IO.Path]::GetFileNameWithoutExtension($leaf)
  $ext = [System.IO.Path]::GetExtension($leaf)

  if (-not (Test-Path $parent)) { return $null }

  $candidate = Get-ChildItem -LiteralPath $parent -File | Where-Object {
    $_.Name -eq $leaf -or
    $_.Name -like "$stem.scale-*${ext}" -or
    $_.Name -like "$stem.targetsize-*${ext}"
  } | Sort-Object Name | Select-Object -First 1

  if ($candidate) { return $candidate.FullName }
  return $null
}

$joined = foreach ($sa in $startApps) {
  $match = $packages | Where-Object { $_.AUMID -eq $sa.AppID } | Select-Object -First 1
  if ($match) {
    [PSCustomObject]@{
      display_name = $sa.Name
      aumid = $sa.AppID
      shell_target = "shell:AppsFolder\$($sa.AppID)"
      package_family_name = $match.PackageFamilyName
      install_location = $match.InstallLocation
      icon = Resolve-AssetPath $match.InstallLocation $match.Square44x44Logo
      cover = Resolve-AssetPath $match.InstallLocation $match.Square150x150Logo
      hero = Resolve-AssetPath $match.InstallLocation $match.Wide310x150Logo
    }
  }
}

$joined | ConvertTo-Json -Depth 5
]==]

    local ok_script, err_script = utils.write_file(temp_script, ps)
    if not ok_script then
        error("failed to write temporary PowerShell script: " .. tostring(err_script))
    end

    local cmd = [[powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "& ']]
        .. temp_script
        .. [[' | Out-File -FilePath ']]
        .. out_json
        .. [[' -Encoding ascii"]]

    utils.exec(cmd)

    local raw, err = utils.read_file(out_json)
    if not raw or raw == "" then
        error("PowerShell produced no JSON output: " .. tostring(err))
    end

    raw = raw:gsub("^\239\187\191", "")
    raw = helpers.trim(raw)

    local ok, decoded = pcall(cjson.decode, raw)
    if not ok or type(decoded) ~= "table" then
        error("decoded JSON is not a table")
    end

    if decoded.display_name then
        decoded = { decoded }
    end

    return decoded
end

return {
    powershell_discover_games = powershell_discover_games,
    merge_games = merge_games,
}
