# Agent Note: Drawer edge swipe is touch-only; mouse drags keep text selection

Status: implemented

English | [中文](2026-10-10-drawer-swipe-touch-only.zh.md)

## Problem

On the overlay band (below the 768px breakpoint) a mouse left-drag served two masters. Dragging rightward from the frame's left edge to select text also armed the drawer open gesture, so the drawer popped out over the text being selected; dragging leftward across the open drawer to extend a selection likewise armed the close gesture. The mirror image failure came from the close path itself: a mouse close swipe the browser cut mid-drag — a native drag-and-drop starting on a link, image, or already-selected text, or a mouse-gesture extension claiming the drag — arrived as `pointercancel`, and the settle logic votes "stay open" on cancel, so the drawer tracked briefly and then animated back open ("只向左划一点，然后又弹出来").

## Decision

`onGestureDown` (`packages/client/ui-layout/src/client/AppFrame.tsx`) now requires `e.pointerType === 'touch'` before arming either direction. A mouse drag therefore never enters the gesture path: text selection keeps the whole drag, and no mid-drag `pointercancel` from native drag-and-drop or an extension can reach the settle logic. Overlay-band mice drive the drawer through the channels that already exist — the fab, the sidebar drag handle, the scrim click, and Escape. Touch behavior is unchanged, and the pen follows the mouse (a pen drag also selects on several platforms). The cancel-settles-open vote is deliberately untouched: on touch it is the safe answer to OS- and browser-reserved edge gestures (iOS Safari's back-swipe, Chrome's overscroll history navigation) that cut the pointer stream mid-swipe — there, snapping back to open is correct, and no page code can claim those gestures.

## Alternatives considered

- **Abort the gesture when a text selection appears (`selectionchange`).** Rejected: the drawer toggles at engagement, so an abort after selection starts still has to un-pop an already-visible drawer — the flash the user sees — and the partially-driven close needs its state vote undone.
- **Distinguish selection drags from swipes by velocity.** Rejected: fast selection drags and slow swipes overlap heavily in practice; any threshold misclassifies one side.
- **Disarm when `pointerdown` lands on selectable text.** Rejected: the conversation transcript is almost entirely selectable text, which would void the gesture exactly where it is most useful, and drags starting on empty space would still conflict.
- **Require a stillness threshold before travel counts.** Rejected: it preserves the mouse gesture but makes every touch swipe wait through a press-and-hold, changing the touch feel to fix a mouse-only problem.
- **Also add `touch-action` on the frame.** Rejected for now: with the gesture touch-only, the remaining touch-side cancellations come from OS-reserved edge gestures the page cannot claim anyway, and a frame-wide `touch-action: pan-y` would strip native horizontal panning from every nested scroller in the app.

## Consequences

- `app-frame.client.spec.tsx` pins both directions for the mouse: an edge drag leaves the drawer closed and uncaptured, and a full-travel drag across the open drawer leaves it open. The `swipe()` helper defaults `pointerType` to `'touch'` because jsdom's `PointerEvent` defaults it to `''`, not `'mouse'` — a future jsdom change there fails the suite loudly instead of silently re-arming the mouse.
- The ui-layout README contract (both languages) now states that a mouse drag never arms the swipe and names the mouse channels, next to the existing 35% snap and scrim/Escape close contract.
