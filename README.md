# UGI – Universal Game Importer

A Millennium plugin that brings any game into your Steam library, not only the ones from other launchers: games from the supported launchers are imported automatically, and every non-Steam game, even one added by hand, gets its pictures, store information and achievements where available.

## Features

* Imports installed games from:
   * Xbox / Microsoft Store
   * Epic Games
   * GOG Galaxy
   * EA app
   * Battle.net
   * Amazon Games
   * Ubisoft Connect
   * itch.io
   * Riot Games
* Any other game can be added from UGI's page ("Add a game"): pick its program, check the name UGI suggests, and it gets its pictures and game page like the others
   * Kept in an "Imported games" collection, and removed when its program or its Steam shortcut is gone
* Games start through their own launcher, and Steam shows them as "In game" and counts the playtime
   * Steam's overlay works by default; turned off for a game (in its UGI page), the game counts as closed as soon as you close it, even with its launcher still open
* Keeps the library up to date by itself
   * New games are announced with a notification, ready to be added
   * Uninstalled games are removed, changed ones are updated
   * Games you had already added to Steam by hand are taken over, with their playtime, and put back as they were if UGI removes them
* Pictures from SteamGridDB: grid, hero, logo and icon
   * Chosen automatically for new games
   * "Customize (UGI)…" in a game's menu opens a gallery to pick others (animated ones too)
* A collection for every launcher, and shelves on the Home page (optional)
* Game information on the game's page in the library, like a store page
   * Trailers and screenshots, summary, reviews, release date, developer and publisher
   * Description, system requirements, features, languages, age rating, Metacritic
   * Links to the game's page on its own store
   * From Steam, GOG, Epic Games Store, Microsoft Store or RAWG
* Achievements on the game's page
   * GOG (from GOG Galaxy), Xbox, Epic Games
   * Progress, latest unlocked, full list with dates and rarity
   * Secret achievements stay hidden until you choose to see them
* Big Picture mode
   * The game information and achievements are in the "Game info" tab
   * Everything works with a controller: the right stick scrolls like a mouse wheel, A and B go into and out of each part
   * The UGI page, the gallery and the dialogs work with a controller too
* Backup and restore of UGI's settings, imported games and pictures
* English and Italian

## Configuration

UGI's page is in Steam's **LIBRARY** menu (**UGI**). The first time, a short setup guides you through it.

Optional keys and accounts, in UGI's **Settings**:

* SteamGridDB API key: needed for the pictures. Free key: https://www.steamgriddb.com/profile/preferences/api
* RAWG API key: information for games not found on Steam, GOG or Epic (texts in English). Free key: https://rawg.io/apidocs
* OpenXBL API key: achievements of every Xbox game; without it, only those of the games you opened in the Xbox app. Free key: https://xbl.io
* Epic account: to see which Epic achievements you unlocked

## Prerequisites

* Windows
* [Millennium](https://steambrew.app/)

## Installation

* Copy the plugin ID from the [Millennium plugins](https://steambrew.app/plugins) page
* Click `Plugins` and `Install a plugin` in the Millennium settings and paste the ID
* Restart Steam

## Installation - manual

* Download the latest release from GitHub Releases
* Extract it into Millennium's plugins folder (usually `C:\Program Files (x86)\Steam\millennium\plugins`)
* Enable the plugin in the Millennium settings and restart Steam

## Known issues

* After installing or updating the plugin, Steam has to be restarted

## Coming soon

* Linux and Steam Deck/Steam Machine compatibility
* Rockstar Games Launcher

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
Third-party code and its licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
