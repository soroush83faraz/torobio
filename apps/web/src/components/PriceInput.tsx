import { useState } from 'react';
import { t } from '../copy/fa';
import { formatToman, parseNumberInput, toPersianDigits } from '../lib/format';
import { Button } from './Button';

/** Numeric input: accepts Persian or Latin digits (LTR entry), shows Persian digits back. */
export function PriceInput({ onSave, saveLabel = t.seller.save, id = 'price-input' }: { onSave: (price: number) => void; saveLabel?: string; id?: string }) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState(false);
  const parsed = parseNumberInput(raw);
  const submit = () => {
    if (parsed == null || parsed <= 0) {
      setError(true);
      return;
    }
    onSave(parsed);
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {t.seller.newPrice}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={toPersianDigits('3400000')}
          aria-invalid={error}
          aria-describedby={`${id}-hint`}
          className="min-h-touch min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-start text-lg"
          data-autofocus
        />
        <Button variant="primary" onClick={submit}>
          {saveLabel}
        </Button>
      </div>
      <p id={`${id}-hint`} className={`mt-1 text-sm ${error ? 'text-amber-ink' : 'text-ink-soft'}`} role={error ? 'alert' : undefined}>
        {error ? t.seller.invalidPrice : parsed ? formatToman(parsed) : t.seller.newPriceHint}
      </p>
    </div>
  );
}
