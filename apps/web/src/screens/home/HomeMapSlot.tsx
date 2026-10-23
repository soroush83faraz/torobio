/**
 * ─── SLOT: Home map ────────────────────────────────────────────────────────────────────────────────────────
 * Reserved for the interactive dot-map of the bazaar belt (Ferdowsi / Sheikh Hadi / Baharestan), built by the
 * map work stream (src/components/map/**). Replace the placeholder body below with the map component; keep the
 * outer wrapper's aspect ratio (4:3) and radius so Home's rhythm does not shift when the map lands.
 * Until then this renders a quiet, decorative placeholder (khatam lattice on warm paper) and is hidden from
 * assistive technology.
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export function HomeMapSlot() {
  return (
    <div
      data-slot="home-map"
      aria-hidden="true"
      className="relative aspect-[4/3] w-full overflow-hidden rounded-card border border-line bg-sunken/60"
    >
      <span className="girih-soft absolute inset-0 opacity-20 [mask-image:radial-gradient(closest-side,#000,transparent)]" />
    </div>
  );
}
