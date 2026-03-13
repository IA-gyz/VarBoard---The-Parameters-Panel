/**
 * VarBoard — ComfyUI live variable dashboard
 *
 * This file is the sole frontend entry-point for the VarBoard extension.
 * It registers one purely-frontend LiteGraph node (VB_Panel) and five
 * backend-backed variable nodes (VB_Int, VB_Float, VB_String, VB_Seed, VB_Bool).
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * VB_Panel is a regular backend node (registered in nodes.py) with no inputs
 * and no outputs.  Its execute() is a no-op; it exists purely as a canvas anchor.  When it is placed on the canvas,
 * VBNodeMixin methods (mixed in via beforeRegisterNodeDef) create a DOMPanel
 * instance that renders a floating HTML overlay on top of the canvas.
 *
 * The DOMPanel is event-driven rather than polling:
 *   1. A lightweight requestAnimationFrame loop repositions the panel to follow
 *      the anchor node's canvas position, applying CSS transform:scale() so the
 *      panel zooms with the canvas.  Position tracking is the only work done
 *      each frame; no value or structure diffing occurs here.
 *   2. Graph structural changes (node added/removed, connection changed) are
 *      detected via LiteGraph graph hooks installed in setup() and dispatched
 *      through a module-level registry (_vbPanelRegistry) to every live panel,
 *      which responds with a full _render().
 *   3. Widget value changes on VB variable nodes are detected via the
 *      onWidgetChanged prototype override installed in beforeRegisterNodeDef()
 *      and dispatched through the same registry, triggering a lightweight
 *      _updateInputsInPlace() instead of a full DOM rebuild.
 *
 * ── Positioning modes ────────────────────────────────────────────────────────
 *
 *   • Canvas-anchored (default):  The panel is a scaled DOM overlay that
 *     tracks the anchor node's canvas position and inherits zoom via
 *     CSS transform:scale(ds.scale).  The settings flyout is also placed
 *     inside the panel element so it inherits the same transform.
 *
 *   • Screen-fixed free:  The panel stays at a fixed screen position
 *     regardless of canvas pan or zoom.  The user sets this via the
 *     settings flyout; the current screen position is snapshotted at
 *     the moment of switching.
 *
 *   • Screen-pinned corner:  The panel snaps to one of the four viewport
 *     corners with a fixed margin, recalculated every frame so it stays
 *     correct even when the panel height changes.
 *
 * ── Size and resize ──────────────────────────────────────────────────────────
 *
 * The panel is resizable by dragging any of its four corners (NW / NE / SW / SE).
 * Two settings control all content sizing:
 *   panelWidth    — panel width in CSS pixels (drives the sc horizontal scale factor)
 *   userRowHeight — height of each variable row in CSS pixels (user-set directly)
 *
 * During a corner drag both values are recomputed from the new panel dimensions
 * and _render() is called once per animation frame so that EVERY element —
 * fonts, badges, paddings, inputs, toggles, textareas, step buttons — rescales
 * proportionally.  The panel DOM height is always derived bottom-up from content:
 * it is never set explicitly and always equals the sum of all row heights plus
 * header, padding, and multiline textarea overhead.
 *
 * String textarea heights are stored in _vbStringHeights as ratios of
 * userRowHeight (e.g. 2.5 means taHeight = 2.5 × userRowHeight).  When the user
 * drags to resize vertically, userRowHeight changes and all textarea heights scale
 * automatically — no ratio rescaling step is needed.
 *
 * ── Features ─────────────────────────────────────────────────────────────────
 *
 *   • Live value display and editing for INT, FLOAT, STRING, SEED, BOOL types
 *   • Boolean rows render as a custom CSS toggle switch with true/false readout
 *   • Range override inputs (min/max/step) below INT/FLOAT rows to clamp the
 *     drag-input to any range independently of the widget's natural bounds
 *   • Drag-to-reorder variable rows within the panel
 *   • Inline label rename on double-click
 *   • Locate (centres canvas on the node) and Delete buttons per row
 *   • Seed rows: ice-cube freeze toggle + dice randomise button
 *   • "Add variable" dialog: batch-create multiple typed variables at once;
 *     the dialog's + button inherits the type of the most-recently added row,
 *     and the first row always defaults to INT
 *   • Settings flyout: font, colors, icon animation, position mode, presets
 *   • Animated lightning icon in the header (pulse / flicker / glow / none)
 *   • Named presets saved to localStorage; load/delete from the flyout
 *   • Panel auto-hides when the anchor node is collapsed
 */
import { app } from "/scripts/app.js";
import { addStylesheet } from "/scripts/utils.js";


console.log("[VB] varBoard.js loaded", import.meta.url);
window.__VB_LOADED = (window.__VB_LOADED || 0) + 1;
// Load the companion stylesheet.  addStylesheet() resolves the path relative
// to the calling script's URL, so "varBoard.css" resolves correctly regardless
// of where ComfyUI is installed.
addStylesheet(new URL("varBoard.css", import.meta.url).href);

// ─── Node type registry ───────────────────────────────────────────────────────
// VB_PANEL_TYPE is the LiteGraph type string for the dashboard anchor node.
// VB_VAR_TYPES lists every variable node class that the panel should track.
// These strings must match the node_id values registered in nodes.py exactly.

export const VB_PANEL_TYPE = "VB_Panel";
export const VB_VAR_TYPES = [
    "VB_Int", "VB_Float",
    "VB_String", "VB_Seed",
    "VB_Bool",
    "VB_Sampler", "VB_Scheduler",
];

// TYPE_META maps each variable node's comfyClass to its display metadata.
//   type  — canonical string used for value formatting and parsing
//   color — accent color for the row's left-border stripe and the type badge
//   label — short string shown inside the badge on each row
export const TYPE_META = {
    VB_Int:       { type: "INT",       color: "#1a6329", label: "INT"       },
    VB_Float:     { type: "FLOAT",     color: "#175ab8", label: "FLOAT"     },
    VB_String:    { type: "STRING",    color: "#5a33a3", label: "STRING"    },
    VB_Seed:      { type: "SEED",      color: "#b55820", label: "SEED"      },
    VB_Bool:      { type: "BOOL",      color: "#228282", label: "BOOL"      },
    VB_Sampler:   { type: "SAMPLER",   color: "#bf831f", label: "SMPLR"     },
    VB_Scheduler: { type: "SCHEDULER", color: "#198758", label: "SCHED"     },
};

// NODE_CLASS_MAP converts the dialog's type key (e.g. "INT") to the LiteGraph
// comfyClass name needed to instantiate the correct backend node at runtime.
export const NODE_CLASS_MAP = {
    INT:       "VB_Int",
    FLOAT:     "VB_Float",
    STRING:    "VB_String",
    SEED:      "VB_Seed",
    BOOL:      "VB_Bool",
    SAMPLER:   "VB_Sampler",
    SCHEDULER: "VB_Scheduler",
};

// TYPE_DEFAULT_LABELS maps each VB variable comfyClass to the human-readable
// base label applied when a node is created outside the Add dialog (e.g. by
// dragging it from the node menu).  The Add dialog uses the same names via its
// local TYPE_LABELS map; keeping them in sync here ensures consistency.
export const TYPE_DEFAULT_LABELS = {
    VB_Int:       "Integer",
    VB_Float:     "Float",
    VB_String:    "String",
    VB_Seed:      "Seed",
    VB_Bool:      "Bool",
    VB_Sampler:   "Sampler",
    VB_Scheduler: "Scheduler",
};

// PYTHON_DEFAULT_LABELS maps each variable comfyClass to the default label
// string set by the Python backend (nodes.py INPUT_TYPES "default" for label).
// These are treated as "unset" by nodeCreated so the JS naming convention
// is applied when nodes are placed from the menu instead of the Add dialog.
export const PYTHON_DEFAULT_LABELS = {
    VB_Int:       "int_var",
    VB_Float:     "float_var",
    VB_String:    "string_var",
    VB_Seed:      "seed",
    VB_Bool:      "bool_var",
    VB_Sampler:   "sampler",
    VB_Scheduler: "scheduler",
};
export const NODE_STYLE = {
    VB_Int:       { color: "#1a6329", bgcolor: "#0d1f0d" },
    VB_Float:     { color: "#175ab8", bgcolor: "#0a0f1f" },
    VB_String:    { color: "#5a33a3", bgcolor: "#13092a" },
    VB_Seed:      { color: "#b55820", bgcolor: "#1f0f0a" },
    VB_Bool:      { color: "#228282", bgcolor: "#091a1a" },
    VB_Sampler:   { color: "#bf831f", bgcolor: "#1f1600" },
    VB_Scheduler: { color: "#198758", bgcolor: "#001a0e" },
};

// ─── Combo type options ───────────────────────────────────────────────────────
// COMBO_OPTIONS is a static fallback used only when the LiteGraph widget has not
// yet been initialised (e.g. during the very first render before the graph is
// fully loaded).  At runtime the panel reads options from valueW.options.values
// instead, which reflects the live ComfyUI list including any custom samplers or
// schedulers registered by third-party nodes.
export const COMBO_OPTIONS = {
    VB_Sampler: [
        "euler", "euler_cfg_pp", "euler_ancestral", "euler_ancestral_cfg_pp",
        "heun", "heunpp2", "dpm_2", "dpm_2_ancestral",
        "lms", "dpm_fast", "dpm_adaptive",
        "dpmpp_2s_ancestral", "dpmpp_2s_ancestral_cfg_pp",
        "dpmpp_sde", "dpmpp_sde_gpu",
        "dpmpp_2m", "dpmpp_2m_cfg_pp", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
        "dpmpp_3m_sde", "dpmpp_3m_sde_gpu",
        "ddpm", "lcm", "ipndm", "ipndm_v", "deis", "ddim", "uni_pc", "uni_pc_bh2",
    ],
    VB_Scheduler: [
        "normal", "karras", "exponential", "sgm_uniform",
        "simple", "ddim_uniform", "beta", "linear_quadratic",
        "kl_optimal",
    ],
};

// ─── Panel size constants ─────────────────────────────────────────────────────
export const DEF_W = 420;   // default width used for new panels
export const MIN_W = 180;   // absolute minimum panel width in pixels (hard floor before content check)
export const MIN_H = 50;    // absolute minimum panel height in pixels (hard floor; height is content-driven so overflow is impossible vertically)

// ─── Corner-pin map ───────────────────────────────────────────────────────────
// Used by _applyPosition() when pinCorner is not "free".  Each entry names
// the viewport edge to anchor to on each axis.
export const CORNERS = {
    free: null,
    "top-left": { v: "top", h: "left" },
    "top-right": { v: "top", h: "right" },
    "bottom-left": { v: "bottom", h: "left" },
    "bottom-right": { v: "bottom", h: "right" },
};
// Gap in pixels between the panel edge and the viewport boundary when pinned.
export const CORNER_MARGIN = 16;
export const DEFAULT_ROW_H = 34;
// ─── Default settings object ──────────────────────────────────────────────────
// Stored on the anchor node as _vbSettings and serialised with the workflow.
// Keys missing from a saved workflow are back-filled from this object on load.
export const DEFAULT_SETTINGS = {
    bgColor: "#0a0f14",         // darker background
    fontFamily: "monospace",
    labelColor: "#b0b0b0",      // darker label color
    valueColor: "#cccccc",      // darker value color
    iconStyle: "pulse",
    iconShape: "panel-rows",
    pinCorner: "free",
    pinOffsetH: CORNER_MARGIN,
    pinOffsetV: CORNER_MARGIN,
    rowHeight: DEFAULT_ROW_H,
    screenFixed: false,
    panelWidth: DEF_W,
    userRowHeight: DEFAULT_ROW_H,
    accentColor: "#3b82f6",     // slightly darker blue
    hideBadge: false,
    dragArea: ["right"],
    coloredNodes: true,
};

export const PRESETS_KEY = "__vb_presets";  // localStorage key for named settings presets
export const ACCENT = "#5b9cf6";       // fallback accent color when settings are absent

// ─── Unified panel sizing ─────────────────────────────────────────────────────
// A single scale factor `sc` drives every visual element — header, rows,
// buttons, badges, fonts, paddings, icons, toggles, seed buttons — so that
// resizing the panel horizontally rescales everything proportionally.
//
// scaleFor(panelWidth)
//   Returns sc = panelWidth / DEF_W  (DEF_W = 420 px).
//   Scale is purely width-driven; panel height has no effect on sc.
//
// headerHeightFor(sc) — header bar height = HDR_BASE_H * sc
// fontFromRow(rowH)   — row-level font size (fraction of rowH)
//
// Panel height is always derived bottom-up from content:
//   domHeight = PANEL_BORDER + hdrH + ROWS_PAD_B + nodeCount × userRowHeight
//             + multilineOverhead
//   where multilineOverhead = Σ (taH_i − userRowHeight + DRAG_HANDLE_H + 2×padV)
//   across multiline rows, and taH_i = ratio_i × userRowHeight.
// The DOM height is never set explicitly — it always equals the content height.

export const HDR_BASE_H  = 46;   // header height in px at sc = 1.0
export const ROWS_PAD_B  = 4;    // .__vb_rows padding-bottom (kept in CSS too)
export const PANEL_BORDER = 2;   // total vertical border (.__vb_panel: 1px top + 1px bottom, box-sizing:border-box)
export const DRAG_HANDLE_H = 8;  // height contribution of the textarea drag-resize handle (content-box height + border - |margin-top|)

// ─── CSS keyframe animations ──────────────────────────────────────────────────
// Fixed: applyAnimCSS is called by DOMPanel during render.
// We only provide a helper to build the CSS here if needed, or leave it to constants.js

export function buildAnimCSS(c) {
    return [
        `@keyframes vb-pulse {`,
        `  0%,100% { transform:scale(1);   opacity:1;    filter:drop-shadow(0 0 3px ${c}aa); }`,
        `  50%     { transform:scale(1.2); opacity:0.75; filter:drop-shadow(0 0 8px ${c}ff); }`,
        `}`,
        `@keyframes vb-flicker {`,
        `  0%,19%,21%,23%,55%,57%,100% { opacity:1;    filter:drop-shadow(0 0 2px ${c}cc); }`,
        `  20%,22%,56%                  { opacity:0.15; filter:none; }`,
        `}`,
        `@keyframes vb-glow {`,
        `  0%,100% { filter:drop-shadow(0 0 2px ${c}aa) drop-shadow(0 0 6px ${c}aa); }`,
        `  50%     { filter:drop-shadow(0 0 6px ${c}88) drop-shadow(0 0 18px ${c}dd); }`,
        `}`,
    ].join('\n');
}
export function applyAnimCSS(color) {
    let s = document.getElementById("__vb_anim_css");
    if (!s) { s = document.createElement("style"); s.id = "__vb_anim_css"; document.head.appendChild(s); }
    s.textContent = buildAnimCSS(color);
}
// Removed immediate call to applyAnimCSS here to avoid document.head access before DOM is ready in all environments
// and to keep this module purely about constants and simple generators.

// ─── Header icon ─────────────────────────────────────────────────────────────
// makeHeaderIcon(shape, style, color) builds an inline SVG for the panel header.
//
// shape — one of the ICON_SHAPES keys below
// style — animation: "pulse" | "flicker" | "glow" | "none"
// color — SVG fill/stroke color matching the current accentColor setting

export const ICON_SHAPES = {
    // ── Original lightning bolt ───────────────────────────────────────────────
    "lightning": {
        label: "⚡ Lightning",
        viewBox: "0 0 16 20", w: 13, h: 16,
        render(svg, color) {
            const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
            p.setAttribute("fill", color);
            p.setAttribute("d", "M9 0L2 11h6l-1 9 7-11H8z");
            svg.appendChild(p);
        },
    },
    // ── Hub with spokes ───────────────────────────────────────────────────────
    // Central circle with lines radiating outward — "gather / aggregate"
    "hub": {
        label: "◈ Hub",
        viewBox: "0 0 20 20", w: 16, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            // spokes at 8 angles
            [[10,0],[17,3],[20,10],[17,17],[10,20],[3,17],[0,10],[3,3]].forEach(([x,y]) => {
                svg.appendChild(mk("line", { x1:10, y1:10, x2:x, y2:y, stroke:color, "stroke-width":"1.5", "stroke-linecap":"round" }));
            });
            svg.appendChild(mk("circle", { cx:10, cy:10, r:3.5, fill:color }));
        },
    },
    // ── Panel with rows ───────────────────────────────────────────────────────
    // Rectangle divided into horizontal strips — mirrors the actual UI
    "panel-rows": {
        label: "◫ Panel rows",
        viewBox: "0 0 20 20", w: 16, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            svg.appendChild(mk("rect", { x:1, y:1, width:18, height:18, rx:2, ry:2, fill:"none", stroke:color, "stroke-width":"1.5" }));
            // header strip
            svg.appendChild(mk("rect", { x:1, y:1, width:18, height:4.5, rx:2, ry:2, fill:color, opacity:"0.35" }));
            // 3 row lines
            [7, 11, 15].forEach(y => svg.appendChild(mk("line", { x1:3.5, y1:y, x2:16.5, y2:y, stroke:color, "stroke-width":"1.5", "stroke-linecap":"round" })));
        },
    },
    // ── Panel receiving inputs (arrow into panel) ─────────────────────────────
    "panel-input": {
        label: "◄ Panel input",
        viewBox: "0 0 22 20", w: 17, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            // panel body (right side)
            svg.appendChild(mk("rect", { x:8, y:1, width:13, height:18, rx:2, ry:2, fill:"none", stroke:color, "stroke-width":"1.5" }));
            [6.5, 10.5, 14.5].forEach(y => svg.appendChild(mk("line", { x1:10, y1:y, x2:19, y2:y, stroke:color, "stroke-width":"1.3", "stroke-linecap":"round" })));
            // inward arrow
            svg.appendChild(mk("polyline", { points:"1,10 6,6.5 6,13.5", fill:color, stroke:"none" }));
        },
    },
    // ── Sliders stack ─────────────────────────────────────────────────────────
    // Three slider tracks with thumbs at different positions
    "sliders": {
        label: "🎛 Sliders",
        viewBox: "0 0 20 20", w: 16, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            [[4, 11], [10, 5], [7, 15]].forEach(([tx, y]) => {
                // track
                svg.appendChild(mk("line", { x1:2, y1:y, x2:18, y2:y, stroke:color, "stroke-width":"1.5", "stroke-linecap":"round", opacity:"0.4" }));
                // thumb
                svg.appendChild(mk("circle", { cx:tx, cy:y, r:2.5, fill:color }));
            });
        },
    },
    // ── Curly braces ─────────────────────────────────────────────────────────
    // { } with a central dot — variables bound together
    "braces": {
        label: "{ } Braces",
        viewBox: "0 0 20 20", w: 16, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            // left brace
            const L = "M8.5,1 Q5.5,1 5.5,4 L5.5,8.5 Q5.5,10 3.5,10 Q5.5,10 5.5,11.5 L5.5,16 Q5.5,19 8.5,19";
            // right brace
            const R = "M11.5,1 Q14.5,1 14.5,4 L14.5,8.5 Q14.5,10 16.5,10 Q14.5,10 14.5,11.5 L14.5,16 Q14.5,19 11.5,19";
            [L, R].forEach(d => {
                const p = mk("path", { d, fill:"none", stroke:color, "stroke-width":"1.8", "stroke-linecap":"round", "stroke-linejoin":"round" });
                svg.appendChild(p);
            });
            svg.appendChild(mk("circle", { cx:10, cy:10, r:1.5, fill:color }));
        },
    },
    // ── Grid (⊞) ─────────────────────────────────────────────────────────────
    // 2×2 grid with plus — structured collection
    "grid": {
        label: "⊞ Grid",
        viewBox: "0 0 20 20", w: 16, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            svg.appendChild(mk("rect", { x:1, y:1, width:18, height:18, rx:2, ry:2, fill:"none", stroke:color, "stroke-width":"1.5" }));
            svg.appendChild(mk("line", { x1:10, y1:1, x2:10, y2:19, stroke:color, "stroke-width":"1.5" }));
            svg.appendChild(mk("line", { x1:1, y1:10, x2:19, y2:10, stroke:color, "stroke-width":"1.5" }));
            // dot in each quadrant
            [[5.5,5.5],[14.5,5.5],[5.5,14.5],[14.5,14.5]].forEach(([cx,cy]) =>
                svg.appendChild(mk("circle", { cx, cy, r:1.8, fill:color }))
            );
        },
    },
    // ── Knob ─────────────────────────────────────────────────────────────────
    // Circular dial with a tick mark — control / tune
    "knob": {
        label: "◎ Knob",
        viewBox: "0 0 20 20", w: 16, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            svg.appendChild(mk("circle", { cx:10, cy:10, r:8.5, fill:"none", stroke:color, "stroke-width":"1.5" }));
            svg.appendChild(mk("circle", { cx:10, cy:10, r:3,   fill:color }));
            // tick at top-right (~45°)
            svg.appendChild(mk("line", { x1:10, y1:2, x2:10, y2:5.5, stroke:color, "stroke-width":"2", "stroke-linecap":"round" }));
            // small arc markers
            [[-50],[50],[130],[230]].forEach(([deg]) => {
                const r = deg * Math.PI / 180;
                const x = 10 + 8.5 * Math.sin(r), y = 10 - 8.5 * Math.cos(r);
                const x2 = 10 + 6.5 * Math.sin(r), y2 = 10 - 6.5 * Math.cos(r);
                svg.appendChild(mk("line", { x1:x, y1:y, x2:x2, y2:y2, stroke:color, "stroke-width":"1.2", "stroke-linecap":"round", opacity:"0.5" }));
            });
        },
    },
    // ── DNA / helix ──────────────────────────────────────────────────────────
    // Two interleaved sine waves — parameters, genetics, variation
    "dna": {
        label: "⌬ DNA",
        viewBox: "0 0 20 20", w: 16, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            // two sinusoidal strands
            const pts1 = [], pts2 = [];
            for (let i = 0; i <= 16; i++) {
                const y = 1 + i * 1.125;
                const x = 10 + 6 * Math.sin(i * Math.PI / 4);
                pts1.push(`${x},${y}`);
                pts2.push(`${20 - x},${y}`);
            }
            svg.appendChild(mk("polyline", { points: pts1.join(" "), fill:"none", stroke:color, "stroke-width":"1.8", "stroke-linecap":"round", "stroke-linejoin":"round" }));
            svg.appendChild(mk("polyline", { points: pts2.join(" "), fill:"none", stroke:color, "stroke-width":"1.8", "stroke-linecap":"round", "stroke-linejoin":"round", opacity:"0.55" }));
            // rungs
            for (let i = 2; i <= 14; i += 4) {
                const y = 1 + i * 1.125;
                const x1 = 10 + 6 * Math.sin(i * Math.PI / 4);
                svg.appendChild(mk("line", { x1:x1, y1:y, x2:20-x1, y2:y, stroke:color, "stroke-width":"1", opacity:"0.4" }));
            }
        },
    },
    // ── Target / crosshair ────────────────────────────────────────────────────
    // Circle with crosshair lines — precision, aim
    "crosshair": {
        label: "⊕ Crosshair",
        viewBox: "0 0 20 20", w: 16, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            svg.appendChild(mk("circle", { cx:10, cy:10, r:7,   fill:"none", stroke:color, "stroke-width":"1.5" }));
            svg.appendChild(mk("circle", { cx:10, cy:10, r:2.2, fill:color }));
            // four crosshair segments (gap around inner circle)
            [[10,1,10,6.5],[10,13.5,10,19],[1,10,6.5,10],[13.5,10,19,10]].forEach(([x1,y1,x2,y2]) =>
                svg.appendChild(mk("line", { x1, y1, x2, y2, stroke:color, "stroke-width":"1.5", "stroke-linecap":"round" }))
            );
        },
    },
    // ── Wave ─────────────────────────────────────────────────────────────────
    // Sine wave — signal, audio, variation
    "wave": {
        label: "∿ Wave",
        viewBox: "0 0 20 20", w: 16, h: 16,
        render(svg, color) {
            const ns = "http://www.w3.org/2000/svg";
            const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };
            // smooth sine using cubic bezier
            const d = "M1,10 C3.5,10 3.5,3 6.5,3 S9.5,17 12.5,17 S16.5,3 19,3";
            svg.appendChild(mk("path", { d, fill:"none", stroke:color, "stroke-width":"2", "stroke-linecap":"round", "stroke-linejoin":"round" }));
        },
    },
};

export function makeHeaderIcon(shape, style, color = "#5b9cf6", scale = 1) {
    const def = ICON_SHAPES[shape] ?? ICON_SHAPES["panel-rows"];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", def.viewBox);
    svg.setAttribute("width",  String(Math.round(def.w * scale)));
    svg.setAttribute("height", String(Math.round(def.h * scale)));
    svg.style.cssText = "flex-shrink:0;vertical-align:middle;";
    def.render(svg, color);
    if (style && style !== "none") {
        svg.style.animation = `vb-${style} ${
            style === "pulse"   ? "2s ease-in-out infinite" :
            style === "flicker" ? "3s step-end infinite"    :
                                  "2.5s ease-in-out infinite"
        }`;
    }
    return svg;
}

// ─── Value formatting / parsing ───────────────────────────────────────────────
// (Moved to utils.js)
