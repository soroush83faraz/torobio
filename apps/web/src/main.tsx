import '@fontsource-variable/vazirmatn/wght.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline shell: caches the built app so a reload while the server is down still opens it (see sw/sw.template.js).
// Production builds against the real server only; the mock build and dev server never register it.
if (import.meta.env.PROD && import.meta.env.VITE_API !== 'mock' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
