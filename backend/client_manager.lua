local utils = require("utils")
local fs = require("fs")
local logger = require("logger")

local function restart_steam_client()
    logger:info("Restarting Steam client")
    local ok, err = utils.exec([[powershell -WindowStyle Hidden -NoProfile -Command "Start-Process \"$((Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam').InstallPath)\steam.exe\" -ArgumentList '-shutdown'; do { Start-Sleep -Seconds 1 } while (Get-Process -Name 'Steam' -ErrorAction SilentlyContinue); Start-Process \"$((Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam').InstallPath)\steam.exe\""]])
    if not ok then
        logger:error("Failed to restart Steam client: " .. tostring(err))
    end
end

-- Helper to check if a path is within allowed UWP directories
local function is_valid_uwp_path(path)
    local normalized_path = path:gsub("\\", "/"):lower()

    if normalized_path:find("%.%./") or normalized_path:find("%.%.$") then
        return false
    end

    local allowed_patterns = {
        "^%a:/program files/windowsapps/",
        "^%a:/windows/systemapps/",
        "^%a:/program files/modifiablewindowsapps/"
    }

    for _, pattern in ipairs(allowed_patterns) do
        if normalized_path:match(pattern) then
            return true
        end
    end

    return false
end

local function get_mime_type(path)
    local ext = path:match("%.([^%.]+)$")
    local mime_types = {
        png  = "image/png",
        jpg  = "image/jpeg",
        jpeg = "image/jpeg",
        gif  = "image/gif",
        bmp  = "image/bmp",
        webp = "image/webp",
        svg  = "image/svg+xml",
        ico  = "image/x-icon"
    }
    return ext and mime_types[ext:lower()] or "application/octet-stream"
    end

local function read_image(path)
    -- Fail early if the path is outside UWP boundaries
    if not is_valid_uwp_path(path) then
        error("security violation: access to path is denied" .. tostring(path))
    end

    local data, err = utils.read_file(path)
    if not data then
        error("failed to read image file: " .. tostring(err))
    end
    local b64 = utils.base64_encode(data)
    local mime = get_mime_type(path)
    return "data:" .. mime .. ";base64," .. b64
end

-- Write the UWP launcher PowerShell script to a file
local function write_uwp_launcher_script(filepath)
    local script_content = [[
param([string]$Aumid)

if (-not $Aumid) {
    Write-Error "Usage: uwp_launcher.ps1 -Aumid <AppUserModelId>"
    exit 1
}

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
                           uint options, 
                           out uint processId);
}

[ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
class ApplicationActivationManager { }

public class UwpLauncher
{
    [DllImport("kernel32.dll")]
    static extern IntPtr GetConsoleWindow();

    [DllImport("kernel32.dll")]
    static extern bool SetConsoleCtrlHandler(ConsoleCtrlDelegate handler, bool add);

    delegate bool ConsoleCtrlDelegate(CtrlTypes ctrlType);

    enum CtrlTypes
    {
        CTRL_C_EVENT = 0,
        CTRL_BREAK_EVENT,
        CTRL_CLOSE_EVENT,
        CTRL_LOGOFF_EVENT = 5,
        CTRL_SHUTDOWN_EVENT
    }

    static ConsoleCtrlDelegate _handler;
    static Process _targetProcess;

    public static void LaunchAndWait(string aumid)
    {
        _handler = (ctrlType) => {
            if (_targetProcess != null && !_targetProcess.HasExited)
                _targetProcess.Kill();
            Environment.Exit(0);
            return true;
        };
        SetConsoleCtrlHandler(_handler, true);

        IApplicationActivationManager activator = (IApplicationActivationManager)new ApplicationActivationManager();
        uint pid = 0;
        int hr = activator.ActivateApplication(aumid, null, 0, out pid);

        if (hr < 0)
        {
            throw new Exception(string.Format("ActivateApplication failed with HRESULT: 0x{0:X8}", hr));
        }

        if (pid == 0)
        {
            string familyPrefix = aumid.Split('!')[0];
            do
            {
                Thread.Sleep(500);
                Process[] procs = Process.GetProcesses();
                foreach (var p in procs)
                {
                    try
                    {
                        if (p.ProcessName.IndexOf(familyPrefix, StringComparison.OrdinalIgnoreCase) >= 0 ||
                            p.MainWindowTitle.IndexOf(familyPrefix, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            _targetProcess = p;
                            break;
                        }
                    }
                    catch { }
                }
            } while (_targetProcess == null || !_targetProcess.HasExited);
        }
        else
        {
            _targetProcess = Process.GetProcessById((int)pid);
        }

        if (_targetProcess != null)
            _targetProcess.WaitForExit();
    }
}
"@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies "System.dll", "System.Runtime.InteropServices", "System.Core"

[UwpLauncher]::LaunchAndWait($Aumid)
]]

    local ok, err = utils.write_file(filepath, script_content)
    if not ok then
        logger:error("Failed to write UWP launcher script to " .. tostring(filepath) .. ": " .. tostring(err))
        return false, err
    end

    logger:info("UWP launcher script written to " .. filepath)
    return true, nil
end

return {
    restart_steam_client = restart_steam_client,
    read_image = read_image,
    write_uwp_launcher_script = write_uwp_launcher_script
}