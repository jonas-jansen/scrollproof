/**
 * ============================================================================
 *  ScrollProof — Controls (v1, optional)
 * ============================================================================
 *
 *  Optional add-on to the scroll driver. Provides keyboard navigation.
 *
 *    Scroll snap  — handled by CSS (scroll-snap-type: y mandatory in the HTML).
 *                   The browser snaps smoothly after inertia; no JS needed.
 *
 *    Keyboard nav — → / ↓ / Space advance one step; ← / ↑ go back one step.
 *                   Animates over KEYBOARD_DURATION ms so the reader watches
 *                   the transformation play out.
 *
 *  HOW TO ENABLE / DISABLE
 *  -----------------------
 *  Call attachControls(scene) once, after createDriver(). Comment out that
 *  one call in index.html to remove keyboard navigation entirely.
 *
 *  TUNING
 *  ------
 *  Adjust KEYBOARD_DURATION below.
 *
 * ============================================================================
 */
// ── Tuning constant ───────────────────────────────────────────────────────────
/** How long a keyboard-triggered step advance takes (ms). */
const KEYBOARD_DURATION = 1200;
// ── Helpers ───────────────────────────────────────────────────────────────────
/** Cubic ease-in-out curve. */
function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
/**
 * Animates window.scrollY to targetY over `duration` ms, then calls `onDone`.
 * Does nothing if already at the target.
 */
function smoothScrollTo(targetY, duration, onDone) {
    const startY = window.scrollY;
    if (Math.abs(targetY - startY) < 1) {
        onDone?.();
        return;
    }
    const startTime = performance.now();
    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        window.scrollTo(0, startY + (targetY - startY) * easeInOut(t));
        if (t < 1)
            requestAnimationFrame(step);
        else
            onDone?.();
    }
    requestAnimationFrame(step);
}
/** Current scroll progress p (0..1). */
function currentP() {
    const scrollable = document.body.scrollHeight - window.innerHeight;
    return scrollable > 0
        ? Math.min(1, Math.max(0, window.scrollY / scrollable))
        : 0;
}
/**
 * The p value where each step's text is vertically centred in the viewport.
 *
 * Each step div is 100vh tall. Step i (0-based) is centred when scrollY
 * equals i × viewportHeight, which gives p = i / (totalSteps − 1).
 *
 * For 3 steps: [0.0, 0.5, 1.0]
 * For 4 steps: [0.0, 0.333, 0.667, 1.0]
 *
 * This is the same position the CSS scroll-snap lands on.
 */
function stepCentrePositions(nSteps) {
    if (nSteps <= 1)
        return [0];
    return Array.from({ length: nSteps }, (_, i) => i / (nSteps - 1));
}
/** Index of the step whose centre p is closest to the given p. */
function nearestStepIndex(p, positions) {
    let best = 0, bestDist = Infinity;
    positions.forEach((pos, i) => {
        const d = Math.abs(p - pos);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    });
    return best;
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Attaches keyboard navigation to the page.
 * Call once, after createDriver(). Remove this call to disable.
 *
 * Keys: → ↓ Space = next step.   ← ↑ = previous step.
 */
export function attachControls(scene) {
    const positions = stepCentrePositions(scene.steps.length);
    const scrollable = () => document.body.scrollHeight - window.innerHeight;
    let animating = false;
    window.addEventListener('keydown', (e) => {
        const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ';
        const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        if (!forward && !backward)
            return;
        e.preventDefault(); // stop the browser's own scroll-on-arrow / scroll-on-space
        if (animating)
            return; // one step at a time
        const current = nearestStepIndex(currentP(), positions);
        const next = Math.min(Math.max(current + (forward ? 1 : -1), 0), positions.length - 1);
        if (next === current)
            return; // already at the first or last step
        animating = true;
        smoothScrollTo(positions[next] * scrollable(), KEYBOARD_DURATION, () => {
            animating = false;
        });
    });
}
