/**
 * ============================================================================
 *  ScrollProof — Scroll Driver (v1)
 * ============================================================================
 *
 *  The thinnest module. Reads the browser scroll position, converts it to
 *  a 0..1 progress value `p`, and calls seek + update on every change.
 *
 *  This is the ONLY module that reads from the browser scroll API.
 *  Everything it calls (seek, update) is already written and tested.
 *
 * ============================================================================
 */
import { seek } from './interpolation-core.js';
import { setup, update } from './renderer.js';
/**
 * Wires a scene to an SVG element and drives it from the scroll position.
 * Call once on page load — it registers event listeners and renders immediately.
 *
 * p = scrollY / (total page height − window height)
 * Clamped to [0, 1] in case of rounding or resize edge cases.
 */
export function createDriver(scene, svg) {
    const elements = setup(scene, svg);
    function tick() {
        const scrollable = document.body.scrollHeight - window.innerHeight;
        const p = scrollable > 0
            ? Math.min(1, Math.max(0, window.scrollY / scrollable))
            : 0;
        update(scene, seek(scene, p), elements);
    }
    // passive: true tells the browser this handler never calls preventDefault(),
    // so it can keep scrolling smooth without waiting for our code.
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', tick, { passive: true });
    tick(); // render at the current scroll position immediately on load
}
