// "Customize (UGI)…" entry in the library's right-click menu, opening the gallery.
// In Big Picture, which has no LIBRARY menu, a "UGI" entry opening the UGI page comes after it.
// Hooking technique from steam-easygrid by luthor112 (MIT), see THIRD_PARTY_NOTICES.md
import { afterPatch, fakeRenderComponent, findInReactTree, findInTree, findModuleByExport, MenuItem, Navigation } from '@steambrew/client';
import React from 'react';
import { openGallery } from 'Gallery';
import { t } from 'i18n';
import { mainDocument } from 'overlay';
import { bigPicture, gamepadDocument } from 'location';
import { UGI_ROUTE } from 'menu';

declare const appStore: { GetAppOverviewByAppID(appid: number): { display_name?: string } | undefined };

const KEY = 'ugi-images';
const PAGE_KEY = 'ugi-page';

const isPropertiesMenuItem = (node: any): boolean => {
	const selected = node?.props?.onSelected?.toString?.() ?? node?.onSelected?.toString?.() ?? '';
	return selected.includes('AppProperties');
};

const isAppContextMenu = (items: any): boolean =>
	Array.isArray(items) && items.length > 0 && Boolean(findInReactTree(items, (node: any) => isPropertiesMenuItem(node) || Boolean(node?.app?.appid)));

const findAppId = (tree: any, owner: any): number | undefined => {
	if (owner?.pendingProps?.overview?.appid) return owner.pendingProps.overview.appid;
	const found = findInTree(tree, (node: any) => node?.app?.appid || node?.overview?.appid, { walkable: ['props', 'children', '_owner', 'pendingProps'] });
	return found?.app?.appid ?? found?.overview?.appid;
};

function insertItem(items: any[], appid: number): boolean {
	if (!appid || items.find((item: any) => item?.key === KEY)) return false;
	const entry = (
		<MenuItem
			key={KEY}
			onClick={() => {
				const doc = (bigPicture() && gamepadDocument()) || mainDocument();
				if (doc) openGallery(appid, appStore.GetAppOverviewByAppID(appid)?.display_name ?? String(appid), doc);
			}}
		>
			{t('ctx.images')}
		</MenuItem>
	);
	const entries = [entry];
	if (bigPicture())
		entries.push(
			<MenuItem key={PAGE_KEY} onClick={() => Navigation.Navigate(UGI_ROUTE)}>
				{t('menu.item')}
			</MenuItem>,
		);
	const properties = items.findIndex((item: any) => Boolean(findInReactTree([item], isPropertiesMenuItem)));
	if (properties === -1) items.push(...entries);
	else items.splice(properties, 0, ...entries);
	return true;
}

export function patchLibraryContextMenu(): { unpatch: () => void } {
	const module = findModuleByExport((exp: any) => exp?.toString && exp.toString().includes('().LibraryContextMenu'));
	const component = Object.values(module ?? {}).find((sibling: any) => sibling?.toString?.().includes('navigator:')) as any;
	const LibraryContextMenu = component ? fakeRenderComponent(component)?.type : null;
	if (!LibraryContextMenu?.prototype?.render) {
		console.warn('[UGI] library context menu not found');
		return { unpatch: () => {} };
	}

	let inner: any = null;
	const outer = afterPatch(LibraryContextMenu.prototype, 'render', (_args: any[], rendered: any) => {
		if (!inner) {
			inner = afterPatch(rendered, 'type', (_typeArgs: any[], typeRet: any) => {
				if (typeRet?.type?.prototype?.render) {
					afterPatch(typeRet.type.prototype, 'render', (_renderArgs: any[], renderRet: any) => {
						const items = renderRet?.props?.children?.[0];
						if (isAppContextMenu(items)) {
							const appid = findAppId(renderRet, renderRet?._owner);
							if (appid) insertItem(items, appid);
						}
						return renderRet;
					});
					afterPatch(typeRet.type.prototype, 'shouldComponentUpdate', ([nextProps]: any[], shouldUpdate: any) => {
						const items = nextProps?.children;
						if (isAppContextMenu(items)) {
							const appid = findAppId(nextProps, undefined);
							if (appid && insertItem(items, appid)) return true;
						}
						return shouldUpdate;
					});
				}
				return typeRet;
			});
		} else if (Array.isArray(rendered?.props?.children)) {
			const appid = findAppId(rendered, rendered?._owner);
			if (appid) insertItem(rendered.props.children, appid);
		}
		return rendered;
	});

	return {
		unpatch: () => {
			outer?.unpatch?.();
			inner?.unpatch?.();
		},
	};
}
