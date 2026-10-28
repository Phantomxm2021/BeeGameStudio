export function readDesktopPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch (error) {
    console.warn('Unable to read desktop preference.', key, error);
    return null;
  }
}

export function writeDesktopPreference(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (error) {
    console.warn('Unable to save desktop preference.', key, error);
  }
}

export const lastDesktopProjectKey = (userId: string) => `bgs-desktop-last-project:${userId}`;
