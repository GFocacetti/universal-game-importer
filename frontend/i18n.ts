// UI strings. The language follows Steam's: Italian when Steam is in Italian, English otherwise.
// To add a language, add a table with the same keys and map Steam's language name in LANGUAGES.

const en = {
	'menu.item': 'UGI',
	'app.name': 'UGI – Universal Game Importer',
	'nav.games': 'Games',
	'nav.launchers': 'Launchers',
	'nav.images': 'Images',
	'nav.settings': 'Settings',
	'header.scan': 'Scan now',
	'header.lastCheck': 'Last check: {when}',
	'header.never': 'Last check: never',
	'apikey.missing': 'The SteamGridDB API key is missing: imported games have no images.',
	'apikey.add': 'Add the key →',
	'apikey.title': 'SteamGridDB API key',
	'apikey.intro': 'UGI downloads cover, background, logo and icon from SteamGridDB, a free archive made by the community. It needs a free, personal API key.',
	'apikey.step1': 'Go to steamgriddb.com and sign in with Steam.',
	'apikey.step2': 'Profile → Preferences → API.',
	'apikey.step3': 'Press Generate API Key and copy it.',
	'apikey.step4': 'Paste it below.',
	'apikey.placeholder': 'Paste your API key here',
	'apikey.verify': 'Verify',
	'apikey.save': 'Save and download the images',
	'common.cancel': 'Cancel',
	'common.close': 'Close',
	'placeholder.soon': 'Coming in the next step.',
	'games.empty': 'No imported games yet. Press "Scan now" to look for games in your launchers.',
	'games.all': 'All',
	'games.search': 'Search by name',
	'games.grid': 'Grid',
	'games.list': 'List',
	'games.imagesMissing': 'Images missing',
	'games.imagesComplete': 'Images complete',
	'image.grid': 'Cover',
	'image.wide': 'Wide cover',
	'image.hero': 'Background',
	'image.logo': 'Logo',
	'image.icon': 'Icon',
	'detail.changeSoon': 'Choosing another image comes with the gallery',
	'detail.missing': '{n} images missing',
	'detail.complete': 'All images present',
	'detail.launcher': 'Launcher',
	'detail.command': 'Launch',
	'detail.play': 'Play',
	'detail.remove': 'Remove from Steam',
};

type Strings = typeof en;

const it: Strings = {
	'menu.item': 'UGI',
	'app.name': 'UGI – Universal Game Importer',
	'nav.games': 'Giochi',
	'nav.launchers': 'Launcher',
	'nav.images': 'Immagini',
	'nav.settings': 'Impostazioni',
	'header.scan': 'Cerca ora',
	'header.lastCheck': 'Ultimo controllo: {when}',
	'header.never': 'Ultimo controllo: mai',
	'apikey.missing': 'Manca la API key di SteamGridDB: i giochi importati non hanno immagini.',
	'apikey.add': 'Inserisci la key →',
	'apikey.title': 'API key di SteamGridDB',
	'apikey.intro': 'UGI scarica copertina, sfondo, logo e icona da SteamGridDB, un archivio gratuito creato dalla community. Serve una API key gratuita e personale.',
	'apikey.step1': 'Vai su steamgriddb.com e accedi con Steam.',
	'apikey.step2': 'Profilo → Preferences → API.',
	'apikey.step3': 'Premi Generate API Key e copiala.',
	'apikey.step4': 'Incollala qui sotto.',
	'apikey.placeholder': 'Incolla qui la tua API key',
	'apikey.verify': 'Verifica',
	'apikey.save': 'Salva e scarica le immagini',
	'common.cancel': 'Annulla',
	'common.close': 'Chiudi',
	'placeholder.soon': 'In arrivo nel prossimo passo.',
	'games.empty': 'Ancora nessun gioco importato. Premi "Cerca ora" per cercare i giochi nei tuoi launcher.',
	'games.all': 'Tutti',
	'games.search': 'Cerca per nome',
	'games.grid': 'Griglia',
	'games.list': 'Elenco',
	'games.imagesMissing': 'Immagini mancanti',
	'games.imagesComplete': 'Immagini complete',
	'image.grid': 'Copertina',
	'image.wide': 'Copertina larga',
	'image.hero': 'Sfondo',
	'image.logo': 'Logo',
	'image.icon': 'Icona',
	'detail.changeSoon': "La scelta di un'altra immagine arriva con la galleria",
	'detail.missing': '{n} immagini mancanti',
	'detail.complete': 'Tutte le immagini presenti',
	'detail.launcher': 'Launcher',
	'detail.command': 'Avvio',
	'detail.play': 'Avvia',
	'detail.remove': 'Togli da Steam',
};

const LANGUAGES: Record<string, Strings> = { english: en, italian: it };

let strings: Strings = en;

export async function initLanguage(): Promise<void> {
	try {
		const language = await SteamClient.Settings.GetCurrentLanguage();
		strings = LANGUAGES[language] ?? en;
	} catch {
		strings = en;
	}
}

export function t(key: keyof Strings, params: Record<string, string | number> = {}): string {
	return strings[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}
