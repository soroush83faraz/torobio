import { useEffect, useState } from 'react';

const controlled = () => typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;

/** True only when an offline-shell service worker controls this page (never on plain HTTP: no service workers there). */
export function useServiceWorkerControlled(): boolean {
  const [on, setOn] = useState(controlled);
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const update = () => setOn(controlled());
    sw.addEventListener('controllerchange', update);
    update();
    return () => sw.removeEventListener('controllerchange', update);
  }, []);
  return on;
}
