import { useEffect, useState } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { t } from '../copy/fa';

interface Props {
  open: boolean;
  name: string;
  onClose: () => void;
  onRename: (name: string) => void;
  onCopyLink: () => void;
  onNewPlan: () => void;
  onRemove: () => void;
}

type Step = 'menu' | 'rename' | 'confirm';

/** «⋯»: تغییر نام، کپی پیوند برنامه، شروع برنامهٔ تازه، حذف. */
export function PlanMenuSheet({ open, name, onClose, onRename, onCopyLink, onNewPlan, onRemove }: Props) {
  const [step, setStep] = useState<Step>('menu');
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (open) {
      setStep('menu');
      setDraft(name);
    }
  }, [open, name]);

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
    <BottomSheet open={open} onClose={onClose} title={step === 'rename' ? t.workspace.nameLabel : t.header.more}>
      {step === 'menu' && (
        <div className="space-y-1">
          {row('edit', t.workspace.menu.rename, () => setStep('rename'), 'menu-rename')}
          {row('link', t.workspace.menu.copyLink, () => { onCopyLink(); onClose(); }, 'menu-copy-link')}
          {row('plus', t.workspace.menu.newPlan, () => { onNewPlan(); onClose(); }, 'menu-new')}
          {row('trash', t.workspace.menu.remove, () => setStep('confirm'), 'menu-remove', true)}
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
