/**
 * ============================================================================
 *  ScrollProof — Renderer (v1, minimal)
 * ============================================================================
 *
 *  WHAT THIS FILE IS
 *  -----------------
 *  The module that turns computed values into visible SVG. It has two phases:
 *
 *    setup(scene, svgElement)   — called ONCE; creates SVG elements.
 *    update(scene, computed)    — called EVERY FRAME; updates attributes.
 *
 *  The scroll driver (a later module) calls seek() then update() on each
 *  scroll event. This module never touches the timeline or scroll position —
 *  it only reads what seek() has already resolved.
 *
 *  Groups are deferred in this minimal version: members are drawn with their
 *  own transform only (no group transform composed on top). One proof first.
 *
 *  HOW TO READ IT
 *  --------------
 *  Bottom-up:
 *    pathToD  →  blendPath  →  buildTransform  →  setup  →  update
 *
 * ============================================================================
 */
/* ============================================================
 *  PIECE 1 — pathToD: geometry → SVG path string
 * ============================================================
 *
 *  SVG draws shapes via the `d` attribute: a compact string of
 *  commands. We use two:
 *    M x y          — move the pen to (x, y); starts the path
 *    C x1 y1 x2 y2 x y  — cubic Bézier to (x, y) with handles
 *    Z              — close path (line back to the M point)
 *
 *  Our BezierSegment is [start, handle1, handle2, end].
 *  The first segment contributes M + C; each later segment adds C.
 *  All geometric proofs are closed shapes, so we always append Z.
 * ============================================================ */
/** Squared-distance threshold for treating two points as the same.
 *  Used both for subpath-break detection and for closing a contour. */
const JOIN_EPS2 = 1e-8;
/**
 * Converts a Path (our array of BezierSegments) into an SVG `d` string.
 * Numbers are rounded to 4 decimal places — enough precision for a
 * 400×400 canvas without bloating the attribute string.
 *
 * Multi-subpath aware: segments are normally chained (each begins where the
 * last ended), but a trimmed path can contain DISCONNECTED segments — e.g.
 * "simultaneous" draw mode reveals every edge as a separate growing stub.
 * Whenever a segment's start does not coincide with the previous segment's
 * end, a fresh `M` begins a new subpath.
 *
 * Closing (`Z`) happens only for a SINGLE continuous contour whose final point
 * returns to its start. A path broken into several subpaths is never closed
 * (it is mid-draw), and an open contour (line, arc) is never closed.
 */
export function pathToD(path) {
    if (path.length === 0)
        return '';
    const r = (n) => Math.round(n * 10000) / 10000;
    const parts = [];
    let prevEnd = null;
    let breaks = 0;
    for (const [start, h1, h2, end] of path) {
        const disconnected = prevEnd === null ||
            (start[0] - prevEnd[0]) ** 2 + (start[1] - prevEnd[1]) ** 2 > JOIN_EPS2;
        if (disconnected) {
            if (prevEnd !== null)
                breaks++; // a genuine new subpath (not the first)
            parts.push(`M ${r(start[0])} ${r(start[1])}`);
        }
        parts.push(`C ${r(h1[0])} ${r(h1[1])} ${r(h2[0])} ${r(h2[1])} ${r(end[0])} ${r(end[1])}`);
        prevEnd = end;
    }
    // Close only a single continuous contour that returns to its start point.
    if (breaks === 0 && prevEnd) {
        const start = path[0][0];
        const dx = prevEnd[0] - start[0];
        const dy = prevEnd[1] - start[1];
        if (dx * dx + dy * dy < JOIN_EPS2)
            parts.push('Z');
    }
    return parts.join(' ');
}
/* ============================================================
 *  PIECE 2 — blendPath: applying the morph value
 * ============================================================
 *
 *  `morph` (0..1) blends path → pathB by lerping every control
 *  point coordinate pairwise. The interpolation core computes the
 *  morph number; the renderer applies it to the actual geometry.
 *
 *  path and pathB must have the same segment count — enforced by
 *  the authoring library at compile time (spec §2).
 * ============================================================ */
/** Linear interpolation — defined locally so the renderer has no
 *  dependency on interpolation-core's internal helpers. */
function lerp(a, b, t) {
    return a + (b - a) * t;
}
/**
 * Returns the blended path at the given morph value.
 * If pathB is absent or morph is 0, returns path unchanged.
 * Otherwise lerps each control point coordinate toward pathB.
 */
export function blendPath(path, pathB, morph) {
    if (!pathB || morph === 0)
        return path;
    return path.map((seg, si) => seg.map((pt, pi) => [
        lerp(pt[0], pathB[si][pi][0], morph),
        lerp(pt[1], pathB[si][pi][1], morph),
    ]));
}
/* ============================================================
 *  PIECE 2b — trimPath: the "pen drawing" reveal
 * ============================================================
 *
 *  Returns the portion of a path visible at draw progress `draw`
 *  (0 = nothing, 1 = whole path). Two modes:
 *
 *    "sequential"   — one pen tracing start → finish, at constant
 *                     speed (arc-length parameterised). Whole leading
 *                     segments plus one partially-cut segment.
 *    "simultaneous" — every segment reveals together: each cubic is
 *                     truncated to the same parameter t = draw. The
 *                     segments are disconnected stubs until draw = 1
 *                     (pathToD renders them as separate subpaths).
 *
 *  Pure geometry: de Casteljau subdivision is exact; arc length is
 *  numerically estimated (cubic arc length has no closed form).
 * ============================================================ */
/** Linear interpolation between two points. */
function lerpPt(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}
/**
 * de Casteljau split: returns the LEFT sub-curve of a cubic over [0, t].
 * Exact — the control points of the [0,t] portion are derived directly.
 */
function splitCubicLeft(seg, t) {
    const [p0, p1, p2, p3] = seg;
    const a = lerpPt(p0, p1, t);
    const b = lerpPt(p1, p2, t);
    const c = lerpPt(p2, p3, t);
    const d = lerpPt(a, b, t);
    const e = lerpPt(b, c, t);
    const f = lerpPt(d, e, t); // the point on the curve at parameter t
    return [p0, a, d, f];
}
/** Number of chord samples used to estimate one segment's arc length. */
const LENGTH_SAMPLES = 16;
/** Evaluates a cubic at parameter t (de Casteljau, point only). */
function cubicAt(seg, t) {
    const [p0, p1, p2, p3] = seg;
    const a = lerpPt(p0, p1, t);
    const b = lerpPt(p1, p2, t);
    const c = lerpPt(p2, p3, t);
    const d = lerpPt(a, b, t);
    const e = lerpPt(b, c, t);
    return lerpPt(d, e, t);
}
/**
 * Cumulative arc-length table for one segment: ts[i] paired with the
 * length from t=0 up to ts[i]. ts spans [0,1] in LENGTH_SAMPLES steps.
 */
function lengthTable(seg) {
    const ts = [0];
    const lens = [0];
    let prev = cubicAt(seg, 0);
    let acc = 0;
    for (let i = 1; i <= LENGTH_SAMPLES; i++) {
        const t = i / LENGTH_SAMPLES;
        const pt = cubicAt(seg, t);
        acc += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
        ts.push(t);
        lens.push(acc);
        prev = pt;
    }
    return { ts, lens };
}
/** Inverts a length table: the parameter t at which cumulative length
 *  reaches `target`, by linear interpolation between samples. */
function tForLength(table, target) {
    const { ts, lens } = table;
    const total = lens[lens.length - 1];
    if (target <= 0)
        return 0;
    if (target >= total)
        return 1;
    for (let i = 1; i < lens.length; i++) {
        if (lens[i] >= target) {
            const span = lens[i] - lens[i - 1];
            const f = span > 0 ? (target - lens[i - 1]) / span : 0;
            return lerp(ts[i - 1], ts[i], f);
        }
    }
    return 1;
}
/**
 * Returns the visible portion of `path` at draw progress `draw`.
 * draw ≤ 0 → empty; draw ≥ 1 → the whole path unchanged.
 */
export function trimPath(path, draw, mode) {
    if (draw >= 1 || path.length === 0)
        return path;
    if (draw <= 0)
        return [];
    if (mode === 'simultaneous') {
        // Every segment cut to the same parameter — disconnected stubs.
        return path.map(seg => splitCubicLeft(seg, draw));
    }
    // sequential: walk arc length, include whole segments then one partial.
    const tables = path.map(lengthTable);
    const total = tables.reduce((s, t) => s + t.lens[t.lens.length - 1], 0);
    const target = draw * total;
    const out = [];
    let acc = 0;
    for (let i = 0; i < path.length; i++) {
        const segLen = tables[i].lens[tables[i].lens.length - 1];
        if (acc + segLen <= target) {
            out.push(path[i]); // whole segment fits
            acc += segLen;
        }
        else {
            const localT = tForLength(tables[i], target - acc);
            out.push(splitCubicLeft(path[i], localT)); // partial final segment
            break;
        }
    }
    return out;
}
/* ============================================================
 *  PIECE 3 — buildTransform: animated props → SVG transform
 * ============================================================
 *
 *  SVG `transform` is a string of space-separated operations applied
 *  left-to-right. We use:
 *    translate(x, y)              — shift the whole object
 *    rotate(deg, cx, cy)          — SVG handles the center natively
 *    translate(cx,cy) scale(s) translate(-cx,-cy)  — scale about a point
 *
 *  When rotateCenter or scaleCenter were not set in the scene, the
 *  renderer falls back to a rough centroid: the average of all segment
 *  start points. Good enough for convex shapes (triangles, squares, arcs).
 * ============================================================ */
/**
 * Approximate centroid of a path: average of all segment start points.
 * Used when rotateCenter or scaleCenter is absent from ComputedProps.
 */
function centroidOf(path) {
    const pts = path.map(seg => seg[0]);
    const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [x, y];
}
/**
 * Builds the SVG `transform` attribute string for one object.
 * `path` is the (already blended) geometry, used only if a center
 * needs to be computed from the centroid.
 *
 * Operations are applied in this order:
 *   1. translate(x, y)
 *   2. rotate about rotateCenter
 *   3. scale about scaleCenter
 * An identity value (x=0, y=0, rotate=0, scale=1) produces an
 * empty string — no unnecessary `transform` attribute on the element.
 */
export function buildTransform(props, path) {
    const ops = [];
    const r = (n) => Math.round(n * 10000) / 10000;
    if (props.x !== 0 || props.y !== 0) {
        ops.push(`translate(${r(props.x)} ${r(props.y)})`);
    }
    if (props.rotate !== 0) {
        const [cx, cy] = props.rotateCenter ?? centroidOf(path);
        ops.push(`rotate(${r(props.rotate)} ${r(cx)} ${r(cy)})`);
    }
    if (props.scale !== 1) {
        const [cx, cy] = props.scaleCenter ?? centroidOf(path);
        ops.push(`translate(${r(cx)} ${r(cy)}) scale(${r(props.scale)}) translate(${r(-cx)} ${r(-cy)})`);
    }
    return ops.join(' ');
}
/**
 * Sorts objects by their `layer` field (lower draws first = behind).
 * Objects without a `layer` keep their position in the array (stable sort).
 */
function sortedByLayer(scene) {
    return [...scene.objects].sort((a, b) => {
        const la = a.layer ?? Infinity;
        const lb = b.layer ?? Infinity;
        return la - lb;
    });
}
/** Creates an SVG element in the SVG namespace — required for SVG elements
 *  to render correctly in the browser (plain createElement does not work). */
function svgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
}
/**
 * Creates the SVG structure for a scene. Call once on page load.
 * Returns an ElementMap so `update` can find each element by id.
 *
 * Applies static style (fill, stroke, strokeWidth) at setup time —
 * these are the non-animated defaults from each object's `style` field.
 * Animated overrides are applied by `update` each frame on top.
 */
export function setup(scene, svg) {
    const map = new Map();
    svg.setAttribute('viewBox', `0 0 ${scene.canvas.width} ${scene.canvas.height}`);
    for (const obj of sortedByLayer(scene)) {
        if ('members' in obj)
            continue; // groups deferred
        if ('path' in obj) {
            // PathObject → <g> with a fill child (under) and a stroke child (over).
            const group = svgEl('g');
            const fill = svgEl('path');
            const stroke = svgEl('path');
            // Fill child: full closed geometry. Never strokes.
            // Default fill to "none" — SVG's default is black, but spec §style says absent = no fill.
            fill.setAttribute('fill', obj.style?.fill ?? 'none');
            fill.setAttribute('stroke', 'none');
            if (obj.style?.fillOpacity !== undefined)
                fill.setAttribute('fill-opacity', String(obj.style.fillOpacity));
            // Stroke child: the (possibly trimmed) outline. Never fills.
            stroke.setAttribute('fill', 'none');
            if (obj.style?.stroke)
                stroke.setAttribute('stroke', obj.style.stroke);
            if (obj.style?.strokeWidth)
                stroke.setAttribute('stroke-width', String(obj.style.strokeWidth));
            group.appendChild(fill);
            group.appendChild(stroke);
            svg.appendChild(group);
            map.set(obj.id, { kind: 'path', group, fill, stroke });
        }
        else {
            // LabelObject → <text>
            const el = svgEl('text');
            el.setAttribute('x', String(obj.label.anchor[0]));
            el.setAttribute('y', String(obj.label.anchor[1]));
            el.setAttribute('text-anchor', 'middle');
            el.textContent = obj.label.text;
            if (obj.style?.fill)
                el.setAttribute('fill', obj.style.fill);
            if (obj.style?.stroke)
                el.setAttribute('stroke', obj.style.stroke);
            if (obj.style?.size)
                el.setAttribute('font-size', String(obj.style.size));
            if (obj.style?.family)
                el.setAttribute('font-family', obj.style.family);
            svg.appendChild(el);
            map.set(obj.id, { kind: 'label', el });
        }
    }
    return map;
}
/**
 * Updates all element attributes from a computed scene. Call every frame.
 * `scene` is needed to access each object's path geometry for morph blending.
 */
export function update(scene, computed, elements) {
    for (const obj of scene.objects) {
        if ('members' in obj)
            continue; // groups deferred
        const entry = elements.get(obj.id);
        if (!entry)
            continue;
        const props = computed[obj.id];
        if (!props)
            continue;
        if (entry.kind === 'path' && 'path' in obj) {
            const { group, fill, stroke } = entry;
            // Opacity and transform live on the wrapping <g>.
            group.setAttribute('opacity', String(props.opacity));
            // Blend path → pathB using the morph value → the full geometry.
            const blended = blendPath(obj.path, obj.pathB, props.morph);
            const fullD = pathToD(blended);
            // Fill child always shows the full closed geometry.
            fill.setAttribute('d', fullD);
            if (props.fill !== undefined)
                fill.setAttribute('fill', props.fill);
            if (props.fillOpacity !== undefined)
                fill.setAttribute('fill-opacity', String(props.fillOpacity));
            // Stroke child shows the trimmed "pen-draw" portion.
            const mode = obj.drawMode ?? 'sequential';
            const drawn = trimPath(blended, props.draw, mode);
            stroke.setAttribute('d', pathToD(drawn));
            if (props.stroke !== undefined)
                stroke.setAttribute('stroke', props.stroke);
            if (props.strokeWidth !== undefined)
                stroke.setAttribute('stroke-width', String(props.strokeWidth));
            const transform = buildTransform(props, blended);
            if (transform)
                group.setAttribute('transform', transform);
            else
                group.removeAttribute('transform');
        }
        else if (entry.kind === 'label') {
            const { el } = entry;
            el.setAttribute('opacity', String(props.opacity));
            // Translate its anchor by x/y; other transforms via `transform`.
            const transform = buildTransform(props, []);
            if (transform)
                el.setAttribute('transform', transform);
            else
                el.removeAttribute('transform');
        }
    }
}
