# همراه‌بازار: design language «Bazaar at dusk»

## Rationale

1. The subject is Tehran's covered bazaar belt: brick vaults, turquoise tile, skylights and saffron in the spice rows. The UI borrows those materials and leaves out the souvenir clichés.
2. **Palette.** Teal `#0A6B6B` stays the brand and the action colour. *Saffron* `#E8A317` carries attention and delight (the send button, the progress arc, the assistant's star). *Terracotta* `#B4532F` adds a second warm note for category tiles. Neutrals are warm plaster (`canvas #F8F3EB`, `sunken #F0E8DB`), never grey.
3. **Night surfaces.** Hero areas use a deep teal ink (`night #0B2422 → #0F3A37`) with a saffron glow coming from the top edge, like light falling into a vault at dusk. The Home hero, the selected tab pill, the floating primary action and toasts are the only dark surfaces, so each one reads as a single focal point.
4. **Typography.** Vazirmatn throughout. The display size is `2.125rem/900` and is used for headlines only. Section titles are 800 and body text is 400–600. The Persian-first floor of 16 px stays, and letter-spacing is never applied to Persian because it breaks the joins between letters.
5. **Numerals.** Prices and counts use the `.num` class (tabular figures), so a price can count up without the digits jumping.
6. **Radii.** Controls `14px`, cards `20px`, hero and sheets `28px`, chat bubbles `22px` with a tight `6px` corner on the start-top side, which is the bubble's tail toward the avatar.
7. **Elevation.** Shadows are tinted warm brown and always have an offset and a blur: `card` (rest), `raised` (open or active), `hero`, `float` (primary action) and `sheet`. No shadow is a flat coloured halo; the one exception is the focus glow on the main input.
8. **Texture.** A *khatam* (8-point star, two interlaced squares) lattice appears at 9–25 % opacity in three places only: the hero, the assistant avatar and image placeholders. It is masked so that it fades out and never sits behind text.
9. **Identity.** The brand mark and the assistant's face are the same saffron khatam. «همراه» the app and «همراه» the agent are one character.
10. **Iconography.** One 24 px line set (1.8 stroke, round caps) lives in `Icon.tsx`. Directional icons mirror in RTL. Emoji are never used as icons.
11. **Glass.** Frosted glass is used where it has a job: the sticky header and tab bar (content scrolls under them) and bottom sheets (96 % opaque so text keeps its contrast).
12. **Motion thesis.** The focal moment is the assistant's conversation. A question arrives as a bubble, the chosen answer fills and draws a check, and the bubble slides on to the next question. Other motion is limited to feedback: spring press, the tab pill that glides between tabs, price count-up and staggered list entry.
13. **Timing.** Entrances use `cubic-bezier(0.16,1,0.3,1)` at 300–500 ms and exits are faster (150–200 ms). Nothing bounces.
14. **Accessibility.** All text pairs meet WCAG AA; the pairs are checked in `rtl-rules.test.tsx`. Touch targets are at least 48 px, and layout uses logical properties only. With `prefers-reduced-motion`, `<MotionRoot reducedMotion="user">` drops transform and layout animation, CSS loops stop, and count-up shows the final value. Fades and colour changes that carry state remain.
15. **Copy.** The assistant speaks in the app's «تو» voice, briefly, and always says why it asks.

## Tokens (tailwind.config.js)

| Token | Value | Use |
|---|---|---|
| `canvas` / `surface` / `sunken` | `#F8F3EB` / `#FFF` / `#F0E8DB` | page, cards, wells |
| `ink` / `ink-soft` | `#1E1A15` / `#5A5146` | text |
| `accent` (`strong`, `soft`, `ink`) | `#0A6B6B` … | brand, actions, «ready» |
| `night` (`2`, `3`, `ink`, `soft`) | `#0B2422` … | hero surfaces and text on them |
| `saffron` (`bright`, `soft`, `ink`) | `#E8A317` … | attention, delight |
| `terracotta` (`soft`, `ink`) | `#B4532F` … | secondary warmth |
| `amber` | saffron family | semantic «needs info / conflict» (name kept for existing code) |
| radii `control` `card` `sheet` `hero` | 14 / 20 / 28 / 28 px | |
| shadows `card` `raised` `hero` `float` `sheet` `focus` | warm-tinted | |

CSS helpers (`index.css`): `.surface-night`, `.girih` / `.girih-soft`, `.glass`, `.glass-sheet`, `.num`, `animate-resolved`, `animate-breathe`.

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

- `src/screens/home/HomeMapSlot.tsx`: the living bazaar-belt map (HomeMapHero, 3:2) as the top band of the Home night hero, fading into it under the heading; caption «بازار تهران، زنده · ۵۰۱ پاساژ». Keep its `data-slot="home-map"` wrapper.
- Workspace tabs: «فهرست · نقشه · برنامه · در بازارم». «نقشه» (PlacesTab) fills the screen under the tabs (no page scroll); its first answer can take ~10 s, so the assistant narrates progress over the map. When nothing is left to answer, the list shows a dusk teaser card for the best mall.
- Plan: route map header (RouteMap: still preview, tap for the full map), stops as a numbered timeline when there are 2+, alternatives as side-by-side comparison cards. Market: compact stop headers, big check rows that fold when bought, the progress docked at the bottom in the night surface.
- Product images: `lib/images.ts` `imageOf()` reads the optional `imageUrl` from `ItemResolution.product` or `ModelOption`, and `ProductThumb` renders it, falling back to a placeholder.
