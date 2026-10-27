// Theme tokens: every UGI screen uses these variables, so both themes stay in sync.
// Two themes: "Steam" (default, like Steam's own screens) and "Modern".

type ThemeName = 'steam' | 'modern';

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
		// Solid, like the selected buttons and switches in Steam's own settings
		'--ugi-primary': '#1a9fff',
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
.ugi-credit { flex: none; padding: 10px 22px; text-align: center; font-size: 13px; color: var(--ugi-muted); border-top: 1px solid var(--ugi-panel-border); }
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
.ugi-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border-radius: var(--ugi-radius); background: rgba(0,0,0,.6); color: #fff; font-size: 12px; text-align: center; padding: 8px; }
.ugi-loading .ugi-spinner { width: 28px; height: 28px; margin: 0; }
.ugi-loading.waiting .ugi-spinner { animation-play-state: paused; opacity: .4; }
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
.ugi-im.clickable { cursor: pointer; }
.ugi-im.clickable:hover { outline: 2px solid var(--ugi-accent); }
.ugi-win { width: 1020px; max-width: calc(100% - 32px); height: 620px; max-height: calc(100% - 32px); background: var(--ugi-bg); border: 1px solid var(--ugi-panel-border); border-radius: var(--ugi-radius-lg); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.6); }
.ugi-win header, .ugi-win footer { display: flex; align-items: center; gap: 12px; padding: 12px 18px; }
.ugi-win header { border-bottom: 1px solid var(--ugi-panel-border); }
.ugi-win footer { border-top: 1px solid var(--ugi-panel-border); }
.ugi-win header h2 { margin: 0; font-size: 18px; font-weight: 500; color: var(--ugi-head); }
.ugi-sp { flex: 1; }
.ugi-switch { display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; user-select: none; }
.ugi-tog { width: 40px; height: 22px; border-radius: 11px; background: #3a4350; position: relative; flex: none; }
.ugi-tog::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }
.ugi-switch.on .ugi-tog { background: var(--ugi-accent); }
.ugi-switch.on .ugi-tog::after { left: 21px; }
.ugi-win-body { flex: 1; display: flex; min-height: 0; }
.ugi-types { width: 200px; flex: none; padding: 12px 8px; border-right: 1px solid var(--ugi-panel-border); display: flex; flex-direction: column; gap: 4px; }
.ugi-current { margin-top: auto; padding: 10px 12px; font-size: 12px; color: var(--ugi-muted); }
.ugi-current .ugi-im { margin-top: 6px; width: 100%; }
.ugi-current .ugi-im.grid { width: 110px; grid-row: auto; }
.ugi-pick { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.ugi-filters { padding: 10px 16px; border-bottom: 1px solid var(--ugi-panel-border); font-size: 13px; }
.ugi-filters summary { cursor: pointer; color: var(--ugi-muted); }
.ugi-filter-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.ugi-filter-row select { background: var(--ugi-bg2); color: var(--ugi-text); border: 1px solid var(--ugi-panel-border); border-radius: var(--ugi-radius); padding: 5px 8px; font: inherit; }
.ugi-thumbs { flex: 1; overflow: auto; padding: 14px 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; align-content: start; }
.ugi-thumbs.wide, .ugi-thumbs.hero { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.ugi-thumbs.logo, .ugi-thumbs.icon { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
.ugi-thumb { width: 100%; border-radius: var(--ugi-radius); cursor: pointer; background: var(--ugi-panel); border: 2px solid transparent; object-fit: contain; }
.ugi-thumbs.grid .ugi-thumb { aspect-ratio: 2/3; object-fit: cover; }
.ugi-thumb:hover { border-color: var(--ugi-accent); }
.ugi-link { background: none; border: 0; color: var(--ugi-muted); cursor: pointer; font: inherit; text-decoration: underline; padding: 0; }
.ugi-check { display: flex; align-items: center; gap: 10px; padding: 7px 10px; margin-bottom: 4px; font-size: 14px; background: var(--ugi-panel); border-radius: var(--ugi-radius); cursor: pointer; }
.ugi-check.off { opacity: .6; }
.ugi-check input { accent-color: var(--ugi-accent); }
.ugi-check small { margin-left: auto; color: var(--ugi-muted); font-size: 12px; }
.ugi-review { max-height: calc(100% - 48px); display: flex; flex-direction: column; }
.ugi-review-list { overflow: auto; flex: 1; min-height: 0; }
.ugi-review-list h3 { font-size: 13px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .5px; color: var(--ugi-muted); }
.ugi-excl { margin-top: 14px; border-top: 1px solid var(--ugi-panel-border); padding-top: 10px; }
.ugi-excl summary { cursor: pointer; font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: var(--ugi-muted); }
.ugi-card { background: var(--ugi-panel); border: 1px solid var(--ugi-panel-border); border-radius: var(--ugi-radius-lg); padding: 14px 16px; margin-bottom: 10px; }
.ugi-card h3 { margin: 0 0 4px; font-size: 15px; color: var(--ugi-head); font-weight: 600; }
.ugi-card p { margin: 0 0 10px; color: var(--ugi-muted); font-size: 13px; line-height: 1.45; }
.ugi-lrow { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; align-items: center; }
.ugi-launcher-help { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ugi-muted); line-height: 1.45; }
.ugi-launcher-help b { color: var(--ugi-text); font-weight: 600; }
.ugi-launcher-warn { color: var(--ugi-warn); }
div.ugi-launcher-warn { margin-top: 4px; font-size: 13px; }
.ugi-opts { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 18px; font-size: 13px; color: var(--ugi-muted); margin-top: 6px; align-items: center; }
.ugi-opts label { display: flex; gap: 6px; align-items: center; }
.ugi-opts input[type=text] { background: var(--ugi-bg2); border: 1px solid var(--ugi-panel-border); color: var(--ugi-text); border-radius: var(--ugi-radius); padding: 4px 8px; font: inherit; width: 280px; }
.ugi-select { background: var(--ugi-bg2); border: 1px solid var(--ugi-panel-border); color: var(--ugi-text); border-radius: var(--ugi-radius); padding: 7px 8px; font: inherit; }
.ugi-tools { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.ugi-row-between { display: flex; justify-content: space-between; align-items: center; }
.ugi-progress { height: 8px; border-radius: 4px; background: var(--ugi-bg2); overflow: hidden; margin: 8px 0; }
.ugi-progress b { display: block; height: 100%; background: var(--ugi-accent); transition: width .2s; }
.ugi-set { display: grid; grid-template-columns: 1fr 300px; gap: 20px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--ugi-panel-border); }
.ugi-set strong { display: block; color: var(--ugi-head); font-weight: 500; }
.ugi-set small { color: var(--ugi-muted); }
.ugi-set > :last-child { justify-self: end; }
.ugi-set .ugi-field { width: 100%; margin: 0; }
.ugi-switch.disabled { opacity: .4; cursor: default; }
.ugi-onboarding { position: relative; min-height: 440px; display: flex; flex-direction: column; }
.ugi-ob-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.ugi-dots { display: flex; gap: 6px; }
.ugi-dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--ugi-side-on); display: block; }
.ugi-dots i.on { background: var(--ugi-accent); }
.ugi-tag { display: inline-block; font-size: 12px; padding: 2px 8px; margin: 2px 4px 2px 0; border-radius: 10px; background: var(--ugi-chip); color: var(--ugi-text); }
.ugi-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
.ugi-choice div { padding: 16px; cursor: pointer; background: var(--ugi-panel); border: 1px solid var(--ugi-panel-border); border-radius: var(--ugi-radius); color: var(--ugi-muted); font-size: 13px; }
.ugi-choice div.sel { border-color: var(--ugi-accent); }
.ugi-choice strong { display: block; margin-bottom: 4px; color: var(--ugi-head); font-size: 14px; }
.ugi-warn-layer { position: absolute; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; border-radius: var(--ugi-radius-lg); }
.ugi-warn-box { width: 440px; max-width: calc(100% - 32px); padding: 22px; background: var(--ugi-bg); border: 1px solid var(--ugi-panel-border); border-top: 3px solid var(--ugi-warn); border-radius: var(--ugi-radius); }
.ugi-spinner { width: 34px; height: 34px; border: 3px solid var(--ugi-side-on); border-top-color: var(--ugi-accent); border-radius: 50%; animation: ugi-spin 1s linear infinite; margin: 24px auto; }
@keyframes ugi-spin { to { transform: rotate(360deg); } }
.ugi-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
.ugi-summary div { padding: 14px; text-align: center; background: var(--ugi-panel); border: 1px solid var(--ugi-panel-border); border-radius: var(--ugi-radius); color: var(--ugi-muted); font-size: 13px; }
.ugi-summary strong { display: block; font-size: 26px; color: var(--ugi-head); }
.ugi-toast { width: 330px; display: flex; overflow: hidden; cursor: pointer; background: var(--ugi-bg); border: 1px solid var(--ugi-panel-border); border-radius: var(--ugi-radius); box-shadow: 0 8px 30px rgba(0,0,0,.6); }
.ugi-toast-icon { width: 64px; flex: none; display: grid; place-items: center; font-weight: 800; font-size: 13px; color: #fff; background: var(--ugi-logo); }
.ugi-toast-text { padding: 12px 14px; font-size: 13px; line-height: 1.4; }
.ugi-toast-text strong { display: block; color: var(--ugi-head); font-size: 14px; margin-bottom: 2px; }
.ugi-toast-text span { color: var(--ugi-muted); }
`;
