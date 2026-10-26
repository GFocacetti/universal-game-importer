# Third-party notices

UGI – Universal Game Importer is licensed under the GNU General Public License v3.0 (see `LICENSE`).
It includes or is derived from the following third-party works, used under their respective licenses.

## steam-easygrid (Easy SteamGrid)

- Source: https://github.com/luthor112/steam-easygrid
- Author: luthor112 and contributors
- License: MIT — full text in `LICENSES/MIT-steam-easygrid.txt`
- Used for: `backend/icons.lua` (icon files for Steam apps, unchanged); the library right-click menu hook in `frontend/contextMenu.tsx`; the SteamGridDB approach (one request per backend call, chunked image transfer, default filters per image type).

## Steam ROM Manager

- Source: https://github.com/SteamGridDB/steam-rom-manager
- Authors: SteamGridDB and contributors
- License: GPL-3.0 (same as UGI)
- Used for: reference for the launcher parsers (install locations, file formats, launch URIs). The Battle.net product code table in `backend/launchers/battlenet.lua` is taken from it (Steam ROM Manager credits steamgriddb-manager for it); the EA parser follows its `installerdata.xml` approach.
- Changes: rewritten in Lua / PowerShell for a Millennium plugin.

## millennium-uwp-library-sync

- Source: https://github.com/xwxfox/millennium-uwp-library-sync
- Author: xwxfox
- License: MIT — full text in `LICENSES/MIT-millennium-uwp-library-sync.txt`
- Used for: the project's starting point. The Xbox / Microsoft Store discovery script and the UWP launch helper in `backend/launchers/xbox.lua` are derived from it.
- Changes: discovery reworked (game detection via `MicrosoftGame.config`, UTF-8 output, hidden system apps); the launch helper runs through `conhost --headless`; shortcuts are no longer written to `shortcuts.vdf` but added live through Steam's client API; the rest of the plugin was rewritten for UGI.
