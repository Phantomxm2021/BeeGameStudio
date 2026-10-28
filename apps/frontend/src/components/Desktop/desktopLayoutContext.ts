import { createContext, useContext } from 'react';
import type { DesktopAppearance } from './useDesktopAppearance';
import type { SettingsSection } from '../Demiurge/Landing/SettingsMenu';

export type DesktopSlots = { header: HTMLDivElement | null; account: HTMLDivElement | null; history?: HTMLDivElement | null;
  appearance?: DesktopAppearance;
  setAppearance?: (value: DesktopAppearance) => void;
  settingsPage?: HTMLDivElement | null;
  settingsSection?: SettingsSection | null;
  setSettingsSection?: (section: SettingsSection | null) => void;
};
export const DesktopLayoutContext = createContext<DesktopSlots | null>(null);

export function useDesktopLayout() {
  return useContext(DesktopLayoutContext);
}
