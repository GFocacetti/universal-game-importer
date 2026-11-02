import React from 'react';
import guideImages from 'guideImages';
import { t } from 'i18n';
import { openUrl } from 'steamApps';

// Epic's sign-in page: once signed in, it shows the code to paste in UGI
export const EPIC_LOGIN = 'https://www.epicgames.com/id/login?redirectUrl=' +
	encodeURIComponent('https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code');

export type GuideId = 'sgdb' | 'rawg' | 'xbl' | 'epic';

// Where each key or code is made, and how many steps it takes there
const GUIDES: Record<GuideId, { site: string; url: string; steps: number }> = {
	sgdb: { site: 'SteamGridDB', url: 'https://www.steamgriddb.com/profile/preferences/api', steps: 5 },
	rawg: { site: 'RAWG', url: 'https://rawg.io/apidocs', steps: 4 },
	xbl: { site: 'OpenXBL', url: 'https://xbl.io', steps: 3 },
	epic: { site: 'Epic Games', url: EPIC_LOGIN, steps: 2 },
};

// The steps on a site, each with a picture of that page (the part to click framed in blue), and a
// button that opens the site
export function GuideSteps({ id }: { id: GuideId }) {
	const guide = GUIDES[id];
	return (
		<>
			<ol className="ugi-guide">
				{Array.from({ length: guide.steps }, (_, i) => {
					const image = guideImages[`${id}-${i + 1}`];
					return (
						<li key={i}>
							{t(`guide.${id}.${i + 1}` as any)}
							{image && <img src={image} alt="" />}
						</li>
					);
				})}
			</ol>
			<p><button className="ugi-btn secondary" onClick={() => openUrl(guide.url)}>{t('guide.open', { site: guide.site })}</button></p>
		</>
	);
}
