import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { t } from '../copy/fa';
import { canWebShare, copyText, selectAll, webShare } from '../lib/clipboard';

interface Props {
  open: boolean;
  name: string;
  onClose: () => void;
  onRename: (name: string) => void;
  /** The real share URL (`#/s/<payload>`), built fresh from the saved plan. */
  getShareUrl: () => string;
  /** Called when the link reached the clipboard (the app shows its toast). */
  onCopied: () => void;
  onNewPlan: () => void;
  onRemove: () => void;
}

type Step = 'menu' | 'rename' | 'confirm' | 'link';

/** «⋯»: تغییر نام، کپی پیوند برنامه، شروع برنامهٔ تازه، حذف. */
export function PlanMenuSheet({ open, name, onClose, onRename, getShareUrl, onCopied, onNewPlan, onRemove }: Props) {
  const [step, setStep] = useState<Step>('menu');
  const [draft, setDraft] = useState(name);
  const [link, setLink] = useState<{ url: string; copied: boolean } | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setStep('menu');
      setDraft(name);
      setLink(null);
    }
  }, [open, name]);

  // the link step opens with the whole link already selected
  useEffect(() => {
    if (step === 'link' && linkRef.current) selectAll(linkRef.current);
  }, [step]);

  /**
   * Clipboard API when it exists (secure origins), else a selected-field `execCommand`; when only the fallback worked or
   * nothing did, the link stays on screen in a selectable field, so there is never a dead end on plain HTTP.
   */
  const copyLink = async () => {
    const url = getShareUrl();
    const how = await copyText(url);
    if (how === 'clipboard') {
      onCopied();
      onClose();
      return;
    }
    setLink({ url, copied: how === 'exec' });
    setStep('link');
  };
  const shareLink = async () => {
    if (await webShare({ title: name, url: getShareUrl() })) onClose();
  };

  const row = (icon: IconName, label: string, onClick: () => void, testId: string, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-start text-base font-semibold hover:bg-sunken ${danger ? 'text-danger' : ''}`}
    >
      <Icon name={icon} size={22} />
      {label}
    </button>
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={step === 'rename' ? t.workspace.nameLabel : step === 'link' ? t.workspace.menu.linkTitle : t.header.more}>
      {step === 'menu' && (
        <div className="space-y-1">
          {row('edit', t.workspace.menu.rename, () => setStep('rename'), 'menu-rename')}
          {row('link', t.workspace.menu.copyLink, () => void copyLink(), 'menu-copy-link')}
          {canWebShare() && row('link', t.workspace.menu.share, () => void shareLink(), 'menu-share')}
          {row('plus', t.workspace.menu.newPlan, () => { onNewPlan(); onClose(); }, 'menu-new')}
          {row('trash', t.workspace.menu.remove, () => setStep('confirm'), 'menu-remove', true)}
        </div>
      )}
      {step === 'link' && link && (
        <div data-testid="share-fallback">
          <p className="text-base" data-testid="share-help" role="status">
            {link.copied ? t.workspace.menu.linkHelpCopied : t.workspace.menu.linkHelp}
          </p>
          <label htmlFor="share-url" className="sr-only">
            {t.workspace.menu.linkField}
          </label>
          <input
            id="share-url"
            ref={linkRef}
            data-autofocus
            data-testid="share-url"
            readOnly
            dir="ltr"
            value={link.url}
            onFocus={(e) => selectAll(e.currentTarget)}
            onClick={(e) => selectAll(e.currentTarget)}
            className="mt-3 min-h-touch w-full rounded-xl border border-line-strong bg-surface px-3 text-start text-sm"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="primary" className="flex-1" data-testid="share-select-all" onClick={() => linkRef.current && selectAll(linkRef.current)}>
              {t.workspace.menu.selectAll}
            </Button>
            <Button
              data-testid="share-copy"
              onClick={async () => {
                const how = await copyText(link.url, linkRef.current);
                if (how !== 'failed') setLink({ ...link, copied: true });
                if (linkRef.current) selectAll(linkRef.current);
              }}
            >
              {t.workspace.menu.copyAgain}
            </Button>
          </div>
        </div>
      )}
      {step === 'rename' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onRename(draft);
            onClose();
          }}
        >
          <label htmlFor="plan-name" className="sr-only">
            {t.workspace.nameLabel}
          </label>
          <input
            id="plan-name"
            data-autofocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-touch w-full rounded-xl border border-line-strong bg-surface px-3 text-base"
          />
          <div className="mt-3 flex gap-2">
            <Button type="submit" variant="primary" className="flex-1">
              {t.workspace.menu.save}
            </Button>
            <Button onClick={() => setStep('menu')}>{t.workspace.menu.cancel}</Button>
          </div>
        </form>
      )}
      {step === 'confirm' && (
        <div>
          <p className="text-base">{t.workspace.menu.confirmRemove}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" className="flex-1" onClick={() => { onRemove(); onClose(); }} data-testid="confirm-remove">
              {t.workspace.menu.removeYes}
            </Button>
            <Button onClick={() => setStep('menu')}>{t.workspace.menu.removeNo}</Button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
