/**
 * ============================================================================
 *  ScrollProof — Interpolation Core (v1)
 * ============================================================================
 *
 *  WHAT THIS FILE IS
 *  -----------------
 *  Pure functions that answer: "at scroll progress p, what is the current
 *  value of each animated property of each object?" No DOM access, no SVG,
 *  no browser. Fully testable in Node.
 *
 *  This is module 2 in the build order. It consumes the types from
 *  scene-types.ts and produces computed values; the renderer (module 3)
 *  takes those values and writes SVG.
 *
 *  HOW TO READ IT
 *  --------------
 *  Bottom-up, like scene-types.ts:
 *    applyEase  →  (bracket finder)  →  (interpolateTrack)  →  seek
 *  Each function is explained with a plain-language comment before the code.
 *
 * ============================================================================
 */
/* ============================================================
 *  PIECE 1 — THE EASE FUNCTION
 * ============================================================
 *
 *  Every animation segment between two keyframes has a shape: linear,
 *  ease-in, ease-out, ease-in-out, or a custom cubic-Bézier curve.
 *  The ease function maps a raw 0..1 progress (local) to a warped 0..1
 *  progress (t). The renderer then uses t to blend values.
 *
 *  All four named eases and custom eases are cubic Bézier curves in the
 *  unit square: from (0,0) to (1,1) with two handles (x1,y1) and (x2,y2).
 *  The x-axis is local progress; the y-axis is eased progress.
 *
 *  Named ease control points match the CSS standard:
 *    linear  — handles at (0,0) and (1,1): a straight diagonal, no warp.
 *    in      — slow start, fast finish.
 *    out     — fast start, slow finish.
 *    inout   — slow start, fast middle, slow finish (an S-curve).
 * ============================================================ */
/** Control-point pairs for each named ease, matching CSS conventions. */
const EASE_PRESETS = {
    linear: [0, 0, 1, 1],
    in: [0.42, 0, 1, 1],
    out: [0, 0, 0.58, 1],
    inout: [0.42, 0, 0.58, 1],
};
/**
 * Evaluates a cubic-Bézier ease curve.
 *
 * The curve lives in the unit square: it starts at (0,0) and ends at (1,1),
 * shaped by two handles: (x1,y1) and (x2,y2). Given an x value (= local
 * progress), we want the y value (= eased progress).
 *
 * Step 1 — find the curve parameter t whose x-coordinate matches x.
 *   The x-coordinate formula for a cubic Bézier with endpoints fixed at 0
 *   and 1 and handles x1,x2 is:
 *     cx(t) = 3·x1·t·(1−t)² + 3·x2·t²·(1−t) + t³
 *   We use binary search: bracket t in [lo, hi], evaluate cx(midpoint),
 *   move lo or hi to narrow the range. 30 iterations give sub-pixel precision.
 *
 * Step 2 — evaluate the y-coordinate at that t (same formula, y handles).
 *   cy(t) = 3·y1·t·(1−t)² + 3·y2·t²·(1−t) + t³
 */
function evaluateCubicBezier(x1, y1, x2, y2, x) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const cx = 3 * x1 * mid * (1 - mid) ** 2
            + 3 * x2 * mid ** 2 * (1 - mid)
            + mid ** 3;
        if (cx < x)
            lo = mid;
        else
            hi = mid;
    }
    const t = (lo + hi) / 2;
    return 3 * y1 * t * (1 - t) ** 2
        + 3 * y2 * t ** 2 * (1 - t)
        + t ** 3;
}
/**
 * Maps a raw local progress (0..1) through an ease curve, returning a
 * warped t (0..1) for blending.
 *
 * `ease` is either one of the four named strings or a custom
 * [x1, y1, x2, y2] array (spec §4.1). The linear case is shortcut
 * (no solver needed): t = local.
 *
 * This is the ONLY place in the engine that knows about easing curves.
 * Everything else just calls applyEase(ease, local) and uses the result.
 */
export function applyEase(ease, local) {
    const [x1, y1, x2, y2] = typeof ease === 'string' ? EASE_PRESETS[ease] : ease;
    // Linear shortcut: handles form a straight diagonal → no warping needed.
    if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1)
        return local;
    return evaluateCubicBezier(x1, y1, x2, y2, local);
}
/**
 * The ease to use when neither the target nor the keyframe specifies one.
 * "inout" feels natural for most scroll-driven motion.
 */
const DEFAULT_EASE = 'inout';
/**
 * Unpacks a Target into a plain value and an ease.
 *
 * Recall the two Target forms (spec §4.1):
 *   shorthand:  morph: 0             — bare value, no explicit ease
 *   longhand:   fillOpacity: { to: 0.24, ease: "out" }
 *
 * The ease resolution order (highest priority first):
 *   1. Per-target ease, in the longhand form.
 *   2. The keyframe's own `ease` field (a default for all its targets).
 *   3. DEFAULT_EASE ("inout").
 *
 * `keyframeEase` is whatever the containing Keyframe declared (may be
 * undefined if the keyframe has no ease field).
 */
function resolveTarget(target, keyframeEase) {
    const fallback = keyframeEase ?? DEFAULT_EASE;
    // Bare number shorthand: e.g. `morph: 0`
    if (typeof target === 'number')
        return { value: target, ease: fallback };
    // Bare string shorthand: colour snap — e.g. `fill: "#e0a73c"`
    if (typeof target === 'string')
        return { value: target, ease: fallback };
    // Bare Point shorthand: e.g. `rotateCenter: [200, 100]`
    if (Array.isArray(target))
        return { value: target, ease: fallback };
    // Longhand: { to: ..., ease?: ... }
    // The per-target ease (if present) overrides the keyframe-level fallback.
    return { value: target.to, ease: target.ease ?? fallback };
}
/**
 * Builds the track for one property of one object: collects every keyframe
 * that sets `objectId[prop]`, resolves each entry, and returns them sorted
 * by `at`. (The spec requires keyframes to be pre-sorted, but we sort
 * defensively in case the JSON is not perfectly ordered.)
 *
 * Returns an empty array if no keyframe ever sets this property — the
 * caller then falls back to the object's `props` default or the spec table
 * default.
 */
function buildTrack(keyframes, objectId, prop) {
    const entries = [];
    for (const kf of keyframes) {
        const objSet = kf.set[objectId];
        if (objSet === undefined)
            continue;
        const target = objSet[prop];
        if (target === undefined)
            continue;
        const { value, ease } = resolveTarget(target, kf.ease);
        entries.push({ at: kf.at, value, ease });
    }
    entries.sort((a, b) => a.at - b.at);
    return entries;
}
/** Linear interpolation between two numbers. */
function lerpNumber(a, b, t) {
    return a + (b - a) * t;
}
/** Linear interpolation between two Points (lerps each coordinate). */
function lerpPoint(a, b, t) {
    return [lerpNumber(a[0], b[0], t), lerpNumber(a[1], b[1], t)];
}
/**
 * Parses a 6-character hex color string ("#e0a73c") into [r, g, b] numbers
 * in the range 0–255. Returns null for anything that isn't a 6-char hex —
 * e.g. CSS variables like "var(--gold)" or 3-char shorthand.
 */
function parseHex(color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color))
        return null;
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
/**
 * Formats three 0–255 channel values back into a lowercase hex string.
 * Math.round keeps channels on integer values; clamping prevents overflow
 * from floating-point imprecision near the ends.
 */
function formatHex(r, g, b) {
    const clamp = (v) => Math.min(255, Math.max(0, Math.round(v)));
    return '#' + [r, g, b].map(c => clamp(c).toString(16).padStart(2, '0')).join('');
}
/**
 * Blends two color strings at mix t (0 = all a, 1 = all b).
 * Interpolates in RGB — each channel lerped independently.
 * Falls back to snapping (returns b past t=0.5) if either color
 * cannot be parsed as 6-char hex.
 */
function lerpColor(a, b, t) {
    const ca = parseHex(a), cb = parseHex(b);
    if (!ca || !cb)
        return t >= 0.5 ? b : a;
    return formatHex(lerpNumber(ca[0], cb[0], t), lerpNumber(ca[1], cb[1], t), lerpNumber(ca[2], cb[2], t));
}
/**
 * Returns the interpolated value for a property at scroll progress `p`,
 * given its track.
 *
 * Returns undefined when the track is empty: the caller should then use
 * the object's `props` initial value, or the spec-table default.
 *
 * Interpolation rules (spec §4.2):
 *   - p ≤ first entry's at  → hold at first value (no extrapolation)
 *   - p ≥ last entry's at   → hold at last value
 *   - otherwise             → find bracketing entries A (before) and B
 *     (after), compute local progress within that segment, apply B's ease
 *     (ease attaches to the INCOMING segment — how we arrive at B), blend.
 *
 * Color targets (fill, stroke) cannot be blended without hex parsing;
 * until piece 3 adds that, they snap to B's value past the midpoint.
 */
export function interpolateTrack(track, p) {
    if (track.length === 0)
        return undefined;
    if (p <= track[0].at)
        return track[0].value;
    if (p >= track[track.length - 1].at)
        return track[track.length - 1].value;
    // Find the bracketing pair: A is the last entry with at ≤ p, B is next.
    let A = track[0];
    let B = track[1];
    for (let i = 1; i < track.length; i++) {
        if (track[i].at >= p) {
            A = track[i - 1];
            B = track[i];
            break;
        }
    }
    const local = (p - A.at) / (B.at - A.at);
    const t = applyEase(B.ease, local); // B's ease: how we arrive at B
    if (typeof A.value === 'number' && typeof B.value === 'number') {
        return lerpNumber(A.value, B.value, t);
    }
    if (Array.isArray(A.value) && Array.isArray(B.value)) {
        return lerpPoint(A.value, B.value, t);
    }
    // Color strings: lerp in RGB if both are 6-char hex; snap otherwise.
    return lerpColor(String(A.value), String(B.value), t);
}
/** Spec-table defaults for numeric props (spec §2, animatable property table).
 *
 * fillOpacity and strokeWidth are intentionally absent: they behave like the
 * colour props (fill, stroke) — they only override the static style when
 * explicitly set in the timeline or props. Leaving them here would cause the
 * spec default (1 / 0) to overwrite every static style value every frame.
 */
const NUMERIC_DEFAULTS = {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    rotate: 0,
    morph: 0,
    draw: 1, // fully drawn unless a keyframe/props says otherwise
};
/**
 * Given a scene and a scroll progress p (0..1), returns the current
 * resolved state of every object.
 *
 * For each object and each animatable property, the result comes from
 * whichever source has an answer (timeline first, then props, then default).
 */
export function seek(scene, p) {
    const computed = {};
    for (const obj of scene.objects) {
        // `props` lives on PathObject, LabelObject, and Group — all use the same
        // field name but with different allowed keys. We read it generically.
        const initialProps = obj.props ?? {};
        /**
         * Resolves one property: timeline → initial props → default.
         * Returns undefined only for optional props with no default (colors,
         * transform centers).
         */
        function resolve(prop) {
            const track = buildTrack(scene.timeline, obj.id, prop);
            const fromTimeline = interpolateTrack(track, p);
            if (fromTimeline !== undefined)
                return fromTimeline;
            const fromProps = initialProps[prop];
            if (fromProps !== undefined)
                return fromProps;
            return NUMERIC_DEFAULTS[prop]; // undefined if not in table (colors, centers)
        }
        function resolveNum(prop) {
            return resolve(prop) ?? NUMERIC_DEFAULTS[prop];
        }
        // Like resolveNum but returns undefined when neither timeline nor props
        // set the value — used for props whose static style should not be overridden.
        function resolveOptionalNum(prop) {
            const track = buildTrack(scene.timeline, obj.id, prop);
            const fromTimeline = interpolateTrack(track, p);
            if (fromTimeline !== undefined)
                return fromTimeline;
            const fromProps = initialProps[prop];
            if (fromProps !== undefined)
                return fromProps;
            return undefined;
        }
        function resolveColor(prop) {
            const v = resolve(prop);
            return typeof v === 'string' ? v : undefined;
        }
        function resolvePoint(prop) {
            const v = resolve(prop);
            return Array.isArray(v) ? v : undefined;
        }
        computed[obj.id] = {
            opacity: resolveNum('opacity'),
            x: resolveNum('x'),
            y: resolveNum('y'),
            scale: resolveNum('scale'),
            rotate: resolveNum('rotate'),
            rotateCenter: resolvePoint('rotateCenter'),
            scaleCenter: resolvePoint('scaleCenter'),
            morph: resolveNum('morph'),
            draw: resolveNum('draw'),
            fill: resolveColor('fill'),
            fillOpacity: resolveOptionalNum('fillOpacity'),
            stroke: resolveColor('stroke'),
            strokeWidth: resolveOptionalNum('strokeWidth'),
        };
    }
    return computed;
}
