// Theme tokens: every UGI screen uses these variables, so both themes stay in sync.
// Values from the approved mockups ("Steam nativo" default, "Moderno" as an option).

export type ThemeName = 'steam' | 'modern';

const TOKENS: Record<ThemeName, Record<string, string>> = {
	steam: {
		'--ugi-bg': '#1b2838',
		'--ugi-bg2': '#11161d',
		'--ugi-panel': 'rgba(0,0,0,.22)',
		'--ugi-panel-border': '#2a3a4c',
		'--ugi-side': '#171a21',
		'--ugi-side-on': '#3d4c5d',
		'--ugi-text': '#dfe3e6',
		'--ugi-muted': '#8f98a0',
		'--ugi-head': '#ffffff',
		'--ugi-accent': '#1a9fff',
		'--ugi-primary': 'linear-gradient(90deg,#06bfff,#2d73ff)',
		'--ugi-secondary': '#3d4450',
		'--ugi-radius': '3px',
		'--ugi-radius-lg': '4px',
		'--ugi-chip': '#2a3a4c',
		'--ugi-warn': '#e2b33b',
		'--ugi-warn-bg': 'rgba(226,179,59,.12)',
		'--ugi-logo': '#1a9fff',
		'--ugi-font': '"Motiva Sans", Arial, sans-serif',
	},
	modern: {
		'--ugi-bg': '#0f1217',
		'--ugi-bg2': '#0b0e12',
		'--ugi-panel': '#161b22',
		'--ugi-panel-border': '#252c37',
		'--ugi-side': '#12161c',
		'--ugi-side-on': '#222a36',
		'--ugi-text': '#e2e6ec',
		'--ugi-muted': '#8b94a3',
		'--ugi-head': '#ffffff',
		'--ugi-accent': '#8f7bff',
		'--ugi-primary': 'linear-gradient(90deg,#7c5cff,#4f7dff)',
		'--ugi-secondary': '#1f2530',
		'--ugi-radius': '10px',
		'--ugi-radius-lg': '16px',
		'--ugi-chip': '#1f2530',
		'--ugi-warn': '#f2b84b',
		'--ugi-warn-bg': 'rgba(242,184,75,.10)',
		'--ugi-logo': 'linear-gradient(135deg,#7c5cff,#00d4b4)',
		'--ugi-font': '"Segoe UI", Arial, sans-serif',
	},
};

export function themeStyle(theme: ThemeName): Record<string, string> {
	return TOKENS[theme] ?? TOKENS.steam;
}

// Shared component styles, all built on the tokens above
export const UGI_CSS = `
.ugi-root { position: relative; width: 100%; height: 100%; display: flex; background: var(--ugi-bg); color: var(--ugi-text); font-family: var(--ugi-font); }
.ugi-side { width: 210px; flex: none; background: var(--ugi-side); padding: 18px 10px; display: flex; flex-direction: column; gap: 4px; }
.ugi-brand { display: flex; align-items: center; gap: 10px; padding: 4px 10px 16px; }
.ugi-logo { width: 30px; height: 30px; display: grid; place-items: center; font-weight: 800; font-size: 11px; color: #fff; border-radius: var(--ugi-radius); background: var(--ugi-logo); }
.ugi-brand span { font-size: 12px; color: var(--ugi-muted); line-height: 1.2; }
.ugi-nav { display: flex; justify-content: space-between; padding: 9px 12px; border-radius: var(--ugi-radius); color: var(--ugi-text); font-size: 14px; cursor: pointer; }
.ugi-nav.on { background: var(--ugi-side-on); color: var(--ugi-head); }
.ugi-nav small { color: var(--ugi-muted); }
.ugi-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ugi-head { display: flex; align-items: center; gap: 12px; padding: 16px 22px; border-bottom: 1px solid var(--ugi-panel-border); }
.ugi-head h1 { margin: 0; font-size: 22px; color: var(--ugi-head); font-weight: 500; }
.ugi-head .ugi-sp { flex: 1; }
.ugi-muted { color: var(--ugi-muted); font-size: 13px; }
.ugi-btn { font: inherit; cursor: pointer; padding: 8px 16px; border: 0; border-radius: var(--ugi-radius); color: #fff; white-space: nowrap; }
.ugi-btn.primary { background: var(--ugi-primary); }
.ugi-btn.secondary { background: var(--ugi-secondary); color: var(--ugi-text); }
.ugi-btn:disabled { opacity: .5; cursor: default; }
.ugi-apibar { margin: 12px 22px 0; display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--ugi-radius); background: var(--ugi-warn-bg); border: 1px solid var(--ugi-warn); cursor: pointer; font-size: 14px; }
.ugi-apibar b { color: var(--ugi-warn); }
.ugi-apibar .go { margin-left: auto; color: var(--ugi-warn); font-weight: 600; white-space: nowrap; }
.ugi-content { flex: 1; overflow: auto; padding: 16px 22px 22px; }
.ugi-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 10; }
.ugi-dialog { width: 620px; max-width: calc(100% - 32px); background: var(--ugi-bg); border: 1px solid var(--ugi-panel-border); border-radius: var(--ugi-radius-lg); padding: 24px 28px; }
.ugi-dialog h2 { margin: 0 0 10px; color: var(--ugi-head); font-weight: 500; }
.ugi-dialog p, .ugi-dialog ol { color: var(--ugi-muted); line-height: 1.6; }
.ugi-field { display: flex; gap: 8px; margin-top: 8px; }
.ugi-field input { flex: 1; background: var(--ugi-bg2); border: 1px solid var(--ugi-panel-border); color: var(--ugi-text); border-radius: var(--ugi-radius); padding: 9px 10px; font: inherit; }
.ugi-foot { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
.ugi-foot.left { justify-content: flex-start; }
.ugi-btn.danger { background: #6b2b2b; }
.ugi-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
.ugi-chip { padding: 6px 12px; border-radius: 999px; background: var(--ugi-chip); font-size: 13px; cursor: pointer; }
.ugi-chip.on { background: var(--ugi-accent); color: #fff; }
.ugi-search { flex: 1; min-width: 160px; max-width: 260px; margin-left: auto; padding: 7px 10px; border-radius: var(--ugi-radius); border: 1px solid var(--ugi-panel-border); background: var(--ugi-bg2); color: var(--ugi-text); font: inherit; }
.ugi-seg { display: flex; border: 1px solid var(--ugi-panel-border); border-radius: var(--ugi-radius); overflow: hidden; }
.ugi-seg span { padding: 6px 10px; font-size: 13px; cursor: pointer; }
.ugi-seg span.on { background: var(--ugi-side-on); color: var(--ugi-head); }
.ugi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 14px; }
.ugi-game { position: relative; cursor: pointer; }
.ugi-cover { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: var(--ugi-radius); display: block; }
.ugi-noimg { display: flex; align-items: flex-end; padding: 8px; box-sizing: border-box; font-size: 13px; color: var(--ugi-muted); background: repeating-linear-gradient(45deg, var(--ugi-panel), var(--ugi-panel) 8px, transparent 8px, transparent 16px); border: 1px dashed var(--ugi-panel-border); border-radius: var(--ugi-radius); }
.ugi-badge { position: absolute; top: 6px; left: 6px; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 999px; background: rgba(0,0,0,.65); color: #fff; }
.ugi-row { display: grid; grid-template-columns: 40px 1fr 140px 150px; align-items: center; gap: 12px; padding: 8px 10px; border-radius: var(--ugi-radius); background: var(--ugi-panel); margin-bottom: 6px; font-size: 14px; cursor: pointer; }
.ugi-mini { width: 40px; height: 56px; object-fit: cover; border-radius: 2px; }
.ugi-overlay.right { justify-content: flex-end; align-items: stretch; }
.ugi-drawer { width: 460px; max-width: 100%; height: 100%; box-sizing: border-box; background: var(--ugi-bg2); border-left: 1px solid var(--ugi-panel-border); padding: 20px 22px; overflow: auto; }
.ugi-drawer-head { display: flex; justify-content: space-between; align-items: flex-start; }
.ugi-drawer h2 { margin: 0 0 4px; color: var(--ugi-head); font-weight: 500; }
.ugi-imgs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
.ugi-im { position: relative; border-radius: var(--ugi-radius); overflow: hidden; background: var(--ugi-panel); }
.ugi-im img, .ugi-im .ugi-noimg { width: 100%; height: 100%; object-fit: cover; display: block; border: 0; }
.ugi-im span { position: absolute; left: 6px; bottom: 6px; font-size: 11px; background: rgba(0,0,0,.6); padding: 2px 6px; border-radius: 4px; color: #fff; }
.ugi-im.grid { aspect-ratio: 2/3; grid-row: span 2; }
.ugi-im.wide { aspect-ratio: 92/43; }
.ugi-im.hero { aspect-ratio: 96/31; grid-column: 1 / -1; }
.ugi-im.logo, .ugi-im.icon { aspect-ratio: 2/1; }
.ugi-im.logo img, .ugi-im.icon img { object-fit: contain; }
.ugi-kv { font-size: 13px; color: var(--ugi-muted); line-height: 1.8; }
.ugi-kv code { color: var(--ugi-text); font-size: 12px; word-break: break-all; }
`;
