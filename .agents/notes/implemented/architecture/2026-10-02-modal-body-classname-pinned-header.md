# Agent Note: Modal bodyClassName pins the pairing dialog header

Status: implemented

English | [中文](2026-10-02-modal-body-classname-pinned-header.zh.md)

## Problem

The pairing panel outgrows small windows, so the Connect-phone dialog caps its height and scrolls. The scroll region was the Modal's whole content column, which carries the title, description, and close button — scrolling to the bottom moved the header out of view and the operator could no longer reach the ✕ to close the dialog.

## Decision

`Modal` gains an optional `bodyClassName`, applied to its body wrapper, so a caller can name the body — not the content column — as the scroll region. The Connect-phone dialog caps the dialog height as before, keeps the content column shrinkable (`min-height: 0`), and moves `overflow-y: auto` to the body; the header and description stay visible at every scroll position. The prop is additive: the three existing `contentClassName` consumers are untouched.

## Alternatives considered

- **`position: sticky` on the header inside the scrolling content.** Rejected: the sticky header would still scroll within the padded column, and pinning the description row too needs structural sibling selectors (`:nth-child`) that break on any Modal markup change.
- **Scrolling inside the pairing panel itself.** Rejected: the panel must not know it lives in a Modal; the dialog chrome owns the height cap.

## Consequences

- Any Modal caller can pin the chrome the same way; a Modal with only `contentClassName` behaves exactly as before.
- The pairing dialog's ✕ and title remain reachable at the bottom of the tallest panel (QR + requests + devices + recycle bin).
