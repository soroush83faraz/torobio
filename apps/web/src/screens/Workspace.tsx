import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AssistResult, PlanResponse, Requirement, Stop, StopLine, StopShop } from '../api/types';
import { BidiText } from '../components/Bdi';
import { Button, IconButton } from '../components/Button';
import { SegmentedControl } from '../components/SegmentedControl';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Icon } from '../components/Icon';
import { ReplanBanner, type ReplanInfo } from '../components/ReplanBanner';
import { toast, toastUndo } from '../components/Toast';
import { t } from '../copy/fa';
import { formatCount } from '../lib/format';
import { CONDITION_ANY, isDeadEnd, planMarker } from '../lib/items';
import { diffPlans } from '../lib/planDiff';
import { sanitizeText } from '../lib/sanitize';
import { shopsOf } from '../lib/stops';
import { visitChipLabel } from '../lib/visit';
import { AssistantSheet, type AssistContext } from '../sheets/AssistantSheet';
import { OptionsSheet } from '../sheets/OptionsSheet';
import { PlanMenuSheet } from '../sheets/PlanMenuSheet';
import { SellerSheet } from '../sheets/SellerSheet';
import { TimeSheet } from '../sheets/TimeSheet';
import { PriceInput } from '../components/PriceInput';
import { BottomSheet } from '../components/BottomSheet';
import { isStorageAvailable, requirementStateOf, usePlans, type ReportKind, type SavedPlan, type View } from '../store/plans';
import { shareUrl } from '../store/share';
import { ListView } from './ListView';
import { MarketView } from './MarketView';
import { PlanView } from './PlanView';
import { usePlanData } from './usePlanData';

type Target = { line: StopLine; stop: Stop; shop: StopShop };

/** Sets --bottom-bar so toasts sit above the sticky action bar. */
function useBottomBar(active: boolean) {
  useEffect(() => {
    document.documentElement.style.setProperty('--bottom-bar', active ? '88px' : '0px');
    return () => document.documentElement.style.setProperty('--bottom-bar', '0px');
  }, [active]);
}

export function Workspace() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const saved = usePlans((s) => s.plans[id]);
  const actions = usePlans.getState;
  const lastSavedAt = usePlans((s) => s.lastSavedAt);
  const data = usePlanData(saved);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistText, setAssistText] = useState<string | undefined>();
  const [assistCtx, setAssistCtx] = useState<AssistContext | undefined>();
  const [optionsFor, setOptionsFor] = useState<{ itemId: string; mode: 'change' | 'unavailable'; shopId?: string } | null>(null);
  const [sellerFor, setSellerFor] = useState<Target | null>(null);
  const [sellerOpen, setSellerOpen] = useState(false);
  const [priceFor, setPriceFor] = useState<{ target: Target; kind: 'price' | 'paid' } | null>(null);
  const [pulse, setPulse] = useState(false);
  const [replan, setReplan] = useState<(ReplanInfo & { snapshot: SavedPlan; prevPlan: PlanResponse; itemId?: string; shopId?: string }) | null>(null);

  const view = saved?.view ?? null;
  const resolutions = data.resolve?.items ?? [];
  const pendingCount = data.resolve?.pendingItemCount ?? 0;

  useEffect(() => {
    document.title = saved ? `${sanitizeText(saved.name)} · ${t.app.name}` : t.app.name;
    return () => {
      document.title = t.app.name;
    };
  }, [saved?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Decide where the user lands the first time: list when something needs answering, otherwise the plan.
  useEffect(() => {
    if (saved && saved.view === null && data.resolve && data.plan) {
      // nothing plannable yet (e.g. only «پیدا نشد» items) is also a list matter
      const needsList = data.resolve.pendingItemCount > 0 || (data.plan.coverage.covered === 0 && data.plan.unpriced.length === 0);
      actions().setView(saved.id, needsList ? 'list' : 'plan');
    }
  }, [saved, data.resolve, data.plan, actions]);

  // Cache progress for the resume card.
  useEffect(() => {
    if (!saved || !data.resolve) return;
    const ready = data.resolve.items.filter((r) => (r.state === 'exact' || r.state === 'suggested' || r.state === 'alternative') && !isDeadEnd(r)).length;
    actions().setProgress(saved.id, ready, data.resolve.items.length);
  }, [saved, data.resolve, actions]);

  // Keep exactly one question card expanded.
  useEffect(() => {
    // only items that NEED an answer expand a question (a suggested item may carry an optional one)
    const withQ = resolutions.filter((r) => r.question && r.state === 'needs_info').map((r) => r.itemId);
    if (!withQ.length) {
      if (activeId) setActiveId(null);
    } else if (!activeId || !withQ.includes(activeId)) {
      setActiveId(withQ[0]!);
    }
  }, [resolutions, activeId]);

  // Subtle pulse on the save indicator after each change.
  useEffect(() => {
    if (!lastSavedAt) return;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 1200);
    return () => clearTimeout(timer);
  }, [lastSavedAt]);

  // After «موجود نیست»: once the recomputed plan arrives, diff it against the one the user was looking at.
  useEffect(() => {
    if (!replan || replan.changes !== null) return;
    if (data.refreshing || !data.plan || data.plan === replan.prevPlan) return;
    setReplan({ ...replan, changes: diffPlans(replan.prevPlan, data.plan), totalAfter: data.plan.totalToman, stopsAfter: data.plan.stops.length });
  }, [replan, data.refreshing, data.plan]);

  // A different plan or a failed recompute closes the banner's pending state.
  useEffect(() => {
    setReplan(null);
  }, [id]);

  const barVisible = !!saved && view !== null && (view !== 'market') && !data.error;
  useBottomBar(barVisible);

  const undoable = useCallback(
    (message: string, fn: () => void) => {
      const snapshot = structuredClone(usePlans.getState().plans[id]!);
      fn();
      toastUndo(message, () => usePlans.getState().restore(id, snapshot));
    },
    [id],
  );

  if (!saved) {
    return (
      <div className="page py-8">
        <EmptyState title={t.workspace.notFoundPlan} body={t.workspace.notFoundHint} icon="alert">
          <Button variant="primary" onClick={() => navigate('/')}>
            {t.workspace.goHome}
          </Button>
        </EmptyState>
      </div>
    );
  }

  const state = requirementStateOf(saved);
  const nameOf = (itemId: string) => saved.requirements.find((r) => r.id === itemId)?.text ?? '';
  const busy = data.refreshing;
  const store = actions();

  /* ------------ handlers ------------ */

  const setView = (v: View) => {
    store.setView(saved.id, v);
    window.scrollTo({ top: 0 });
  };

  const onAnswer = (itemId: string, qid: string, opt: string) => store.answer(saved.id, itemId, qid, opt);
  const onEnough = (itemId: string) => store.settleItems(saved.id, [itemId]);
  const onSettleAll = () => {
    const ids = resolutions.filter((r) => r.state === 'needs_info').map((r) => r.itemId);
    undoable(t.list.settleAll, () => store.settleItems(saved.id, ids));
  };
  const onRemove = (itemId: string) => undoable(t.list.itemRemoved, () => store.removeItem(saved.id, itemId));
  const onAdd = async (text: string): Promise<boolean> => {
    try {
      const parsed = await api.parse({ text });
      if (!parsed.items.length) throw new Error('empty');
      store.addItems(saved.id, parsed.items);
      if (parsed.degraded) toast(parsed.degradedReason === 'budget' ? t.notice.degradedBudget : t.notice.degraded);
      return true;
    } catch (e) {
      toast((e as { messageFa?: string }).messageFa || t.list.addFailed);
      return false;
    }
  };

  const nextAction = (): { label: string; run: () => void } | null => {
    if (view === 'list') {
      if (pendingCount > 0)
        return {
          label: t.bar.nextQuestion,
          run: () => {
            const ids = resolutions.filter((r) => r.question && r.state === 'needs_info').map((r) => r.itemId);
            const idx = ids.indexOf(activeId ?? '');
            const next = ids[(idx + 1) % ids.length];
            if (next) {
              setActiveId(next);
              requestAnimationFrame(() =>
                document.querySelector(`[data-item="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
              );
            }
          },
        };
      return { label: t.bar.seePlan, run: () => setView('plan') };
    }
    if (view === 'plan') return { label: t.bar.startShopping, run: () => setView('market') };
    return null;
  };
  const action = nextAction();

  const getShareUrl = () => shareUrl(usePlans.getState().plans[saved.id]!);

  const report = (target: Target, kind: ReportKind, price?: number) => {
    const prev = usePlans.getState().plans[saved.id]!.reports[target.line.itemId];
    store.setReport(saved.id, target.line.itemId, { kind, price, shopId: target.line.shopId, at: new Date().toISOString() });
    toastUndo(t.seller.reported, () => usePlans.getState().setReport(saved.id, target.line.itemId, prev ?? null));
  };

  /**
   * «موجود نیست»: remember the report (device-only), exclude that shop for that item, and let the plan be
   * recomputed. The banner then shows what changed (rows highlighted) and offers «برگرداندن».
   */
  const markUnavailable = (target: Target) => {
    const cur = usePlans.getState().plans[saved.id]!;
    const snapshot = structuredClone(cur);
    store.setReport(saved.id, target.line.itemId, { kind: 'unavailable', shopId: target.line.shopId, at: new Date().toISOString() });
    store.excludeShop(saved.id, target.line.itemId, target.line.shopId);
    if (data.plan) {
      setReplan({
        snapshot,
        prevPlan: data.plan,
        itemId: target.line.itemId,
        shopId: target.line.shopId,
        reportedShop: target.shop.shopName,
        changes: null,
        totalBefore: data.plan.totalToman,
        totalAfter: null,
        stopsBefore: data.plan.stops.length,
        stopsAfter: null,
      });
    }
  };
  const undoReplan = () => {
    if (!replan) return;
    usePlans.getState().restore(saved.id, replan.snapshot);
    setReplan(null);
  };

  const pickModel = (itemId: string, productId: string) => {
    undoable(t.options.picked, () => {
      store.pinProduct(saved.id, itemId, productId);
      store.patch(saved.id, (p) => {
        delete p.shopPins[itemId];
      });
    });
    setOptionsFor(null);
  };
  /**
   * Not-found item: the user picked one of the server's suggested categories. The item is sent again with
   * `categoryIds: [thatId]` (text, quantity and constraints stay); the parser's empty list is authoritative only until now.
   */
  const pickNearby = (itemId: string, index: number) => {
    const categoryId = resolutions.find((r) => r.itemId === itemId)?.nearbyCategoryIds?.[index];
    if (categoryId == null) return;
    undoable(t.list.nearbyPicked, () =>
      store.patch(saved.id, (p) => {
        p.requirements = p.requirements.map((r) => (r.id === itemId ? { ...r, categoryIds: [categoryId] } : r));
      }),
    );
  };
  const pickShop = (itemId: string, shopId: string, mode: 'change' | 'unavailable', fromShop?: string) => {
    undoable(mode === 'unavailable' ? t.market.replanDone : t.options.sellerPicked, () => {
      if (mode === 'unavailable' && fromShop) store.excludeShop(saved.id, itemId, fromShop);
      store.pinShop(saved.id, itemId, shopId);
    });
    setOptionsFor(null);
  };

  /**
   * The assistant changed the requirement state: take the server's `newState` wholesale, let the plan recompute and
   * show what changed («تغییر کرد» rows) with «برگرداندن» (restores the state from before).
   */
  const applyAssist = (r: AssistResult) => {
    const snapshot = structuredClone(usePlans.getState().plans[saved.id]!);
    store.applyState(saved.id, r.newState);
    if (data.plan) {
      setReplan({
        kind: 'assist',
        snapshot,
        prevPlan: data.plan,
        message: r.messageFa,
        degraded: r.degraded === true,
        degradedReason: r.degradedReason,
        changes: null,
        totalBefore: data.plan.totalToman,
        totalAfter: null,
        stopsBefore: data.plan.stops.length,
        stopsAfter: null,
      });
    }
  };
  const openAssistant = (ctx?: AssistContext, text?: string) => {
    setAssistCtx(ctx);
    setAssistText(text);
    setAssistOpen(true);
  };
  const assistShopName = assistCtx?.shopId
    ? data.plan?.stops.flatMap((st) => shopsOf(st)).find((sh) => sh.shopId === assistCtx.shopId)?.shopName
    : undefined;

  /**
   * Dead end: apply one of the server's relaxations through the client state (no extra request): 'condition' sets the
   * «any» condition answer, 'budget' drops the item's price band, any other attribute drops that stated constraint.
   * The plan recomputes; «برگردان» restores the state from before.
   */
  const relaxItem = (itemId: string, attr: string) => undoable(t.item.relaxed, () => store.relax(saved.id, itemId, attr));

  const includeCondition = (itemId: string) => undoable(t.item.conditionShown, () => store.answer(saved.id, itemId, 'condition', CONDITION_ANY));

  const openSeller = (line: StopLine, stop: Stop, shop: StopShop) => {
    setSellerFor({ line, stop, shop });
    setSellerOpen(true);
  };

  /* ------------ render ------------ */

  const changedIds = new Set((replan?.changes ?? []).filter((c) => c.kind !== 'dropped').map((c) => c.itemId));

  const viewOptions = [
    { value: 'list' as const, label: t.workspace.views.list, badge: pendingCount > 0 ? formatCount(pendingCount) : undefined },
    { value: 'plan' as const, label: t.workspace.views.plan },
    { value: 'market' as const, label: t.workspace.views.market },
  ];

  let body;
  if (data.error && !data.resolve) {
    body = (
      <>
        <ErrorState title={t.workspace.loadError} body={data.errorMessage ?? undefined} onRetry={data.reload} />
        <SavedItemsCard requirements={saved.requirements} />
      </>
    );
  } else if (!data.resolve || !data.plan || view === null) {
    body = <SkeletonCards count={3} />;
  } else if (view === 'list') {
    body = (
      <ListView
        plan={saved}
        resolutions={resolutions}
        busy={busy}
        activeId={activeId}
        setActiveId={setActiveId}
        onAnswer={onAnswer}
        onEnough={onEnough}
        onSettleAll={onSettleAll}
        onChange={(itemId) => setOptionsFor({ itemId, mode: 'change' })}
        onRemove={onRemove}
        onDetachChip={(itemId, key) => store.detachChip(saved.id, itemId, key)}
        onAdd={onAdd}
        onIncludeCondition={includeCondition}
        onRelax={relaxItem}
        onPickModel={pickModel}
        onPickNearby={pickNearby}
        onUnsure={(itemId, q) => openAssistant({ itemId }, q)}
        marker={planMarker(data.plan)}
      />
    );
  } else if (view === 'plan') {
    body = (
      <PlanView
        plan={data.plan}
        busy={busy}
        changed={changedIds}
        onShowSeller={openSeller}
        onChangeItem={(itemId) => setOptionsFor({ itemId, mode: 'change' })}
        onSwitchVariant={(v) => store.setVariant(saved.id, v)}
        onOpenAssistant={(shopId) => openAssistant(shopId ? { shopId } : undefined)}
        onOpenTime={() => setTimeOpen(true)}
        onGoList={() => setView('list')}
      />
    );
  } else {
    body = (
      <MarketView
        saved={saved}
        plan={data.plan}
        changed={changedIds}
        onToggle={(itemId) => store.toggleCheck(saved.id, itemId)}
        onShowSeller={openSeller}
        onUnavailable={(line, stop, shop) => markUnavailable({ line, stop, shop })}
        onPriceDiffers={(line, stop, shop) => setPriceFor({ target: { line, stop, shop }, kind: 'price' })}
        onPaid={(line, stop, shop) => setPriceFor({ target: { line, stop, shop }, kind: 'paid' })}
        onRemoveReport={(itemId) => {
          const prev = usePlans.getState().plans[saved.id]!.reports[itemId];
          store.setReport(saved.id, itemId, null);
          toastUndo(t.seller.reportRemoved, () => usePlans.getState().setReport(saved.id, itemId, prev ?? null));
        }}
        onOptions={(line) => setOptionsFor({ itemId: line.itemId, mode: 'unavailable', shopId: line.shopId })}
      />
    );
  }

  return (
    <div className="page pb-8">
      <div className="glass sticky top-14 z-20 -mx-4 px-4 py-2">
        <SegmentedControl<View> label={t.workspace.viewsLabel} value={view ?? 'list'} onChange={setView} options={viewOptions} />
      </div>

      <div className="mt-3 flex items-start gap-1">
        <h1 className="line-clamp-2 min-w-0 flex-1 pt-1.5 text-2xl font-black leading-snug [overflow-wrap:anywhere]" title={sanitizeText(saved.name)} data-testid="plan-name">
          <BidiText text={saved.name} />
        </h1>
        <IconButton icon="more" label={t.header.more} onClick={() => setMenuOpen(true)} data-testid="plan-menu" />
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        {isStorageAvailable() ? (
          <p
            data-testid="saved-indicator"
            className={`inline-flex items-center rounded-lg px-1 text-sm text-ink-soft transition-colors ${pulse ? 'animate-saved text-accent-ink' : ''}`}
          >
            {t.workspace.saved}
          </p>
        ) : (
          <p role="status" className="rounded-control bg-saffron-soft px-4 py-2 text-sm text-saffron-ink" data-testid="storage-notice">
            {t.workspace.storageUnavailable}
          </p>
        )}

        {view !== 'market' && (
          <button
            type="button"
            onClick={() => setTimeOpen(true)}
            data-testid="visit-chip"
            className="inline-flex min-h-touch items-center gap-2 rounded-chip border border-line bg-surface px-4 text-sm font-bold shadow-card transition-colors hover:border-line-strong/60 active:scale-[0.98]"
          >
            <Icon name="clock" size={18} className="text-accent" />
            {visitChipLabel(saved.visit)}
            <Icon name="chevron-down" size={16} className="text-ink-soft" />
          </button>
        )}
      </div>

      <div className="mt-5 space-y-4" style={{ paddingBottom: barVisible ? '96px' : 0 }}>
        {data.slow && (
          <p role="status" data-testid="slow-notice" className="rounded-xl bg-sunken px-4 py-2 text-sm text-ink-soft">
            {t.notice.slow}
          </p>
        )}
        {data.error && data.resolve && (
          <div role="alert" data-testid="refresh-failed" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-soft px-4 py-2 text-sm text-amber-ink">
            <p className="flex-1">{t.notice.refreshFailed}</p>
            <Button variant="secondary" icon="refresh" onClick={data.reload}>
              {t.error.retry}
            </Button>
          </div>
        )}
        {replan && (view !== 'list' || replan.kind === 'assist') && (
          <ReplanBanner
            info={replan}
            onUndo={undoReplan}
            onDismiss={() => setReplan(null)}
            onOthers={() => replan.itemId && setOptionsFor({ itemId: replan.itemId, mode: 'unavailable', shopId: replan.shopId })}
          />
        )}
        {body}
      </div>

      {barVisible && action && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-canvas via-canvas/85 to-transparent pt-6"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          data-testid="action-bar"
        >
          <div className="page pb-3">
            <Button
              variant="primary"
              size="lg"
              block
              onClick={action.run}
              disabled={!data.resolve || !data.plan || busy}
              data-testid="primary-action"
              className="pointer-events-auto !min-h-[58px] justify-between rounded-[20px] !bg-night-2 pe-2 ps-5 text-lg font-extrabold !shadow-float hover:!bg-night disabled:!bg-night-2 disabled:opacity-80"
            >
              {action.label}
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-[14px] bg-saffron text-ink">
                <Icon name="arrow-forward" size={22} />
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* ---- sheets ---- */}
      <TimeSheet open={timeOpen} visit={saved.visit} onClose={() => setTimeOpen(false)} onApply={(v) => store.setVisit(saved.id, v)} />
      <PlanMenuSheet
        open={menuOpen}
        name={saved.name}
        onClose={() => setMenuOpen(false)}
        onRename={(n) => store.rename(saved.id, n)}
        getShareUrl={getShareUrl}
        onCopied={() => toast(t.workspace.menu.linkCopied)}
        onNewPlan={() => navigate('/')}
        onRemove={() => {
          store.remove(saved.id);
          toast(t.workspace.menu.removed);
          navigate('/');
        }}
      />
      <AssistantSheet
        open={assistOpen}
        state={state}
        context={assistCtx}
        contextLabel={assistShopName}
        autoText={assistText}
        onClose={() => setAssistOpen(false)}
        onApply={applyAssist}
        onUnchanged={() => setReplan((cur) => (cur?.kind === 'assist' ? { ...cur, superseded: true } : cur))}
      />
      <OptionsSheet
        open={!!optionsFor}
        state={state}
        itemId={optionsFor?.itemId ?? null}
        itemName={optionsFor ? nameOf(optionsFor.itemId) : ''}
        mode={optionsFor?.mode}
        reportedShopId={optionsFor?.shopId}
        visitActive={data.plan?.visitActive ?? false}
        onClose={() => setOptionsFor(null)}
        onPickModel={(pid) => optionsFor && pickModel(optionsFor.itemId, pid)}
        onPickShop={(sid) => optionsFor && pickShop(optionsFor.itemId, sid, optionsFor.mode, optionsFor.shopId)}
      />
      <SellerSheet
        open={sellerOpen}
        line={sellerFor?.line ?? null}
        stop={sellerFor?.stop ?? null}
        shop={sellerFor?.shop ?? null}
        report={sellerFor && saved.reports[sellerFor.line.itemId]?.shopId === sellerFor.line.shopId ? saved.reports[sellerFor.line.itemId] : undefined}
        onClose={() => setSellerOpen(false)}
        onReport={(kind, price) => {
          if (!sellerFor) return;
          if (kind === 'unavailable') markUnavailable(sellerFor);
          else report(sellerFor, kind, price);
        }}
        onRemoveReport={() => {
          if (!sellerFor) return;
          store.setReport(saved.id, sellerFor.line.itemId, null);
          setSellerOpen(false);
        }}
      />
      <BottomSheet open={!!priceFor} onClose={() => setPriceFor(null)} title={priceFor?.kind === 'paid' ? t.market.paidSheetTitle : t.seller.priceDiffers}>
        {priceFor && (
          <PriceInput
            id="report-price"
            onSave={(p) => {
              report(priceFor.target, priceFor.kind, p);
              setPriceFor(null);
            }}
          />
        )}
      </BottomSheet>
    </div>
  );
}

/** The plan's items straight from this device: still readable when the server cannot be reached. */
function SavedItemsCard({ requirements }: { requirements: Requirement[] }) {
  return (
    <section data-testid="saved-items" aria-labelledby="saved-items-h" className="rounded-card border border-line bg-surface p-4">
      <h2 id="saved-items-h" className="text-base">
        {t.connection.savedItems}
      </h2>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-base">
        {requirements.map((r) => (
          <li key={r.id}>
            <BidiText text={r.text} />
          </li>
        ))}
      </ul>
    </section>
  );
}
