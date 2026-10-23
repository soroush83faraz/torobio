import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { Button } from './components/Button';
import { EmptyState } from './components/States';
import { ToastHost } from './components/Toast';
import { t } from './copy/fa';
import { useServiceWorkerControlled } from './lib/serviceWorker';
import { useConnection } from './store/connection';
import { Home } from './screens/Home';
import { ShareImport } from './screens/ShareImport';
import { Workspace } from './screens/Workspace';
import { AboutSheet } from './sheets/AboutSheet';
import { ResumeSheet } from './sheets/ResumeSheet';

/** Dev-only map harness (#/dev/places); compiled out of production builds. */
const PlacesDemo = import.meta.env.DEV ? lazy(() => import('./dev/PlacesDemo')) : null;

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[ui]', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page py-10">
        <EmptyState title={t.error.crashTitle} body={t.error.crashBody} icon="alert" tone="danger">
          <Button variant="primary" onClick={() => window.location.reload()}>
            {t.error.reload}
          </Button>
        </EmptyState>
      </div>
    );
  }
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="page py-10">
      <EmptyState title={t.error.page404Title} body={t.error.page404Body} icon="alert">
        <Button variant="primary" onClick={() => navigate('/')}>
          {t.workspace.goHome}
        </Button>
      </EmptyState>
    </div>
  );
}

function OfflineNotice() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const serverDown = useConnection((s) => s.serverDown);
  const swControlled = useServiceWorkerControlled();
  // the server banner is the more specific message: it shows as soon as a request failed, offline or not
  if (serverDown)
    return (
      <div role="status" data-testid="server-down" className="bg-amber-soft px-4 py-2 text-center text-amber-ink">
        <p className="text-sm font-bold">{t.connection.down}</p>
        <p className="text-sm">{t.connection.downHint}</p>
      </div>
    );
  if (offline)
    return (
      <p role="status" data-testid="offline-notice" className="bg-amber-soft px-4 py-2 text-center text-sm text-amber-ink">
        {swControlled ? t.notice.offline : t.notice.offlineNoSw}
      </p>
    );
  return null;
}

export function App() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <AppHeader />
        <OfflineNotice />
        <main id="main" tabIndex={-1} className="outline-none">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/plan/:id" element={<Workspace />} />
            <Route path="/s/:data" element={<ShareImport />} />
            {PlacesDemo && <Route path="/dev/places" element={<Suspense fallback={null}><PlacesDemo /></Suspense>} />}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <ResumeSheet />
        <AboutSheet />
      </ErrorBoundary>
      <ToastHost />
    </HashRouter>
  );
}
