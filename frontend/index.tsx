import {
	Millennium,
	definePlugin,
	IconsModule,
} from '@steambrew/client';
import React  from 'react';
import { UGI } from 'ipc';
import SettingsContent from 'SettingsUI';

// setup evemts
Millennium.exposeObj?.({ UGI });

// yeet plugin
export default definePlugin(() => ({
	title: 'UGI – Universal Game Importer',
	icon: <IconsModule.Settings />,
	content: <SettingsContent />
}));