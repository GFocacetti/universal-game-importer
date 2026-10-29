-- Shared helpers for launcher modules
local fs = require("fs")
local utils = require("utils")
local cjson = require("json")
local logger = require("logger")
local paths = require("paths")

local M = {}

M.POWERSHELL = [[C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe]]
-- conhost --headless runs a console helper without any window and waits for it,
-- so Steam still sees the game running (and counts playtime)
M.CONHOST = [[C:\Windows\System32\conhost.exe]]

-- Starts a game through its launcher, then waits until no process from the game folder is running.
-- Following the folder (not one exe) handles bootstrappers that hand over to the real game.
local LAUNCH_SCRIPT = [==[
param([string]$Start, [string]$Arguments = '', [string]$WaitDir = '', [int]$StartTimeout = 180)
if ($Arguments) { Start-Process -FilePath $Start -ArgumentList $Arguments } else { Start-Process -FilePath $Start }
if (-not $WaitDir) { exit 0 }
$dir = $WaitDir.TrimEnd('\') + '\'
function Get-GameProcesses {
  Get-CimInstance Win32_Process -Filter 'ExecutablePath IS NOT NULL' |
    Where-Object { $_.ExecutablePath.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase) }
}
$waited = 0
while (-not (Get-GameProcesses) -and $waited -lt $StartTimeout) { Start-Sleep -Seconds 2; $waited += 2 }
while (Get-GameProcesses) { Start-Sleep -Seconds 3 }
]==]

local function launch_script_path()
    return fs.join(paths.data_dir(), "ugi_launch.ps1")
end

function M.prepare()
    local ok, err = utils.write_file(launch_script_path(), LAUNCH_SCRIPT)
    if not ok then
        logger:error("common: cannot write launch script: " .. tostring(err))
    end
end

-- Quotes an argument for the Windows command line that starts PowerShell -File:
-- inner quotes become \" and backslashes before a quote (or at the end) are doubled
local function ps_quote(value)
    local s = tostring(value)
    s = s:gsub('(\\*)"', function(bs) return bs .. bs .. '\\"' end)
    s = s:gsub('(\\+)$', '%1%1')
    return '"' .. s .. '"'
end

-- Shortcut fields that start `start` (URI or exe, with optional arguments) and wait for `wait_dir`
function M.launch_through(start, arguments, wait_dir)
    local options = string.format('--headless "%s" -NoProfile -ExecutionPolicy Bypass -File "%s" -Start %s',
        M.POWERSHELL, launch_script_path(), ps_quote(start))
    if arguments and arguments ~= "" then
        options = options .. " -Arguments " .. ps_quote(arguments)
    end
    if wait_dir and wait_dir ~= "" then
        options = options .. " -WaitDir " .. ps_quote(wait_dir)
    end
    return {
        exe = M.CONHOST,
        start_dir = (wait_dir and wait_dir ~= "") and wait_dir or paths.data_dir(),
        launch_options = options,
    }
end

-- PowerShell code defining [UgiSqlite]::Query(file, sql, columns): reads a SQLite database with
-- Windows' built-in winsqlite3.dll, opened read-only; returns the rows as string arrays.
-- Compiled once into the data folder, beside the scripts (the number changes with the code).
M.SQLITE_READER = [==[
$ugiSqliteDll = Join-Path $PSScriptRoot 'UgiSqlite-1.dll'
$ugiSqliteCode = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class UgiSqlite {
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)] static extern int sqlite3_open_v2(byte[] file, out IntPtr db, int flags, IntPtr vfs);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)] static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int len, out IntPtr stmt, IntPtr tail);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)] static extern int sqlite3_step(IntPtr stmt);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)] static extern IntPtr sqlite3_column_text(IntPtr stmt, int col);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)] static extern int sqlite3_finalize(IntPtr stmt);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)] static extern int sqlite3_close(IntPtr db);
  static byte[] Utf8(string s) { return System.Text.Encoding.UTF8.GetBytes(s + "\0"); }
  static string Text(IntPtr p) {
    if (p == IntPtr.Zero) return null;
    int n = 0; while (Marshal.ReadByte(p, n) != 0) n++;
    byte[] b = new byte[n]; Marshal.Copy(p, b, 0, n);
    return System.Text.Encoding.UTF8.GetString(b);
  }
  public static List<string[]> Query(string file, string sql, int columns) {
    var rows = new List<string[]>();
    IntPtr db, stmt;
    if (sqlite3_open_v2(Utf8(file), out db, 1, IntPtr.Zero) != 0) return rows; // read-only
    if (sqlite3_prepare_v2(db, Utf8(sql), -1, out stmt, IntPtr.Zero) == 0) {
      while (sqlite3_step(stmt) == 100) {
        var row = new string[columns];
        for (int i = 0; i < columns; i++) row[i] = Text(sqlite3_column_text(stmt, i));
        rows.Add(row);
      }
      sqlite3_finalize(stmt);
    }
    sqlite3_close(db);
    return rows;
  }
}
"@
try {
  if (-not (Test-Path $ugiSqliteDll)) { Add-Type -TypeDefinition $ugiSqliteCode -OutputAssembly $ugiSqliteDll }
  Add-Type -Path $ugiSqliteDll
} catch {
  Add-Type -TypeDefinition $ugiSqliteCode
}
]==]

-- Runs a PowerShell scan script whose output is JSON; returns a list (empty if no output)
function M.run_powershell_json(name, script)
    local dir = paths.data_dir()
    local script_path = fs.join(dir, name .. "_scan.ps1")
    local out_path = fs.join(dir, name .. "_scan.json")
    assert(utils.write_file(script_path, script))
    if fs.exists(out_path) then fs.remove(out_path) end

    utils.exec(string.format(
        [[%s -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "& '%s' | Out-File -FilePath '%s' -Encoding utf8"]],
        M.POWERSHELL, script_path, out_path))

    local raw = fs.exists(out_path) and utils.read_file(out_path) or ""
    raw = (raw or ""):gsub("^\239\187\191", ""):gsub("^%s+", ""):gsub("%s+$", "")
    if raw == "" or raw == "null" then return {} end
    local ok, decoded = pcall(cjson.decode, raw)
    if not ok or type(decoded) ~= "table" then
        error(name .. ": invalid scan output")
    end
    if decoded[1] == nil and next(decoded) ~= nil then decoded = { decoded } end
    return decoded
end

-- Copies the launch fields into a game entry
function M.with_launch(game, launch)
    game.exe = launch.exe
    game.start_dir = launch.start_dir
    game.launch_options = launch.launch_options
    return game
end

return M
