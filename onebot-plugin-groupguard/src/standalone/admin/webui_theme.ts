import { applyControlPanelDesign, CONTROL_PANEL_THEME_STORAGE_KEY } from './control_panel_design';

export const GROUPGUARD_WEBUI_THEME_STORAGE_KEY = CONTROL_PANEL_THEME_STORAGE_KEY;

export function applyWebUiTheme(page: string): string {
  return applyControlPanelDesign(page);
}
