import { applyControlPanelDesign, CONTROL_PANEL_THEME_STORAGE_KEY } from './control_panel_design';
import { applyControlPanelBrowserFixes } from './control_panel_browser_fixes';

export const GROUPGUARD_WEBUI_THEME_STORAGE_KEY = CONTROL_PANEL_THEME_STORAGE_KEY;

export function applyWebUiTheme(page: string): string {
  return applyControlPanelBrowserFixes(applyControlPanelDesign(page));
}
