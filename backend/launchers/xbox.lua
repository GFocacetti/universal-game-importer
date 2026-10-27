-- Xbox / Microsoft Store games (UWP and GDK packages)
-- Discovery and launcher derived from millennium-uwp-library-sync (MIT), see THIRD_PARTY_NOTICES.md

local fs = require("fs")
local utils = require("utils")
local cjson = require("json")
local logger = require("logger")
local paths = require("paths")
local common = require("launchers.common")

local M = {
    id = "xbox",
    name = "Xbox",
    os = "windows",
}

-- System apps and overlays that are never offered for import
local HIDDEN = {
    ["Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App"] = true,
    ["Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App"] = true,
    ["Microsoft.ScreenSketch_8wekyb3d8bbwe!App"] = true,
    ["Microsoft.SecHealthUI_8wekyb3d8bbwe!SecHealthUI"] = true,
    ["Microsoft.Windows.Photos_8wekyb3d8bbwe!App"] = true,
    ["Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"] = true,
    ["Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"] = true,
    ["Microsoft.WindowsStore_8wekyb3d8bbwe!App"] = true,
    ["Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"] = true,
    ["MicrosoftWindows.Client.CBS_cw5n1h2txyewy!WebExperienceHost"] = true,
    ["MicrosoftWindows.Client.CBS_cw5n1h2txyewy!WindowsBackup"] = true,
    ["MicrosoftWindows.Client.CoreAI_cw5n1h2txyewy!ClickToDoApp"] = true,
    ["NVIDIACorp.NVIDIAControlPanel_56jybvy8sckqj!NVIDIACorp.NVIDIAControlPanel"] = true,
    ["windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"] = true,
}

local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'SilentlyContinue'
$startApps = Get-StartApps
$packages = @{}
Get-AppxPackage | ForEach-Object {
  $pkg = $_
  if ($pkg.IsFramework -or $pkg.IsResourcePackage) { return }
  $manifest = Get-AppxPackageManifest $pkg
  foreach ($app in $manifest.Package.Applications.Application) {
    $ve = $app.VisualElements
    $packages["$($pkg.PackageFamilyName)!$($app.Id)"] = [PSCustomObject]@{
      InstallLocation = $pkg.InstallLocation
      Square44 = if ($ve) { $ve.Square44x44Logo } else { $null }
      IsGame = (Test-Path (Join-Path $pkg.InstallLocation 'MicrosoftGame.config'))
    }
  }
}
function Resolve-AssetPath([string]$Root, [string]$Rel) {
  if ([string]::IsNullOrWhiteSpace($Root) -or [string]::IsNullOrWhiteSpace($Rel)) { return $null }
  $direct = Join-Path $Root ($Rel -replace '/', '\')
  if (Test-Path $direct) { return $direct }
  $parent = Split-Path -Parent $direct
  if (-not (Test-Path $parent)) { return $null }
  $leaf = Split-Path -Leaf $direct
  $stem = [System.IO.Path]::GetFileNameWithoutExtension($leaf)
  $ext = [System.IO.Path]::GetExtension($leaf)
  $c = Get-ChildItem -LiteralPath $parent -File | Where-Object { $_.Name -like "$stem.scale-*$ext" -or $_.Name -like "$stem.targetsize-*$ext" } | Sort-Object Name | Select-Object -First 1
  if ($c) { return $c.FullName }
  return $null
}
$out = foreach ($sa in $startApps) {
  $p = $packages[$sa.AppID]
  if ($p) {
    [PSCustomObject]@{
      name = $sa.Name
      aumid = $sa.AppID
      install_location = $p.InstallLocation
      icon = Resolve-AssetPath $p.InstallLocation $p.Square44
      is_game = [bool]$p.IsGame
    }
  }
}
@($out) | ConvertTo-Json -Depth 4 -Compress
]==]

local LAUNCHER_SCRIPT = [==[
param([string]$Aumid)
if (-not $Aumid) { exit 1 }
$csharp = @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager
{
    int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
                            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
                            uint options, out uint processId);
}

[ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
class ApplicationActivationManager { }

public class UgiUwpLauncher
{
    public static void LaunchAndWait(string aumid)
    {
        var activator = (IApplicationActivationManager)new ApplicationActivationManager();
        uint pid = 0;
        int hr = activator.ActivateApplication(aumid, null, 0, out pid);
        if (hr < 0) throw new Exception(string.Format("ActivateApplication failed: 0x{0:X8}", hr));

        Process target = null;
        if (pid != 0) {
            try { target = Process.GetProcessById((int)pid); } catch { }
        }
        if (target == null) {
            string family = aumid.Split('!')[0];
            for (int i = 0; i < 120 && target == null; i++) {
                Thread.Sleep(500);
                foreach (var p in Process.GetProcesses()) {
                    try { if (p.ProcessName.IndexOf(family, StringComparison.OrdinalIgnoreCase) >= 0) { target = p; break; } } catch { }
                }
            }
        }
        if (target != null) target.WaitForExit();
    }
}
"@
Add-Type -TypeDefinition $csharp -ReferencedAssemblies "System.dll", "System.Core"
[UgiUwpLauncher]::LaunchAndWait($Aumid)
]==]

local POWERSHELL = common.POWERSHELL
local CONHOST = common.CONHOST

local function launcher_script_path()
    return fs.join(paths.data_dir(), "uwp_launcher.ps1")
end

function M.prepare()
    local ok, err = utils.write_file(launcher_script_path(), LAUNCHER_SCRIPT)
    if not ok then
        logger:error("xbox: cannot write launcher script: " .. tostring(err))
    end
end

function M.discover()
    local dir = paths.data_dir()
    local script = fs.join(dir, "xbox_scan.ps1")
    local out = fs.join(dir, "xbox_scan.json")
    assert(utils.write_file(script, SCAN_SCRIPT))
    if fs.exists(out) then fs.remove(out) end

    utils.exec(string.format(
        [[%s -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "& '%s' | Out-File -FilePath '%s' -Encoding utf8"]],
        POWERSHELL, script, out))

    local raw = utils.read_file(out)
    if not raw or raw == "" then
        error("xbox: scan produced no output")
    end
    raw = raw:gsub("^\239\187\191", "")
    local ok, decoded = pcall(cjson.decode, raw)
    if not ok or type(decoded) ~= "table" then
        error("xbox: invalid scan output")
    end
    if decoded.aumid then decoded = { decoded } end

    local games = {}
    for _, app in ipairs(decoded) do
        local aumid = tostring(app.aumid or "")
        if aumid ~= "" and app.name and not HIDDEN[aumid] then
            games[#games + 1] = {
                id = "xbox:" .. aumid,
                launcher = M.id,
                name = app.name,
                exe = CONHOST,
                start_dir = dir,
                launch_options = string.format([[--headless "%s" -NoProfile -ExecutionPolicy Bypass -File "%s" -Aumid "%s"]], POWERSHELL, launcher_script_path(), aumid),
                icon = app.icon,
                -- Packages with MicrosoftGame.config are games; the frontend classifies the others
                -- through the Microsoft Store catalog
                kind = app.is_game and "game" or nil,
                store_family = aumid:match("^([^!]+)"),
            }
        end
    end
    return games
end

return M
