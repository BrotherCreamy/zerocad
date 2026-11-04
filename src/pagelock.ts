// The page itself never zooms (docs/plans/pwa-pages.md). index.html's viewport
// says so, and the CSS holds the page still (fixed, no overflow) and takes
// touch-action from the canvas — but iOS Safari has ignored
// `user-scalable=no` since iOS 10, for accessibility, and pinch-zooms the
// page anyway wherever touch-action allows it, which over the chrome it must
// (the log scrolls under a finger). A page that zooms under a two-finger
// gesture meant for the drawing is unusable, so these listeners refuse the
// two things iOS zooms on:
//
// - WebKit's own `gesturestart`/`gesturechange`/`gestureend`, which Safari
//   raises for a pinch and zooms on unless they are cancelled;
// - a `touchmove` with more than one finger down, anywhere in the document.
//   One finger is left alone, so the log still scrolls and the canvas still
//   gets its pointer events (cancelling a touch event never cancels those).
//
// Both are registered non-passive, at the document: a passive listener's
// preventDefault is ignored, and Safari treats touch listeners on the
// document as passive unless told otherwise.

/** The part of a Document these listeners need — a fake one is enough for a test. */
export interface Listenable {
  addEventListener(type: string, listener: (e: Event) => void, options: AddEventListenerOptions): void;
}

/** The WebKit events a pinch raises, cancelled so Safari does not zoom on them. */
export const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;

export function lockPage(doc: Listenable): void {
  const cancel = (e: Event) => e.preventDefault();
  for (const type of GESTURE_EVENTS) doc.addEventListener(type, cancel, { passive: false });
  doc.addEventListener("touchmove", (e) => {
    if ((e as TouchEvent).touches.length > 1) e.preventDefault();
  }, { passive: false });
}
