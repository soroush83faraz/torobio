import { findQuantities, single } from './numbers';

/**
 * Screen size stated in a title or request («تلویزیون ۵۵ اینچ», «15.6 اینچی», «43inch»), any category.
 * `t` must be prepared with `prepTitle` (Latin digits, normalised letters). One distinct value in 5..120, else null
 * (a title listing several sizes states none of them).
 */
export function screenInchOf(t: string): number | null {
  const vals = findQuantities(t, 'اینچی|اینچ|inches|inch', { words: false })
    .map((h) => h.value)
    .filter((v) => v >= 5 && v <= 120);
  return single(vals);
}
