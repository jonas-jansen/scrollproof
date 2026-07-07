/**
 * ============================================================================
 *  ScrollProof — Prose Renderer (v1)
 * ============================================================================
 *
 *  Reads scene.steps and builds the scrollable prose column in the DOM.
 *  Call once on page load, before createDriver(), so the prose exists before
 *  the driver starts measuring the page height.
 *
 *  NOT handled here (deferred to the objects-in-prose module):
 *    - $KaTeX$ math rendering inside body / equation strings
 *    - {obj:id} inline object tokens (the Byrne glyphs)
 *  For now, body and equation are rendered as plain text. The structure
 *  is correct; the mixed-content parsing is added later without changing it.
 *
 * ============================================================================
 */
import { renderMixedContent } from './objects-in-prose.js';
/**
 * Builds the prose column from scene.steps and appends it to `container`.
 * Clears any existing content first (removes hard-coded placeholder HTML).
 *
 * Each step becomes one .step div — a full-viewport-height scroll section
 * styled by the page CSS. The CSS stays in the HTML; this module creates
 * the elements and sets the text.
 */
export function renderProse(scene, container) {
    container.innerHTML = '';
    for (const step of scene.steps) {
        const div = document.createElement('div');
        div.className = 'step';
        div.id = step.id;
        if (step.label) {
            const el = document.createElement('div');
            el.className = 'step-label';
            el.textContent = step.label;
            div.appendChild(el);
        }
        if (step.heading) {
            const el = document.createElement('h2');
            el.appendChild(renderMixedContent(step.heading, scene));
            div.appendChild(el);
        }
        if (step.body) {
            const el = document.createElement('p');
            el.appendChild(renderMixedContent(step.body, scene));
            div.appendChild(el);
        }
        if (step.equation) {
            const el = document.createElement('p');
            el.className = 'step-equation';
            el.appendChild(renderMixedContent(step.equation, scene));
            div.appendChild(el);
        }
        container.appendChild(div);
    }
    fitEquations(container);
    // Re-fit when the column width changes, and once web fonts finish loading
    // (font swap changes text width). Passive listener per project convention.
    window.addEventListener('resize', () => fitEquations(container), { passive: true });
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => fitEquations(container));
    }
}
/**
 * Fit-to-width for equation lines. Each `.step-equation` is laid out on a single
 * line (CSS `white-space: nowrap`) at its base "4K" size, then scaled DOWN
 * uniformly if it would overrun its column — so a formula that fits on one line
 * on a large screen fits on one line at every resolution, just smaller. It never
 * scales UP past the base, so wide screens keep the intended size and crispness.
 */
export function fitEquations(container) {
    const eqs = container.querySelectorAll('.step-equation');
    eqs.forEach((eq) => {
        eq.style.fontSize = ''; // reset to the CSS base first
        const avail = eq.clientWidth; // content-box width of the column
        const natural = eq.scrollWidth; // one-line width at base size
        if (avail > 0 && natural > avail) {
            const base = parseFloat(getComputedStyle(eq).fontSize);
            eq.style.fontSize = `${base * (avail / natural) * 0.98}px`; // 2% safety margin
        }
    });
}
