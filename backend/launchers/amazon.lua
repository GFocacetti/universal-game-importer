-- Amazon Games: installed games are in a SQLite database, read with Windows' built-in winsqlite3.dll
local common = require("launchers.common")

local M = {
    id = "amazon",
    name = "Amazon Games",
    os = "windows",
    supports_path = true,
}

local SCAN_SCRIPT = [==[
$ErrorActionPreference = 'Stop'
$db = Join-Path '__DATA__' 'Games\Sql\GameInstallInfo.sqlite'
if (-not (Test-Path $db)) { '[]'; return }
Add-Type -TypeDefinition @"
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
$rows = [UgiSqlite]::Query($db, 'SELECT Id, ProductTitle, InstallDirectory FROM DbSet WHERE Installed = 1', 3)
$out = foreach ($r in $rows) { if ($r[0] -and $r[1] -and $r[2]) { [PSCustomObject]@{ id = $r[0]; name = $r[1]; path = $r[2] } } }
@($out) | ConvertTo-Json -Depth 3 -Compress
]==]

local function data_dir(custom)
    local fs = require("fs")
    return custom or fs.join(require("utils").getenv("LOCALAPPDATA") or "", "Amazon Games", "Data")
end

function M.is_installed(custom)
    return require("fs").exists(require("fs").join(data_dir(custom), "Games", "Sql", "GameInstallInfo.sqlite"))
end

-- custom: another Amazon Games "Data" folder
function M.discover(custom)
    local dir = data_dir(custom):gsub("'", "''")
    local script = SCAN_SCRIPT:gsub("__DATA__", function() return dir end)
    local games = {}
    for _, g in ipairs(common.run_powershell_json("amazon", script)) do
        games[#games + 1] = common.with_launch({
            id = "amazon:" .. g.id,
            launcher = M.id,
            name = g.name,
            kind = "game",
        }, common.launch_through("amazon-games://play/" .. g.id, nil, g.path))
    end
    return games
end

return M
