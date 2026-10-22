import { create } from 'zustand';

/** App-wide sheet state (header menus are reachable from every screen). */
interface UiState {
  aboutOpen: boolean;
  resumeOpen: boolean;
  setAbout(open: boolean): void;
  setResume(open: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  aboutOpen: false,
  resumeOpen: false,
  setAbout: (aboutOpen) => set({ aboutOpen }),
  setResume: (resumeOpen) => set({ resumeOpen }),
}));

/** Per-viewer conveniences in localStorage; always safe to fail. */
export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
export function writeFlag(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
