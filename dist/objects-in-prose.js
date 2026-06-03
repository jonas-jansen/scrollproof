/**
 * ============================================================================
 *  ScrollProof — Objects in Prose (v1)
 * ============================================================================
 *
 *  Parses mixed-content strings from scene.steps and produces DOM nodes.
 *  Three token kinds are recognised inside body and equation fields:
 *
 *    {obj:id}    → inline SVG glyph of the named scene object (or object group)
 *    $src$       → KaTeX-rendered inline math
 *    {em:text}   → emphasised <em> (styled Fraunces italic gold via CSS)
 *
 *  Everything else is plain text.
 *
 *  {obj:id} finds ALL scene objects whose id equals "id" OR starts with
 *  "id_" — so AngleMark parts ("arc1_0", "arc1_1", "arc1") are rendered
 *  together as a single combined glyph when {obj:arc1} is written.
 *
 * ============================================================================
 */
import { pathToD } from './renderer.js';
// ── Tuning ────────────────────────────────────────────────────────────────────
const GLYPH_HEIGHT_EM = 1.2;
function parseSegments(str) {
    const out = [];
    const re = /\{obj:([^}]+)\}|\$([^$]+)\$|\{em:([^}]+)\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(str)) !== null) {
        if (m.index > last)
            out.push({ kind: 'text', text: str.slice(last, m.index) });
        if (m[1] !== undefined)
            out.push({ kind: 'obj', id: m[1].trim() });
        else if (m[2] !== undefined)
            out.push({ kind: 'math', src: m[2] });
        else
            out.push({ kind: 'em', text: m[3] });
        last = m.index + m[0].length;
    }
    if (last < str.length)
        out.push({ kind: 'text', text: str.slice(last) });
    return out;
}
// ── Glyph renderer ────────────────────────────────────────────────────────────
const SVG_NS = 'http://www.w3.org/2000/svg';
function pathBBox(path) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const seg of path) {
        for (const [x, y] of seg) {
            if (x < minX)
                minX = x;
            if (x > maxX)
                maxX = x;
            if (y < minY)
                minY = y;
            if (y > maxY)
                maxY = y;
        }
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
/** Adds a single <path> element for one PathObject to the given SVG. */
function addPathToSVG(svg, obj) {
    const pathEl = document.createElementNS(SVG_NS, 'path');
    pathEl.setAttribute('d', pathToD(obj.path));
    const s = obj.style ?? {};
    pathEl.setAttribute('fill', s.fill ?? 'none');
    if (s.fillOpacity !== undefined)
        pathEl.setAttribute('fill-opacity', String(s.fillOpacity));
    if (s.stroke) {
        pathEl.setAttribute('stroke', s.stroke);
        pathEl.setAttribute('stroke-width', '1');
        pathEl.setAttribute('vector-effect', 'non-scaling-stroke');
    }
    svg.appendChild(pathEl);
}
/**
 * Renders one or more PathObjects as a single inline SVG glyph.
 * Height is GLYPH_HEIGHT_EM; width is proportional to the combined aspect ratio.
 * Objects are drawn in scene order so outlines naturally appear on top of fills.
 */
function makeGlyphGroup(objs) {
    // Combined bounding box across all objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of objs) {
        const b = pathBBox(obj.path);
        if (b.x < minX)
            minX = b.x;
        if (b.y < minY)
            minY = b.y;
        if (b.x + b.w > maxX)
            maxX = b.x + b.w;
        if (b.y + b.h > maxY)
            maxY = b.y + b.h;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const aspect = h > 0 ? w / h : 1;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.height = `${GLYPH_HEIGHT_EM}em`;
    svg.style.width = `${GLYPH_HEIGHT_EM * aspect}em`;
    svg.style.verticalAlign = 'middle';
    svg.style.display = 'inline-block';
    svg.style.flexShrink = '0';
    for (const obj of objs)
        addPathToSVG(svg, obj);
    return svg;
}
// ── Public API ────────────────────────────────────────────────────────────────
export function renderMixedContent(str, scene) {
    const frag = document.createDocumentFragment();
    for (const seg of parseSegments(str)) {
        if (seg.kind === 'text') {
            frag.appendChild(document.createTextNode(seg.text));
        }
        else if (seg.kind === 'obj') {
            // Find all objects whose id exactly matches OR starts with "id_"
            // (the second form collects AngleMark colored sub-sectors like arc1_0, arc1_1)
            const prefix = seg.id + '_';
            const objs = scene.objects.filter((o) => 'path' in o && (o.id === seg.id || o.id.startsWith(prefix)));
            if (objs.length > 0) {
                frag.appendChild(makeGlyphGroup(objs));
            }
            else {
                frag.appendChild(document.createTextNode(`{obj:${seg.id}?}`));
            }
        }
        else if (seg.kind === 'em') {
            const em = document.createElement('em');
            em.textContent = seg.text;
            frag.appendChild(em);
        }
        else {
            if (window.katex) {
                const span = document.createElement('span');
                span.innerHTML = window.katex.renderToString(seg.src, { throwOnError: false });
                frag.appendChild(span);
            }
            else {
                frag.appendChild(document.createTextNode(`$${seg.src}$`));
            }
        }
    }
    return frag;
}
