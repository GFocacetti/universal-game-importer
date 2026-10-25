# Third-party notices

UGI – Universal Game Importer is licensed under the GNU General Public License v3.0 (see `LICENSE`).
It includes or is derived from the following third-party works, used under their respective licenses.

## millennium-uwp-library-sync

- Source: https://github.com/xwxfox/millennium-uwp-library-sync
- Author: xwxfox
- License: MIT — full text in `LICENSES/MIT-millennium-uwp-library-sync.txt`
- Used for: the project's starting point — Lua backend (UWP/Xbox discovery, `shortcuts.vdf` parsing and writing, UWP launcher script) and the settings / managed games UI.
- Changes: renamed and restructured for UGI; Millennium is signalled ready before the UWP scan; the Steam path comes from `millennium.steam_path()`; the current Steam user is also detected from `AutoLogin` and the latest login `timestamp` in `loginusers.vdf`.
