/**
 * ============================================================================
 *  ScrollProof — Mapping Layer
 * ============================================================================
 *
 *  Bridges figure-space (the 400×400 coordinate grid in the JSON) and
 *  page-space (CSS pixel coordinates in the document).
 *
 *  The only public call is:
 *    const map = createMapping(svgElement);
 *
 *  After that, two methods are available:
 *    map.figureToPage(point)  →  { x, y } in page pixels
 *    map.pageToFigure(x, y)   →  [fx, fy] in figure units
 *
 *  The mapping is backed by svg.getScreenCTM(), which is the authoritative
 *  browser transform matrix from SVG user units to viewport pixels.
 *  It is cached and refreshed automatically on resize.
 *
 * ============================================================================
 */
function readMatrix(svg) {
    const m = svg.getScreenCTM();
    if (!m)
        throw new Error('getScreenCTM() returned null — SVG must be in the DOM before createMapping() is called');
    const det = m.a * m.d - m.b * m.c;
    if (det === 0)
        throw new Error('SVG transform matrix is singular — viewBox or CSS may be degenerate');
    return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f, invDet: 1 / det };
}
/**
 * Creates a mapping between figure-space and page-space.
 * Registers a resize listener and refreshes the cached matrix automatically.
 * Call once on page load, after setup() has placed the SVG in the DOM.
 */
export function createMapping(svg) {
    let m = readMatrix(svg);
    window.addEventListener('resize', () => { m = readMatrix(svg); }, { passive: true });
    return {
        /**
         * Converts a figure-space point to CSS pixel coordinates in the page.
         * Add window.scrollX/Y because the SVG is position:fixed (its viewport
         * position is constant), but objects-in-prose live in the scrolling doc.
         */
        figureToPage(point) {
            return {
                x: m.a * point[0] + m.c * point[1] + m.e + window.scrollX,
                y: m.b * point[0] + m.d * point[1] + m.f + window.scrollY,
            };
        },
        /**
         * Converts a page pixel position to figure-space coordinates.
         * Subtracts scroll to get viewport coords, then applies the inverse matrix.
         *
         * Inverse derivation (affine 2D):
         *   fx = (d*(vx-e) - c*(vy-f)) / det
         *   fy = (a*(vy-f) - b*(vx-e)) / det
         */
        pageToFigure(x, y) {
            const vx = x - window.scrollX;
            const vy = y - window.scrollY;
            const dx = vx - m.e;
            const dy = vy - m.f;
            return [
                m.invDet * (m.d * dx - m.c * dy),
                m.invDet * (m.a * dy - m.b * dx),
            ];
        },
    };
}
