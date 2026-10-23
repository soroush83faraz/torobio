# همراه‌بازار: design language «red, white, green»

## Rationale

1. A confident shopping brand in the spirit of the Torob marketplace: **red for action, green for good news, white for calm.** White does most of the work; red and green are spent on meaning, never on decoration, so the screen never reads as a traffic light or a holiday card.
2. **Palette.** Brand red `#D91E2B` is the action and brand colour: primary buttons, the brand mark, the selected tab pill, selection, the route on the map. Green `#1B8A4B` means good news only: open now, available, covered/complete, savings, check-marks, the «همه‌چیز یک‌جا» badge, the recommended mall. A muted yellow-amber (`amber`) marks «needs attention / pending / conflict» and is the only other hue. Destructive actions and errors use a darker crimson `danger #A3121B`, kept apart from the brand red. Neutrals are a clean cool white and grey (`canvas #FBFBFB`, `sunken #F2F2F4`).
3. **Dark surfaces.** Two kinds, used sparingly so each reads as one focal point. The *brand* surface (`.surface-night`) is a deep red gradient (`#9A1520 → #7E0F18`, lifting to `#B71822` at the top edge) for the Home hero; the brand tile and the assistant's avatar are flat brand red. The *charcoal* surface (`.surface-coal`, `#2B2B32 → #1B1B1F`) carries dense text with green highlights: toasts, the market progress dock, the list's best-mall teaser and the map's recommendation banner. The floating primary action and the selected tab pill are flat brand red.
4. **Typography.** Vazirmatn throughout. The display size is `2.125rem/900` and is used for headlines only. Section titles are 800 and body text is 400–600. The Persian-first floor of 16 px stays, and letter-spacing is never applied to Persian because it breaks the joins between letters.
5. **Numerals.** Prices and counts use the `.num` class (tabular figures), so a price can count up without the digits jumping.
6. **Radii.** Controls `14px`, cards `20px`, hero and sheets `28px`, chat bubbles `22px` with a tight `6px` corner on the start-top side, which is the bubble's tail toward the avatar.
7. **Elevation.** Shadows are tinted neutral charcoal (red under red surfaces) and always have an offset and a blur: `card` (rest), `raised` (open or active), `hero`, `float` (primary action) and `sheet`. No shadow is a flat coloured halo; the one exception is the focus glow on the main input.
8. **Texture.** A *khatam* (8-point star, two interlaced squares) lattice appears at 9–25 % opacity in three places only: the hero, the assistant avatar and image placeholders. It is masked so that it fades out and never sits behind text.
9. **Identity.** The brand mark and the assistant's face are the same white khatam on brand red. «همراه» the app and «همراه» the agent are one character.
10. **Iconography.** One 24 px line set (1.8 stroke, round caps) lives in `Icon.tsx`. Directional icons mirror in RTL. Emoji are never used as icons.
11. **Glass.** Frosted glass is used where it has a job: the sticky header and tab bar (content scrolls under them) and bottom sheets (96 % opaque so text keeps its contrast).
12. **Motion thesis.** The focal moment is the assistant's conversation. A question arrives as a bubble, the chosen answer fills and draws a check, and the bubble slides on to the next question. Other motion is limited to feedback: spring press, the tab pill that glides between tabs, price count-up and staggered list entry.
13. **Timing.** Entrances use `cubic-bezier(0.16,1,0.3,1)` at 300–500 ms and exits are faster (150–200 ms). Nothing bounces.
14. **Accessibility.** All text pairs meet WCAG AA and control outlines, check-marks and focus rings meet 3:1; the pairs are checked in `rtl-rules.test.tsx`. White text on green always sits on `good-strong` (white on `good` is 4.39, so `good` is used for fills and icons only). The focus ring is dark ink (white on dark surfaces), so it is never mistaken for the red «selected» state. Touch targets are at least 48 px, and layout uses logical properties only. With `prefers-reduced-motion`, `<MotionRoot reducedMotion="user">` drops transform and layout animation, CSS loops stop, and count-up shows the final value. Fades and colour changes that carry state remain.
15. **Copy.** The assistant speaks in the app's «تو» voice, briefly, and always says why it asks.

## Tokens (tailwind.config.js)

| Token | Value | Use |
|---|---|---|
| `canvas` / `surface` / `sunken` | `#FBFBFB` / `#FFF` / `#F2F2F4` | page, cards, wells |
| `line` / `line-strong` | `#E7E7EA` / `#8A8A93` | dividers / input and chip outlines (3.3:1) |
| `ink` / `ink-soft` | `#1B1B1F` / `#5B5B66` | text |
| `accent` (`strong`, `soft`, `ink`) | `#D91E2B` / `#B71822` / `#FDECEE` / `#7A0F16` | brand red: actions, brand, selection |
| `good` (`strong`, `soft`, `ink`, `bright`) | `#1B8A4B` / `#14703B` / `#E3F4EA` / `#0E4A27` / `#6BD49A` | good news; `bright` is green text on charcoal |
| `night` (`2`, `3`, `ink`, `soft`) | `#7E0F18` / `#9A1520` / `#B71822` / `#FFF` / `#FFD6D9` | deep-red hero surface and text on it |
| `coal` (`2`, `ink`, `soft`) | `#1B1B1F` / `#2B2B32` / `#FFF` / `#C8C8CE` | charcoal surfaces and text on them |
| `amber` (`soft`, `ink`) | `#D9A514` / `#FBF3DC` / `#5E4600` | semantic «needs info / pending / conflict» |
| `danger` (`soft`) | `#A3121B` / `#FBE9EA` | destructive actions and errors only |
| radii `control` `card` `sheet` `hero` | 14 / 20 / 28 / 28 px | |
| shadows `card` `raised` `hero` `float` `sheet` `focus` `focus-light` | neutral-tinted; `focus` is a red ring on white, `focus-light` a white ring on the red hero | |

CSS helpers (`index.css`): `.surface-night`, `.surface-coal`, `.girih` / `.girih-soft`, `.glass`, `.glass-sheet`, `.num`, `animate-resolved` (green ring), `animate-breathe` (red).

The map (`components/map/map.css`, `--hbm-*`) and the places view (`screens/places.css`, `--hb-*`) keep their colours as custom properties: recommended mall pin green, selected pin brand red, other pins white with dark text, muted pins grey, route and stop numbers red, the user's location a charcoal dot, OSM tiles in full grayscale so the pins carry the colour. The Home dot-map (`homeMapHero.css`, `--hero-*`) is white dots, green «hot» malls and light-red arcs on the deep-red hero.

## Motion primitives (`src/components/motion/`)

| Primitive | Purpose |
|---|---|
| `MotionRoot` | app-wide `MotionConfig`, reduced motion = user |
| `StaggerList` / `StaggerItem` / `Rise` | list reveal, single rise-in |
| `Pressable`, `pressFeedback`, `pressFeedbackSoft` | spring press on buttons and cards (`Button` uses it) |
| `SegmentedControl` (components) | shared-layout pill (`layoutId`) |
| `CountUp` | price count-up, final value on first paint |
| `TypingDots` | assistant is working |
| `AnimatedCheck`, `ProgressRing`, `StepDots` | answered check, plan progress, question progress |

## Slots

- `src/screens/home/HomeMapSlot.tsx`: the living bazaar-belt map (HomeMapHero, 3:2) as the top band of the Home deep-red hero, fading into it under the heading; caption «بازار تهران، زنده · ۵۰۱ پاساژ». Keep its `data-slot="home-map"` wrapper.
- Workspace tabs: «فهرست · نقشه · برنامه · در بازارم». «نقشه» (PlacesTab) fills the screen under the tabs (no page scroll); its first answer can take ~10 s, so the assistant narrates progress over the map. When nothing is left to answer, the list shows a charcoal teaser card with a green mark for the best mall.
- Plan: route map header (RouteMap: still preview, tap for the full map), stops as a numbered timeline when there are 2+, alternatives as side-by-side comparison cards. Market: compact stop headers, big check rows that fold when bought, the progress docked at the bottom on the charcoal surface (green ring).
- Product images: `lib/images.ts` `imageOf()` reads the optional `imageUrl` from `ItemResolution.product` or `ModelOption`, and `ProductThumb` renders it, falling back to a placeholder.
