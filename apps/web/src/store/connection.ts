import { create } from 'zustand';

/**
 * Whether the decision server answered the last request. Set by the HTTP adapter only (network failure or a gateway
 * error = down; any other response = up). Drives the calm «اتصال به سرور برقرار نیست» banner.
 */
interface ConnectionState {
  serverDown: boolean;
  setServerDown(down: boolean): void;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  serverDown: false,
  setServerDown: (down) => {
    if (get().serverDown !== down) set({ serverDown: down });
  },
}));
