import { readRuntimeValue, writeRuntimeValue } from '../../platform/runtimeStorage';
import { SYNC_STORAGE_KEYS } from './storageKeys';

export type InkboundTheme = 'dark' | 'light';

export const readInkboundTheme = (): InkboundTheme =>
  readRuntimeValue(SYNC_STORAGE_KEYS.theme) === 'light' ? 'light' : 'dark';

export const applyInkboundThemeToDocument = (theme: InkboundTheme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
};

export const persistInkboundTheme = (theme: InkboundTheme) => {
  writeRuntimeValue(SYNC_STORAGE_KEYS.theme, theme);
  applyInkboundThemeToDocument(theme);
};
