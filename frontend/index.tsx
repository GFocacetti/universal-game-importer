import { definePlugin, IconsModule } from '@steambrew/client';
import React from 'react';
import TestPanel from 'TestPanel';

export default definePlugin(() => ({
	title: 'UGI – Universal Game Importer',
	icon: <IconsModule.Settings />,
	content: <TestPanel />,
}));
