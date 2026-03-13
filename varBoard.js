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
import { app } from "../../scripts/app.js";
import { addStylesheet } from "../../scripts/utils.js";


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

const VB_PANEL_TYPE = "VB_Panel";
const VB_VAR_TYPES = [
    "VB_Int", "VB_Float",
    "VB_String", "VB_Seed",
    "VB_Bool",
    "VB_Sampler", "VB_Scheduler",
];

// TYPE_META maps each variable node's comfyClass to its display metadata.
//   type  — canonical string used for value formatting and parsing
//   color — accent color for the row's left-border stripe and the type badge
//   label — short string shown inside the badge on each row
const TYPE_META = {
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
const NODE_CLASS_MAP = {
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
const TYPE_DEFAULT_LABELS = {
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
const PYTHON_DEFAULT_LABELS = {
    VB_Int:       "int_var",
    VB_Float:     "float_var",
    VB_String:    "string_var",
    VB_Seed:      "seed",
    VB_Bool:      "bool_var",
    VB_Sampler:   "sampler",
    VB_Scheduler: "scheduler",
};
const NODE_STYLE = {
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
const COMBO_OPTIONS = {
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
const DEF_W = 420;   // default width used for new panels
const MIN_W = 180;   // absolute minimum panel width in pixels (hard floor before content check)
const MIN_H = 50;    // absolute minimum panel height in pixels (hard floor; height is content-driven so overflow is impossible vertically)

// ─── Corner-pin map ───────────────────────────────────────────────────────────
// Used by _applyPosition() when pinCorner is not "free".  Each entry names
// the viewport edge to anchor to on each axis.
const CORNERS = {
    free: null,
    "top-left": { v: "top", h: "left" },
    "top-right": { v: "top", h: "right" },
    "bottom-left": { v: "bottom", h: "left" },
    "bottom-right": { v: "bottom", h: "right" },
};
// Gap in pixels between the panel edge and the viewport boundary when pinned.
const CORNER_MARGIN = 16;
const DEFAULT_ROW_H = 34;
// ─── Default settings object ──────────────────────────────────────────────────
// Stored on the anchor node as _vbSettings and serialised with the workflow.
// Keys missing from a saved workflow are back-filled from this object on load.
const DEFAULT_SETTINGS = {
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

const PRESETS_KEY = "__vb_presets";  // localStorage key for named settings presets
const ACCENT = "#5b9cf6";       // fallback accent color when settings are absent

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

const HDR_BASE_H  = 46;   // header height in px at sc = 1.0
const ROWS_PAD_B  = 4;    // .__vb_rows padding-bottom (kept in CSS too)
const PANEL_BORDER = 2;   // total vertical border (.__vb_panel: 1px top + 1px bottom, box-sizing:border-box)
const DRAG_HANDLE_H = 8;  // height contribution of the textarea drag-resize handle (content-box height + border - |margin-top|)

function scaleFor(panelWidth) {
    return panelWidth / DEF_W;
}


function headerHeightFor(sc) { return Math.round(HDR_BASE_H * sc); }

function fontFromRow(rowH) {
    // Font is a fraction of rowH.
    return Math.max(1, Math.round(rowH * 0.42));
}

// rowHeightFrom() returns the user-set row height from settings.
function rowHeightFrom(settings) { return settings.userRowHeight ?? DEFAULT_ROW_H; }

// ─── CSS keyframe animations ──────────────────────────────────────────────────
// The lightning icon is animated via CSS keyframes injected into a <style> tag
// in <head>.  Keyframes are regenerated whenever the user changes the accent
// color, so that glow and drop-shadow colors always match the current setting.
// buildAnimCSS() produces the raw CSS string; applyAnimCSS() injects or
// replaces the <style> tag.  We call applyAnimCSS() immediately at module load
// so the icon animates from the first frame, before any node has been placed.

function buildAnimCSS(c) {
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
function applyAnimCSS(color) {
    let s = document.getElementById("__vb_anim_css");
    if (!s) { s = document.createElement("style"); s.id = "__vb_anim_css"; document.head.appendChild(s); }
    s.textContent = buildAnimCSS(color);
}
applyAnimCSS("#5b9cf6");

// ─── Header icon ─────────────────────────────────────────────────────────────
// makeHeaderIcon(shape, style, color) builds an inline SVG for the panel header.
//
// shape — one of the ICON_SHAPES keys below
// style — animation: "pulse" | "flicker" | "glow" | "none"
// color — SVG fill/stroke color matching the current accentColor setting

const ICON_SHAPES = {
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
};

function makeHeaderIcon(shape, style, color = "#5b9cf6", scale = 1) {
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
// formatValue() converts a raw widget value to the display string shown in the
// panel inputs.  FLOAT always shows two decimal places so the field width is
// stable; INT and SEED are rendered as plain integers; STRING passes through.
//
// parseValue() is the inverse: converts the string the user typed back into the
// native JS type expected by the widget (number for INT/FLOAT/SEED, string for
// STRING).  Values that cannot be parsed fall back to 0 / 0.0 / "".

function formatValue(value, type, decimals) {
    if (type === "FLOAT") {
        const d = (decimals !== undefined && decimals !== null) ? Math.max(0, Math.min(10, parseInt(decimals))) : 2;
        return parseFloat(value).toFixed(d);
    }
    if (type === "INT" || type === "SEED") return String(parseInt(value) || 0);
    if (type === "BOOL") return value ? "true" : "false";
    return String(value ?? "");
}

function parseValue(str, type) {
    if (type === "INT" || type === "SEED") return parseInt(str) || 0;
    if (type === "FLOAT") return parseFloat(str) || 0.0;
    if (type === "BOOL") return str === "true" || str === true || str === 1;
    return str;
}

// randomSeed() returns a random 32-bit unsigned integer for the dice button.
function randomSeed() { return Math.floor(Math.random() * 0xFFFFFFFF); }

// ─── Graph node helpers ───────────────────────────────────────────────────────
// getVBNodes() returns all VB variable nodes currently in the graph, ordered
// according to the anchor's _vbOrder array.  Nodes whose IDs are not yet
// present in _vbOrder are appended at the end, sorted by canvas Y position
// (top-to-bottom) so newly created nodes appear in a predictable location.
//
// createVBNode() instantiates a new VB variable node of the given type,
// positions it to the right of the anchor panel with a vertical offset based
// on how many variable nodes already exist, deduplicates the label if needed,
// assigns an initial random seed value for SEED nodes, and appends the new
// node's ID to _vbOrder so it immediately appears at the bottom of the panel.

function getVBNodes(order) {
    const nodes = (app.graph?._nodes ?? [])
        .filter(n => VB_VAR_TYPES.includes(n.comfyClass));
    if (order?.length) {
        return nodes.sort((a, b) => {
            const ia = order.indexOf(a.id);
            const ib = order.indexOf(b.id);
            if (ia === -1 && ib === -1) return a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0];
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });
    }
    return nodes.sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]);
}

function createVBNode(type, anchorNode, label) {
    const comfyClass = NODE_CLASS_MAP[type];
    if (!comfyClass) return null;
    const node = LiteGraph.createNode(comfyClass);
    if (!node) return null;

    const existing = getVBNodes();
    const offsetY = existing.length * 90;
    node.pos = [
        anchorNode.pos[0] + (anchorNode._vbSettings?.panelWidth ?? DEF_W) + 60,
        anchorNode.pos[1] + offsetY,
    ];

    if (label) {
        const usedLabels = existing.map(n => {
            const lw = n.widgets?.find(w => w.name === "label");
            return lw?.value || n.title || "";
        });
        let ul = label;
        if (usedLabels.includes(ul)) {
            let c = 2;
            while (usedLabels.includes(`${label}_${c}`)) c++;
            ul = `${label}_${c}`;
        }
        label = ul;
    }

    app.graph.add(node);

    if (label) {
        const lw = node.widgets?.find(w => w.name === "label");
        if (lw) lw.value = label;
        node.title = label;
    }

    if (anchorNode._vbOrder) anchorNode._vbOrder.push(node.id);

    if (type === "SEED") {
        const vw = node.widgets?.find(w => w.name === "seed");
        if (vw) vw.value = randomSeed();
    }

    node.setDirtyCanvas(true, true);
    return node;
}

// ─── Custom select widget ─────────────────────────────────────────────────────
// makeCustomSelect(options, selectedValue, onChange)
//
// Replaces every native <select> in the panel with a fully DOM-based dropdown
// so that it lives inside the panel's CSS transform and scales correctly with
// canvas zoom — something the OS-rendered native dropdown cannot do.
//
// Returns a wrapper <div> that exposes the same surface as a <select> element
// used in this codebase:
//   .value          — get/set the current selected value
//   .disabled       — get/set disabled state
//   .style          — proxied to the root element
//   .dataset        — proxied to the root element
//   .className      — get/set classes on the root element
//   .addEventListener(type, fn) — 'change' events fire when selection changes;
//                                 all other events forwarded to root element
//
// Visual design mirrors .__vb_select.  The open list is appended to
// document.body (position:fixed) so it is never clipped by overflow:hidden
// ancestors, but its font-size is read from the wrapper element's computed
// style so it inherits the panel's scaling correctly.

function makeCustomSelect(optionsList, selectedValue, onChange, signal) {
    let currentValue = selectedValue;
    let isOpen = false;
    let isDisabled = false;
    let listEl = null;
    const changeListeners = [];

    // ── Root wrapper (acts as the "select" element) ───────────────────────────
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "combobox");
    wrapper.setAttribute("tabindex", "0");
    wrapper.style.cssText = [
        "position:relative",
        "box-sizing:border-box",
        "cursor:pointer",
        "user-select:none",
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "white-space:nowrap",
        "overflow:hidden",
    ].join(";");

    const displaySpan = document.createElement("span");
    displaySpan.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;";

    const arrowSpan = document.createElement("span");
    arrowSpan.textContent = "▾";
    arrowSpan.style.cssText = "margin-left:4px;flex-shrink:0;pointer-events:none;opacity:0.7;";

    wrapper.appendChild(displaySpan);
    wrapper.appendChild(arrowSpan);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const getLabelFor = val => {
        const entry = optionsList.find(o => o.value === val);
        return entry ? entry.label : val;
    };

    const setDisplay = val => {
        displaySpan.textContent = getLabelFor(val);
    };

    const fireChange = () => {
        changeListeners.forEach(fn => fn());
        if (onChange) onChange(currentValue);
    };

    let onAway = null; // declared here so closeList can always cancel it

    const closeList = () => {
        if (!listEl) return;
        listEl.remove();
        listEl = null;
        isOpen = false;
        wrapper.setAttribute("aria-expanded", "false");
        if (onAway) {
            document.removeEventListener("mousedown", onAway);
            onAway = null;
        }
    };

    const openList = () => {
        if (isDisabled || isOpen) return;
        isOpen = true;
        wrapper.setAttribute("aria-expanded", "true");

        // getComputedStyle gives the CSS px value (pre-scale).  The wrapper lives
        // inside this.el which has transform:scale(ds.scale), so the visually
        // rendered size is cssFs * appliedScale.  We derive appliedScale from the
        // ratio of the wrapper's getBoundingClientRect height to its offsetHeight
        // so the dropdown list matches the visual size of the closed button exactly.
        const cssFs = parseFloat(getComputedStyle(wrapper).fontSize) || 11;
        const offsetH = wrapper.offsetHeight || 1;
        const rect = wrapper.getBoundingClientRect();
        const appliedScale = rect.height / offsetH;
        const screenFs = Math.round(cssFs * appliedScale);

        listEl = document.createElement("div");
        listEl.style.cssText = [
            "position:fixed",
            "z-index:999999",
            "overflow-y:auto",
            "max-height:220px",
            `font-size:${screenFs}px`,
            "font-family:" + (getComputedStyle(wrapper).fontFamily || "monospace"),
            "background:#0a0c0e",
            "border:1px solid #484e5c",
            "border-radius:4px",
            "box-shadow:0 4px 16px rgba(0,0,0,0.7)",
            "box-sizing:border-box",
        ].join(";");

        // Position below (or above) the wrapper.
        const spaceBelow = window.innerHeight - rect.bottom;
        const approxListH = Math.min(220, optionsList.length * (screenFs + 10));
        const openUpward = spaceBelow < approxListH && rect.top > approxListH;

        listEl.style.width = Math.max(rect.width, 120) + "px";
        listEl.style.left  = rect.left + "px";
        if (openUpward) {
            listEl.style.bottom = (window.innerHeight - rect.top) + "px";
        } else {
            listEl.style.top = rect.bottom + "px";
        }

        // Populate options.
        optionsList.forEach(({ value, label }) => {
            const item = document.createElement("div");
            item.style.cssText = [
                `padding:${Math.round(screenFs * 0.4)}px ${Math.round(screenFs * 0.7)}px`,
                "cursor:pointer",
                "white-space:nowrap",
                "overflow:hidden",
                "text-overflow:ellipsis",
                value === currentValue
                    ? "background:#1f2937;color:#eaeaea;"
                    : "background:transparent;color:#cdd9e5;",
            ].join(";");
            item.textContent = label;
            item.addEventListener("mouseenter", () => {
                item.style.background = "#2d3748";
                item.style.color = "#eaeaea";
            });
            item.addEventListener("mouseleave", () => {
                item.style.background = value === currentValue ? "#1f2937" : "transparent";
                item.style.color = value === currentValue ? "#eaeaea" : "#cdd9e5";
            });
            item.addEventListener("mousedown", e => {
                e.preventDefault();
                e.stopPropagation();
                if (value !== currentValue) {
                    currentValue = value;
                    setDisplay(currentValue);
                    fireChange();
                }
                closeList();
            });
            listEl.appendChild(item);
        });

        document.body.appendChild(listEl);

        // Scroll selected item into view.
        const idx = optionsList.findIndex(o => o.value === currentValue);
        if (idx >= 0) {
            const itemH = listEl.scrollHeight / optionsList.length;
            listEl.scrollTop = Math.max(0, idx * itemH - itemH * 2);
        }

        // Close on outside click. onAway is declared in outer scope so
        // closeList() can always cancel it regardless of how the list closes.
        onAway = e => {
            if (listEl && !listEl.contains(e.target) && e.target !== wrapper) {
                closeList();
            }
        };
        setTimeout(() => document.addEventListener("mousedown", onAway, { signal }), 0);
    };

    // ── Interaction ───────────────────────────────────────────────────────────
    wrapper.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        if (isDisabled) return;
        isOpen ? closeList() : openList();
    });

    wrapper.addEventListener("wheel", e => e.stopPropagation());

    wrapper.addEventListener("keydown", e => {
        if (isDisabled) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); isOpen ? closeList() : openList(); return; }
        if (e.key === "Escape") { closeList(); return; }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const idx = optionsList.findIndex(o => o.value === currentValue);
            const next = e.key === "ArrowDown"
                ? Math.min(idx + 1, optionsList.length - 1)
                : Math.max(idx - 1, 0);
            if (next !== idx) {
                currentValue = optionsList[next].value;
                setDisplay(currentValue);
                fireChange();
            }
        }
    });

    // ── Public interface ──────────────────────────────────────────────────────
    Object.defineProperty(wrapper, "value", {
        get: () => currentValue,
        set: v => {
            if (v !== currentValue && optionsList.some(o => o.value === v)) {
                currentValue = v;
                setDisplay(currentValue);
            }
        },
    });

    Object.defineProperty(wrapper, "disabled", {
        get: () => isDisabled,
        set: v => {
            isDisabled = !!v;
            wrapper.style.opacity   = isDisabled ? "0.45" : "1";
            wrapper.style.cursor    = isDisabled ? "not-allowed" : "pointer";
            wrapper.setAttribute("tabindex", isDisabled ? "-1" : "0");
            if (isDisabled) closeList();
        },
    });

    // Proxy addEventListener so 'change' is captured; everything else forwarded.
    const _origAddEventListener = wrapper.addEventListener.bind(wrapper);
    wrapper.addEventListener = (type, fn, opts) => {
        if (type === "change") { changeListeners.push(fn); return; }
        _origAddEventListener(type, fn, opts);
    };

    // close() — call when the widget is removed from the DOM.
    wrapper.closeList = closeList;

    setDisplay(currentValue);
    return wrapper;
}

// ─── DOMPanel registry ────────────────────────────────────────────────────────
// _vbPanelRegistry holds every currently-alive DOMPanel instance.  Graph-level
// event hooks installed in setup() dispatch to all registered panels so that
// structural graph changes (node add/remove, connection change) trigger a full
// re-render on every live panel, and widget value changes trigger a lightweight
// in-place update — without a per-frame polling loop.

const _vbPanelRegistry = new Set();

// ─── DOMPanel ─────────────────────────────────────────────────────────────────
// The DOMPanel class owns the floating HTML element that overlays the canvas.
// One instance is created per VB_Panel anchor node, and destroyed when that
// node is removed.
//
// Lifecycle:
//   constructor → _build() creates the root element and the right-edge resize
//     handle, then calls _render() to populate the header and variable rows.
//   _startPositionLoop() begins a lightweight rAF loop that only repositions
//     the panel every frame (no value/structure polling).
//   _attachGraphListeners() registers this panel in _vbPanelRegistry so that
//     graph-level hooks can dispatch structural and value-change events to it.
//   destroy() cancels the loop, deregisters from _vbPanelRegistry, and removes
//     the element from the DOM.

class DOMPanel {
    constructor(anchorNode) {
        this.anchor = anchorNode;  // the VB_Panel LiteGraph node
        this.el = null;        // root <div> element
        this._raf = null;        // requestAnimationFrame handle
        this._renderScheduled = false; // debounce flag for _handleGraphChange
        this._awayAC = new AbortController(); // torn down in destroy() to cancel all away-click listeners
        this._build();
        this._startPositionLoop();
        this._attachGraphListeners();
    }

    // settings is a convenience getter that always returns the live settings
    // object from the anchor node, falling back to DEFAULT_SETTINGS if the
    // anchor hasn't been initialised yet (e.g. during the very first render).
    get settings() {
        return this.anchor._vbSettings ?? DEFAULT_SETTINGS;
    }

    // ── Shell ─────────────────────────────────────────────────────────────────
    // _build() creates the root panel element, attaches it to document.body,
    // adds the four corner resize handles and move strips, then calls _render()
    // to populate it.  We attach to body so the element stacks above all other UI.
    // _applyPosition() in the rAF loop repositions it every frame to follow
    // the anchor node.

    _build() {
        this._seedControl = new Map();  // nodeId → "freeze"|"+1"|"-1"|null; tracks seed control mode
        const s = this.settings;
        const el = document.createElement("div");
        el.className = "__vb_panel";
        // Static layout properties live in .__vb_panel (varBoard.css).
        // Only dynamic, settings-driven values are set here.
        el.style.width = `${s.panelWidth}px`;
        el.style.background = s.bgColor;
        el.style.fontFamily = s.fontFamily;
        el.style.color = s.valueColor;
        // Stop mouse events from propagating into the canvas so that clicking
        // or scrolling inside the panel doesn't accidentally pan/zoom the graph.
        el.addEventListener("mousedown", e => e.stopPropagation());
        el.addEventListener("wheel", e => e.stopPropagation());
        el.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); });
        document.body.appendChild(el);
        this.el = el;

        // ResizeObserver fires _syncNodeSize() whenever the panel's height
        // changes — e.g. when variable nodes are added/removed, multiline is
        // toggled, or any other DOM change causes a reflow.  This is the
        // primary mechanism that keeps the canvas node footprint in sync with
        // the DOM overlay without requiring explicit call sites for every
        // possible height-changing action.
        if (typeof ResizeObserver !== "undefined") {
            this._resizeObs = new ResizeObserver(() => this._syncNodeSize());
            this._resizeObs.observe(this.el);
        }

        this._buildResizeHandles();
        this._buildMoveStrips();
        this._render();
    }



    // ── Resize handles ────────────────────────────────────────────────────────
    // _buildResizeHandles() places one 16×16 px corner grip at each corner.
    // Dragging any corner resizes the panel; the dragged corner tracks the
    // cursor exactly.  Both panelWidth and rowHeight (derived from the new
    // panel height) are updated live so _render() rescales every element.
    //
    // Coordinate system (canvas-anchored mode):
    //   anchor.pos lives in canvas-space (pre-scale).
    //   Screen-space delta = canvasDelta * ds.scale
    //   → canvasDelta = screenDelta / ds.scale
    //
    // For corners that move the left/top edge (W and N axes) we update
    // anchor.pos so that _applyPosition() pins the opposite corner correctly.
    // Math (west axis):
    //   right edge screen = rect.left + (pos[0] + ds.offset[0]) * sc + panelW * sc
    //   keeping right edge fixed while moving left:
    //   new pos[0] = startPos[0] - (newW - startW)   [canvas units]

    _buildResizeHandles() {
        const CORNER_SZ = 16; // px — corner handle size

        const makeHandle = (css, axes, corner) => {
            const h = document.createElement("div");
            h.className = `__vb_resize __vb_resize_${corner}`;
            h.style.cssText = css;

            h.addEventListener("mousedown", e => {
                e.preventDefault(); e.stopPropagation();
                const s = this.anchor._vbSettings;
                const canvasAnchored = !s.screenFixed && !(s.pinCorner && s.pinCorner !== "free");

                // Snapshot state at drag start
                const startCX  = e.clientX;
                const startCY  = e.clientY;
                const startW   = this.el.offsetWidth;
                const startH   = this.el.offsetHeight;
                const startPosX = canvasAnchored ? this.anchor.pos[0] : (s.screenX ?? 0);
                const startPosY = canvasAnchored ? this.anchor.pos[1] : (s.screenY ?? 0);

                // rAF throttle token
                let rafPending = false;

                const onMove = ev => {
                    // Convert screen-pixel delta to CSS-pixel panel delta.
                    // In canvas-anchored mode the panel is scaled by ds.scale,
                    // so a screen movement of N px moves the panel edge by N/sc CSS px.
                    const curSc = canvasAnchored ? (app.canvas?.ds?.scale ?? 1) : 1;
                    const dx = (ev.clientX - startCX) / curSc;
                    const dy = (ev.clientY - startCY) / curSc;

                    // Compute new dimensions
                    let newW = axes.e ? startW + dx : axes.w ? startW - dx : startW;
                    let newH = axes.s ? startH + dy : axes.n ? startH - dy : startH;

                    // Enforce hard minimums.
                    newW = Math.max(MIN_W, newW);
                    newH = Math.max(MIN_H, newH);

                    // Update position for edges that move (W and N axes).
                    // dx/dy are already in canvas-space px (divided by scale above).
                    if (axes.w) {
                        const shift = startW - newW;
                        if (canvasAnchored) this.anchor.pos[0] = startPosX + shift;
                        else s.screenX = startPosX + shift;
                    }
                    if (axes.n) {
                        const shift = startH - newH;
                        if (canvasAnchored) this.anchor.pos[1] = startPosY + shift;
                        else s.screenY = startPosY + shift;
                    }

                    // panelWidth is the authoritative width setting.
                    // userRowHeight is computed from the dragged height so that
                    // dragging the panel taller/shorter directly changes row sizes.
                    s.panelWidth = newW;

                    // Compute userRowHeight from the new dragged height.
                    // Panel DOM height formula (approximating padV ≈ 0.1 × rowH):
                    //   domH = PANEL_BORDER + hdrH + ROWS_PAD_B
                    //        + nodeCount × rowH
                    //        + Σ_ml ( (ratio_i − 1) × rowH + DRAG_HANDLE_H + 2 × 0.1 × rowH )
                    //   domH = PANEL_BORDER + hdrH + ROWS_PAD_B + n_ml × DRAG_HANDLE_H
                    //        + rowH × ( nodeCount + taRatioSum − 0.8 × n_ml )
                    // Solving for rowH:
                    //   rowH = (domH − PANEL_BORDER − hdrH − ROWS_PAD_B − n_ml × DRAG_HANDLE_H)
                    //          / (nodeCount + taRatioSum − 0.8 × n_ml)
                    if (axes.s || axes.n) {
                        const nodes = getVBNodes(this.anchor?._vbOrder);
                        if (nodes.length > 0) {
                            const newSc = newW / DEF_W;
                            const newHdrH = headerHeightFor(newSc);
                            const mlNodes = nodes.filter(n => this.anchor._vbMultilineStrings?.[n.id]);
                            const n_ml = mlNodes.length;
                            let taRatioSum = 0;
                            for (const mln of mlNodes) {
                                taRatioSum += this.anchor._vbStringHeights?.[mln.id] ?? 2;
                            }
                            const denominator = nodes.length + taRatioSum - 0.8 * n_ml;
                            const numerator = newH - PANEL_BORDER - newHdrH - ROWS_PAD_B - n_ml * DRAG_HANDLE_H;
                            const newRowH = denominator > 0
                                ? Math.max(1, Math.floor(numerator / denominator))
                                : DEFAULT_ROW_H;
                            s.userRowHeight = newRowH;
                        }
                    }

                    // Re-render once per frame (throttled) so all scaled elements update.
                    // After rendering, enforce the content-overflow minimum: if the
                    // rendered content is wider than the panel, the panel has been
                    // shrunk too far. Temporarily clip to measure the true minimum
                    // content width, snap panelWidth back to that floor, and re-render
                    // once more so nothing is drawn outside the panel boundary.
                    // Height is always content-driven (never set explicitly), so the
                    // panel always expands to fit vertically — no overflow guard needed.
                    if (!rafPending) {
                        rafPending = true;
                        requestAnimationFrame(() => {
                            rafPending = false;
                            this._render();

                            // Measure true content minimum width post-render.
                            // scrollWidth only reports overflow when overflow is not
                            // 'visible', so we briefly switch to 'hidden' for the read.
                            const prevOverflow = this.el.style.overflow;
                            this.el.style.overflow = "hidden";
                            const contentMinW = this.el.scrollWidth;
                            this.el.style.overflow = prevOverflow;

                            if (s.panelWidth < contentMinW) {
                                // The panel was shrunk past the content minimum.
                                // Correct the position offset for W-edge drags so the
                                // opposite (fixed) edge does not drift.
                                if (axes.w) {
                                    const correction = contentMinW - s.panelWidth;
                                    if (canvasAnchored) this.anchor.pos[0] -= correction;
                                    else s.screenX -= correction;
                                }
                                s.panelWidth = contentMinW;
                                this.el.style.width = `${contentMinW}px`;
                                this._render();
                            }
                        });
                    }
                };

                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    // panelWidth and userRowHeight are already committed in onMove.
                    // Do one final render so the last drag position is reflected.
                    this._render();
                    this._syncNodeSize();
                    this.anchor?.setDirtyCanvas(true, true);
                };

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            });

            this.el.appendChild(h);
            return h;
        };

        const PA = "pointer-events:all;z-index:11;position:absolute;";
        const SZ = `width:${16}px;height:${16}px;`;
        makeHandle(`${PA}${SZ}top:0;    left:0;  cursor:nwse-resize;`, { n:true, w:true }, "nw");  // NW
        makeHandle(`${PA}${SZ}top:0;    right:0; cursor:nesw-resize;`, { n:true, e:true }, "ne");  // NE
        makeHandle(`${PA}${SZ}bottom:0; left:0;  cursor:nesw-resize;`, { s:true, w:true }, "sw");  // SW
        makeHandle(`${PA}${SZ}bottom:0; right:0; cursor:nwse-resize;`, { s:true, e:true }, "se");  // SE
    }

    // ── Move strips ───────────────────────────────────────────────────────────
    // _buildMoveStrips() creates thin transparent strips on the panel edges
    // that the user can drag to move the panel.  Which edges are active is
    // driven by settings.dragArea (default: ["right"]).
    //
    // Strip thickness: 12px — wide enough for easy grabbing with a mouse,
    // narrow enough not to intrude on the panel content.
    //
    // Visual affordance: transparent by default, slight brightening on hover
    // (handled in CSS via .__vb_move_strip:hover) so users can discover the
    // grab area without it cluttering the UI at rest.

    _buildMoveStrips() {
        const s = this.anchor._vbSettings;
        const enabledEdges = Array.isArray(s.dragArea) ? s.dragArea : ["right"];

        // Strip thickness in CSS pixels.  12px gives a comfortable grab target.
        const T = 12;  // strip thickness
        const C = 16;  // corner inset — matches resize handle size so strips don't overlap handles

        const edgeStyle = {
            right:  `right:0; top:${C}px; width:${T}px; height:calc(100% - ${C * 2}px);`,
            left:   `left:0;  top:${C}px; width:${T}px; height:calc(100% - ${C * 2}px);`,
            bottom: `bottom:0; left:${C}px; width:calc(100% - ${C * 2}px); height:${T}px;`,
        };

        enabledEdges.forEach(edge => {
            if (!edgeStyle[edge]) return;
            const strip = document.createElement("div");
            strip.className = "__vb_move_strip";
            strip.dataset.vbMoveEdge = edge;
            strip.style.cssText = edgeStyle[edge];
            strip.title = "Drag to move panel";

            strip.addEventListener("mousedown", e => {
                e.preventDefault(); e.stopPropagation();
                const canvasAnchored = !s.screenFixed && !(s.pinCorner && s.pinCorner !== "free");
                const startX = e.clientX, startY = e.clientY;
                const startAnchorX = canvasAnchored ? this.anchor.pos[0] : (s.screenX ?? 20);
                const startAnchorY = canvasAnchored ? this.anchor.pos[1] : (s.screenY ?? 20);
                strip.style.cursor = "grabbing";

                const onMove = ev => {
                    const sc = canvasAnchored ? (app.canvas?.ds?.scale ?? 1) : 1;
                    const dx = (ev.clientX - startX) / sc;
                    const dy = (ev.clientY - startY) / sc;
                    if (canvasAnchored) {
                        this.anchor.pos[0] = startAnchorX + dx;
                        this.anchor.pos[1] = startAnchorY + dy;
                        this.anchor?.setDirtyCanvas(true, true);
                    } else {
                        s.screenX = startAnchorX + dx;
                        s.screenY = startAnchorY + dy;
                    }
                };

                const onUp = () => {
                    strip.style.cursor = "grab";  // restore to grab state explicitly
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    this.anchor?.setDirtyCanvas(true, true);
                };

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            });

            this.el.appendChild(strip);
        });
    }

    // _rebuildMoveStrips() removes all existing move strips and recreates them
    // from the current settings.  Called whenever settings.dragArea changes.
    _rebuildMoveStrips() {
        this.el.querySelectorAll(".__vb_move_strip").forEach(el => el.remove());
        this._buildMoveStrips();
    }

    // ── Render ────────────────────────────────────────────────────────────────
    // _render() is the single source of truth for panel content.  It wipes
    // the element's innerHTML and rebuilds everything from scratch using the
    // current graph state and settings.  It is called:
    //   • once at startup (from _build)
    //   • when the node set changes (nodes added or removed) via _handleGraphChange
    //   • when the user changes a setting that affects layout (row height,
    //     font, colors, etc.)
    //   • after the right-edge drag ends
    //
    // Resize handles and the settings flyout are preserved across re-renders
    // by detaching them before clearing innerHTML and re-attaching after.

    _render() {
        const s = this.settings;

        // Preserve the header icon SVG across re-renders when its appearance
        // hasn't changed (e.g. during a resize drag that only alters panel
        // width).  Re-using the live element keeps CSS animations running
        // without interruption instead of resetting them on every rebuild.
        const existingIconSvg = this.el.querySelector(".__vb_panel_hdr svg");
        const iconUnchanged = existingIconSvg
            && (s.accentColor ?? ACCENT) === this._lastIconColor
            && (s.iconShape ?? "panel-rows") === this._lastIconShape
            && s.iconStyle === this._lastIconStyle;
        if (iconUnchanged) existingIconSvg.remove(); // detach before innerHTML reset

        // Detach elements that must survive innerHTML = "" before wiping.
        // Both move strips and resize handles are persistent structural elements
        // that exist outside of the content render cycle.
        const mss  = [...this.el.querySelectorAll(".__vb_move_strip")];
        const rhs  = [...this.el.querySelectorAll(".__vb_resize")];
        this.el.innerHTML = "";
        mss.forEach(ms => this.el.appendChild(ms));
        rhs.forEach(rh => this.el.appendChild(rh));

        const nodes = getVBNodes(this.anchor?._vbOrder);

        // Regenerate CSS keyframes if the accent color has changed since the
        // last render.  This is cheap (string comparison + style injection).
        applyAnimCSS(s.accentColor ?? ACCENT);

        // Apply top-level styles to the outer panel element.
        // panelWidth is the authoritative width; height is always content-driven
        // (derived bottom-up from userRowHeight and row count), never set explicitly.
        this.el.style.fontFamily = s.fontFamily;
        this.el.style.color = s.valueColor;
        this.el.style.background = s.bgColor;
        this.el.style.width = `${s.panelWidth}px`;
        this.el.style.height = "";
        this.el.style.overflow = "visible";

        // ── Unified sizing ────────────────────────────────────────────────────
        // sc is the width-driven scale factor.  Every element — header, badges,
        // paddings, buttons, icons — is derived from sc so horizontal resizing
        // rescales everything proportionally.
        // rowH is the user-set row height stored directly in userRowHeight; it
        // is independent of sc so vertical resizing never alters sc.
        const sc   = scaleFor(s.panelWidth);
        const hdrH = headerHeightFor(sc);
        const rowH = rowHeightFrom(s);
        const fs = fontFromRow(rowH);

        // ── Header ────────────────────────────────────────────────────────────
        // Header height is enforced via an explicit min-height so it always
        // occupies exactly hdrH px regardless of button/icon natural sizes.
        const hdr = document.createElement("div");
        hdr.className = "__vb_panel_hdr";
        // Header height matches row height so both axes scale together.
        hdr.style.minHeight = `${rowH}px`;
        hdr.style.height    = `${rowH}px`;
        hdr.style.boxSizing = "border-box";
        hdr.style.padding = `${Math.round(rowH * 0.17)}px ${Math.round(12 * sc)}px`;

        const hdrLeft = document.createElement("div");
        hdrLeft.style.cssText = `display:flex; align-items:center; gap:${Math.round(6 * sc)}px;`;
        // Reuse the preserved icon element (animation continues uninterrupted)
        // or create a fresh one if the icon appearance changed.
        const headerIcon = iconUnchanged
            ? existingIconSvg
            : makeHeaderIcon(s.iconShape ?? "panel-rows", s.iconStyle, s.accentColor ?? ACCENT, sc);
        // Always sync icon size to current rowH scale.
        if (iconUnchanged) {
            const def = ICON_SHAPES[s.iconShape ?? "panel-rows"] ?? ICON_SHAPES["panel-rows"];
            const iconSc = rowH / DEFAULT_ROW_H;
            headerIcon.setAttribute("width",  String(Math.round(def.w * iconSc)));
            headerIcon.setAttribute("height", String(Math.round(def.h * iconSc)));
        }
        this._lastIconColor = s.accentColor ?? ACCENT;
        this._lastIconShape = s.iconShape ?? "panel-rows";
        this._lastIconStyle = s.iconStyle;
        hdrLeft.appendChild(headerIcon);

        const titleWrap = document.createElement("div");
        titleWrap.innerHTML = `
            <div style="color:#8892a4;font-size:${fontFromRow(rowH)}px;">
                ${nodes.length} parameter${nodes.length !== 1 ? "s" : ""}
            </div>`;
        hdrLeft.appendChild(titleWrap);
        hdr.appendChild(hdrLeft);

        const hdrRight = document.createElement("div");
        hdrRight.style.cssText = `display:flex; align-items:center; gap:${Math.round(5 * sc)}px;`;

        // ── Add button ────────────────────────────────────────────────────────
        const addBtn = this._makeBtn("＋ Add", "#0f3460", "#eaeaea", fs);
        addBtn.style.borderRadius = "4px";
        addBtn.onclick = () => this._showAddDialog();
        hdrRight.appendChild(addBtn);

        // ── Settings button ───────────────────────────────────────────────────
        const settingsBtn = this._makeBtn("⚙", "#21262d", "#8892a4", fs);
        settingsBtn.style.padding = `${Math.round(fs * 0.27)}px ${Math.round(fs * 0.63)}px`;
        settingsBtn.style.border = "1px solid #202020";
        settingsBtn.style.borderRadius = "4px";
        settingsBtn.title = "Panel settings";
        settingsBtn.onmouseenter = () => { settingsBtn.style.color = "#eaeaea"; settingsBtn.style.borderColor = "#8892a4"; };
        settingsBtn.onmouseleave = () => { settingsBtn.style.color = "#8892a4"; settingsBtn.style.borderColor = "#202020"; };
        settingsBtn.className = "__vb_settings_btn";
        settingsBtn.onclick = () => this._toggleSettings();
        hdrRight.appendChild(settingsBtn);

        hdr.appendChild(hdrRight);
        this.el.appendChild(hdr);

        // ── Empty state ───────────────────────────────────────────────────────
        // When no VB variable nodes exist in the graph, show a placeholder
        // message instead of an empty rows area.  We still sync the node size
        // after this so the canvas footprint matches the empty-state height.
        if (nodes.length === 0) {
            const empty = document.createElement("div");
            empty.style.cssText = "padding:24px 20px; text-align:center; color:#8892a4; font-size:11px; line-height:2;";
            empty.innerHTML = `No VarBoard variable nodes yet.<br>
                Click <b>＋ Add</b> above, or add a<br>
                <b>VarBoard Variable</b> node from the node menu.`;
            this.el.appendChild(empty);
            requestAnimationFrame(() => requestAnimationFrame(() => this._syncNodeSize()));
            return;
        }

        // ── Variable rows ─────────────────────────────────────────────────────
        // rowH and sc are already computed above as pure functions of the panel
        // settings.  Build one row element per variable node and wire reorder.
        const rowsEl = document.createElement("div");
        rowsEl.className = "__vb_rows";
        nodes.forEach((node, i) => rowsEl.appendChild(this._buildRow(node, i, rowH, sc)));

        // Wire drag-to-reorder on the rows container.
        this._setupDragDrop(rowsEl, nodes, rowH);

        // ── Master label-width anchor ─────────────────────────────────────────
        // A thin strip sitting between the header and the rows that shows a
        // single draggable vertical line aligned with the per-row separators.
        // Dragging it sets _vbLabelWidths for every node at once.
        //
        // Position is measured from the DOM after the rows are appended so it
        // is always pixel-perfect regardless of flex layout subtleties.
        {
            const defaultLblW_a = Math.round(80 * sc);
            // Horizontal metrics follow sc (width-driven), vertical metrics follow
            // rowH — matching the same dual-axis policy used by the header and rows.
            const sepLineW_a    = Math.max(1, Math.round(sc) * 2);
            const masterAnchorH = Math.round(rowH * 0.29);  // ~10px at default rowH=34

            const masterAnchor = document.createElement("div");
            masterAnchor.dataset.vbMasterAnchor = "1";
            masterAnchor.style.cssText = `position:relative;height:${masterAnchorH}px;cursor:col-resize;`
                + `background:transparent;flex-shrink:0;overflow:visible;`;
            masterAnchor.title = "Drag to resize all label columns at once";

            // Line and nub start invisible; positioned after first DOM measurement.
            const masterLine = document.createElement("div");
            masterLine.style.cssText = `position:absolute;top:1px;bottom:1px;`
                + `width:${sepLineW_a}px;transform:translateX(-50%);`
                + `background:#484e5c;border-radius:1px;transition:background 0.1s;`
                + `pointer-events:none;visibility:hidden;`;
            masterAnchor.appendChild(masterLine);

            // Nub width is horizontal → sc; nub height is vertical → rowH.
            const masterNub = document.createElement("div");
            masterNub.style.cssText = `position:absolute;bottom:0;transform:translateX(-50%);`
                + `width:${Math.round(7 * sc)}px;height:${Math.round(rowH * 0.12)}px;`
                + `background:#484e5c;border-radius:2px 2px 0 0;`
                + `pointer-events:none;transition:background 0.1s;visibility:hidden;`;
            masterAnchor.appendChild(masterNub);

            // _alignMasterAnchor() reads the first row's sep element from the
            // live DOM and moves the line/nub to match its centre exactly.
            const _alignMasterAnchor = () => {
                // The sep is the 5th child of the first row container's first
                // flex row.  We mark it with a data attribute for reliable lookup.
                const firstSep = rowsEl.querySelector("[data-vb-sep]");
                if (!firstSep) return;
                // offsetLeft is relative to offsetParent. We want it relative
                // to masterAnchor, which is a sibling of rowsEl inside this.el.
                // Both share the same offsetParent (this.el), so the difference
                // of their offsetLefts gives the correct panel-relative position.
                const sepLeft  = firstSep.offsetLeft + firstSep.offsetWidth / 2;
                const anchorLeft = masterAnchor.offsetLeft; // should be 0
                const x = sepLeft - anchorLeft;
                masterLine.style.left = `${x}px`;
                masterNub.style.left  = `${x}px`;
                masterLine.style.visibility = "visible";
                masterNub.style.visibility  = "visible";
            };

            // Expose so per-row sep drags can call it to keep the anchor in sync.
            this._alignMasterAnchor = _alignMasterAnchor;

            masterAnchor.addEventListener("mouseenter", () => {
                masterLine.style.background = "#3b82f6cc";
                masterNub.style.background  = "#3b82f6cc";
            });
            masterAnchor.addEventListener("mouseleave", () => {
                masterLine.style.background = "#484e5c";
                masterNub.style.background  = "#484e5c";
            });

            masterAnchor.addEventListener("mousedown", e => {
                e.preventDefault(); e.stopPropagation();
                masterLine.style.background = "#3b82f6";
                masterNub.style.background  = "#3b82f6";

                const startX = e.clientX;
                const startWidths = new Map(
                    nodes.map(n => [n.id, this.anchor._vbLabelWidths?.[n.id] ?? defaultLblW_a])
                );

                // Get all current label divs (they have data-vb-label)
                const labelDivs = new Map();
                this.el.querySelectorAll("[data-vb-label]").forEach(div => {
                    labelDivs.set(parseInt(div.dataset.vbLabel), div);
                });

                let rafPending = false;
                const onMove = ev => {
                    const sc2 = (s.screenFixed || (s.pinCorner && s.pinCorner !== "free"))
                        ? 1 : (app.canvas?.ds?.scale ?? 1);
                    const dx = (ev.clientX - startX) / sc2;

                    // Update stored widths and directly style each label div
                    nodes.forEach(n => {
                        const newW = Math.max(20, (startWidths.get(n.id) ?? defaultLblW_a) + dx);
                        if (!this.anchor._vbLabelWidths) this.anchor._vbLabelWidths = {};
                        this.anchor._vbLabelWidths[n.id] = newW;

                        const labelDiv = labelDivs.get(n.id);
                        if (labelDiv) {
                            labelDiv.style.flex = `0 0 ${newW}px`;
                        }
                    });

                    // Reposition the master line to match the first row's new label width
                    _alignMasterAnchor();
                };

                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    masterLine.style.background = "#484e5c";
                    masterNub.style.background  = "#484e5c";
                    // Final re‑render to ensure everything is consistent (optional)
                    this._render();
                };

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            });

            // Insert anchor between header and rows.
            this.el.appendChild(masterAnchor);
            this.el.appendChild(rowsEl);

            // Measure and position after the browser has laid out the rows.
            requestAnimationFrame(() => requestAnimationFrame(_alignMasterAnchor));
        }
        requestAnimationFrame(() => requestAnimationFrame(() => this._syncNodeSize()));
        setTimeout(() => this._syncNodeSize(), 100);
        setTimeout(() => this._syncNodeSize(), 350);
    }

    // ── Row ───────────────────────────────────────────────────────────────────
    // _buildRow() constructs the HTML row element for a single VB variable node.
    // Each row contains (left to right):
    //   drag handle · type badge · label cell · value area · action buttons
    //
    // The row height (rowH) is set by the user via the header − / + buttons and
    // is independent of panel width.  The horizontal scale factor (sc) drives
    // badge width, label width, horizontal padding, and gap so those elements
    // grow with the panel width.  Vertical metrics (font size, vertical padding,
    // control heights) are derived from rowH only so that horizontal resizing
    // never alters row height.
    //
    // Seed rows additionally show an ice-cube freeze toggle and a dice button.

    _buildRow(node, index, rowH, sc) {
        const s = this.settings;
        const nodes = getVBNodes(this.anchor?._vbOrder);
        // sc and rowH are pre-computed in _render() as pure functions of both
        // panel dimensions.  No Math.max floors here — the user owns the size.
        const fs       = fontFromRow(rowH);
        const padV     = Math.round(rowH * 0.10);
        const pad      = Math.round(4 * sc);
        const gap      = Math.round(6 * sc);
        const badgeFont = Math.round(fs * 0.75);
        const badgePadV = Math.round(fs * 0.12);
        const badgePadH = Math.round(fs * 0.30);
        const badgeW    = Math.round(badgeFont * 4.5);
        // Action-button size driven by fs (same as .__vb_row_btn 1.7em)
        const btnSz    = Math.round(fs * 1.7);
        const meta = TYPE_META[node.comfyClass] || { type: "FLOAT", color: "#555", label: "?" };
        const wName = node.comfyClass === "VB_Seed" ? "seed" : "value";
        const labelW = node.widgets?.find(w => w.name === "label");
        const valueW = node.widgets?.find(w => w.name === wName);
        const label = labelW?.value || node.title || node.comfyClass;
        const curVal = valueW?.value ?? (meta.type === "BOOL" ? false : meta.type === "SAMPLER" ? "euler" : meta.type === "SCHEDULER" ? "normal" : 0);
        const isSeed   = meta.type === "SEED";
        const isBool   = meta.type === "BOOL";
        const isCombo  = meta.type === "SAMPLER" || meta.type === "SCHEDULER";
        const isNumeric = !isCombo && meta.type !== "STRING" && meta.type !== "BOOL";
        // _seedControl is a DOMPanel-level Map (not persisted) that tracks the
        // per-seed control mode: "freeze", "+1", "-1", or null (default/randomise).
        // `locked` is a mutable closure variable updated by setSeedCtrl() so that
        // all event handlers always see the current state.
        let locked = isSeed && (this._seedControl?.get(node.id) === "freeze");
        // Per-node range overrides: { min, max, step, decimals } — stored in anchor._vbRangeOverrides[nodeId]
        const rangeOvr = this.anchor._vbRangeOverrides?.[node.id] ?? {};
        // decimals: number of decimal places for FLOAT display (null = default 2)
        const floatDecimals = (meta.type === "FLOAT" && rangeOvr.decimals !== undefined) ? rangeOvr.decimals : null;

        // Outer container wraps the main row + collapsible settings sub-panel.
        const container = document.createElement("div");
        // flex:0 0 auto lets the container size to content rather than forcing equal heights.
        // This allows multiline STRING rows to be taller than other rows.
        container.style.cssText = "display:flex;flex-direction:column;flex:0 0 auto;";

        const row = document.createElement("div");
        row.style.cssText = `
            display:flex; align-items:stretch; gap:${gap}px; padding:${padV}px ${pad * 2}px;
            background:${index % 2 === 0 ? "rgba(0,0,0,0.40)" : "rgba(0,0,0,0.22)"};
            border-left:${Math.round(3 * sc)}px solid ${meta.color}66;
            flex:0 0 auto; min-height:${rowH}px; box-sizing:border-box;
        `;
        row.onmouseenter = () => row.style.background = "rgba(255,255,255,0.07)";
        row.onmouseleave = () => row.style.background = index % 2 === 0 ? "rgba(0,0,0,0.40)" : "rgba(0,0,0,0.22)";

        // Drag handle
        const handle = document.createElement("div");
        handle.className = "__vb_handle";
        handle.textContent = "⠿";
        handle.style.cssText = `color:#30363d;font-size:${fs}px;cursor:grab;flex-shrink:0;padding:0 ${Math.round(2 * sc)}px;line-height:1;user-select:none;align-self:center;`;
        handle.title = "Drag to reorder";
        handle.addEventListener("mouseover", () => handle.style.color = "#8892a4");
        handle.addEventListener("mouseout", () => handle.style.color = "#30363d");
        row.appendChild(handle);

        // Type badge
        const badge = document.createElement("div");
        badge.style.cssText = `background:${meta.color};color:#fff;font-size:${badgeFont}px;font-weight:bold;padding:${badgePadV}px ${badgePadH}px;border-radius:3px;flex-shrink:0;min-width:${badgeW}px;text-align:center;align-self:center;`;
        badge.textContent = meta.label;
        if (s.hideBadge) badge.style.display = "none";
        row.appendChild(badge);

        // Label column width: use per-node persisted value, fall back to scale-derived default.
        const defaultLblW = Math.round(80 * sc);
        const lblW = this.anchor._vbLabelWidths?.[node.id] ?? defaultLblW;

        // Label
        const lbl = document.createElement("div");
        lbl.style.cssText = `flex:0 0 ${lblW}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${fs}px;color:${s.labelColor};cursor:pointer;padding:2px ${Math.round(4 * sc)}px;border-radius:3px;align-self:center;`;
        lbl.textContent = label;
        lbl.dataset.vbLabel = node.id;
        lbl.title = "Click to select  •  Double-click to rename";
        let lastLblClick = 0;
        lbl.addEventListener("mousedown", e => {
            e.stopPropagation();
            const now = Date.now();
            if (now - lastLblClick < 400 && labelW) { e.preventDefault(); this._startInlineRename(lbl, labelW, node); }
            else app.canvas.selectNode(node);
            lastLblClick = now;
        });
        row.appendChild(lbl);

        // ── Label / value drag separator ──────────────────────────────────────
        // A thin vertical strip between the label and the value area.  Dragging
        // it adjusts the label column width for this row, stored in
        // anchor._vbLabelWidths[nodeId] so it persists across re-renders and
        // workflow saves.  The drag delta is divided by the canvas scale so
        // the resize tracks the cursor correctly at any zoom level.
        const sepW = Math.round(5 * sc);
        const sep = document.createElement("div");
        sep.dataset.vbSep = node.id;  // used by master anchor to find the first sep
        sep.style.cssText = `flex-shrink:0;width:${sepW}px;align-self:stretch;cursor:col-resize;position:relative;z-index:2;`;
        // Visual indicator: a center line that scales in width with sc.
        const sepLineW = Math.round(sc);
        const sepLine = document.createElement("div");
        sepLine.style.cssText = `position:absolute;left:50%;transform:translateX(-50%);top:10%;bottom:10%;width:${sepLineW}px;background:#484e5c;border-radius:1px;transition:background 0.1s;pointer-events:none;`;
        sep.appendChild(sepLine);
        sep.addEventListener("mouseenter", () => { sepLine.style.background = "#3b82f6cc"; });
        sep.addEventListener("mouseleave", () => { sepLine.style.background = "#484e5c"; });
        sep.addEventListener("mousedown", e => {
            e.preventDefault(); e.stopPropagation();
            sepLine.style.background = "#3b82f6";
            const startX = e.clientX;
            const startLblW = lbl.offsetWidth;
            const onMove = ev => {
                const sc2 = (s.screenFixed || (s.pinCorner && s.pinCorner !== "free"))
                    ? 1
                    : (app.canvas?.ds?.scale ?? 1);
                const newW = startLblW + (ev.clientX - startX) / sc2;
                lbl.style.flex = `0 0 ${newW}px`;
                if (!this.anchor._vbLabelWidths) this.anchor._vbLabelWidths = {};
                this.anchor._vbLabelWidths[node.id] = newW;
                // If this is the top row's sep, keep the master anchor in sync.
                if (index === 0) this._alignMasterAnchor?.();
            };
            const onUp = () => {
                sepLine.style.background = "#484e5c";
                // Always realign master anchor on mouseup (order may have changed).
                this._alignMasterAnchor?.();
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
        row.appendChild(sep);

        // ── Value area ────────────────────────────────────────────────────────
        const valWrap = document.createElement("div");
        valWrap.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:2px;align-self:stretch;";

        // Hoisted so the seed ice-button onclick (outside the isNumeric block)
        // can update the input's cursor/border when freezing or unfreezing.
        // wMin/wMax/stepVal are also hoisted so the settingsBtn onclick (outside
        // the isNumeric block) can prefill the flyout with effective defaults.
        let inp = null;
        let fillBar = null;
        const defStep = meta.type === "FLOAT" ? 0.01 : 1;
        const stepVal = rangeOvr.step !== undefined ? rangeOvr.step : defStep;
        const wMin = rangeOvr.min !== undefined ? rangeOvr.min : (valueW?.options?.min ?? (meta.type === "FLOAT" ? -10.00 : -9999));
        const wMax = rangeOvr.max !== undefined ? rangeOvr.max : (valueW?.options?.max ?? (meta.type === "FLOAT" ? 10.00 : 9999));

        if (isBool) {
            // Boolean type: render a custom CSS toggle switch that scales with sc.
            // Centre the toggle horizontally within the value area so it sits in
            // the middle rather than being left-aligned with unused space on the right.
            valWrap.style.alignItems = "center";
            const togWrap = document.createElement("div");
            togWrap.style.cssText = `display:inline-flex;align-items:center;gap:${Math.round(7 * sc)}px;cursor:pointer;user-select:none;`;
            togWrap.addEventListener("mousedown", e => e.stopPropagation());

            // trackW scales horizontally with panel width (fine — it only grows wider).
            // trackH, thumbSz and thumbPad are derived from rowH so that horizontal
            // resizing never changes the toggle's height.
            const trackW   = Math.round(36 * sc);
            const trackH   = Math.round(rowH * 0.59);
            const thumbSz  = Math.round(rowH * 0.41);
            const thumbPad = Math.round(rowH * 0.09);

            let togOn = !!curVal;

            const track = document.createElement("div");
            track.dataset.vbNodeId = node.id; track.dataset.vbWidget = wName; track.dataset.vbType = "BOOL";
            // Store layout constants as data attributes so _updateInputsInPlace()
            // can update the toggle visuals without access to the build-time closure.
            track.dataset.vbToggleColor = meta.color;
            track.dataset.vbTrackW  = trackW;
            track.dataset.vbThumbSz = thumbSz;
            track.dataset.vbThumbPad = thumbPad;
            track.style.cssText = `position:relative;display:inline-block;width:${trackW}px;height:${trackH}px;border-radius:${trackH}px;background:${togOn ? meta.color : "#444"};cursor:pointer;flex-shrink:0;box-sizing:border-box;transition:background 0.15s;`;

            const thumb = document.createElement("div");
            thumb.style.cssText = `position:absolute;top:${thumbPad}px;left:${togOn ? (trackW - thumbSz - thumbPad) : thumbPad}px;width:${thumbSz}px;height:${thumbSz}px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);transition:left 0.15s;pointer-events:none;`;
            track.appendChild(thumb);

            const togLbl = document.createElement("span");
            togLbl.textContent = togOn ? "true" : "false";
            togLbl.style.cssText = `font-size:${fs}px;color:${s.valueColor};min-width:${Math.round(30 * sc)}px;`;
            togLbl.dataset.vbToggleLbl = node.id;

            const setTogState = (checked) => {
                togOn = checked;
                track.style.background = checked ? meta.color : "#444";
                thumb.style.left = `${checked ? (trackW - thumbSz - thumbPad) : thumbPad}px`;
                togLbl.textContent = checked ? "true" : "false";
                if (valueW) { valueW.value = checked; node.setDirtyCanvas(true, false); }
            };

            track.addEventListener("click", () => setTogState(!togOn));
            togWrap.appendChild(track);
            togWrap.appendChild(togLbl);
            valWrap.appendChild(togWrap);
        } else if (isCombo) {
            // ── Combo select (SAMPLER / SCHEDULER) ────────────────────────────
            // Renders a full-width <select> that mirrors the backend widget's
            // COMBO input.  Changing the value writes back to the widget
            // immediately so the graph prompt picks it up without re-render.
            const options = valueW?.options?.values ?? COMBO_OPTIONS[node.comfyClass] ?? [];
            const effectiveVal = valueW?.value ?? options[0] ?? "";
            const sel = makeCustomSelect(
                options.map(opt => ({ value: opt, label: opt })),
                effectiveVal,
                () => { if (valueW) { valueW.value = sel.value; node.setDirtyCanvas(true, false); } },
                this._awayAC.signal
            );
            sel.className = "__vb_select __vb_combo_row";
            sel.dataset.vbNodeId = node.id;
            sel.dataset.vbWidget = wName;
            sel.dataset.vbType   = meta.type;
            sel.style.width = "100%";
            sel.style.font = `${fs}px ${s.fontFamily}`;
            sel.style.fontSize = `${fs}px`;
            sel.style.color = s.valueColor;
            sel.style.background = "#0d1117";
            sel.style.border = `1px solid ${meta.color}55`;
            sel.style.borderRadius = "3px";
            sel.style.padding = `${Math.round(2*sc)}px ${Math.round(6*sc)}px`;
            sel.style.alignSelf = "center";

            valWrap.appendChild(sel);
        } else if (isNumeric) {
            // ── Drag-to-adjust numeric input ──────────────────────────────────
            // A text input that doubles as a drag handle: click to edit the
            // value directly, or press-and-drag horizontally to increment /
            // decrement by the step amount — matching standard ComfyUI widgets.

            const inpRow = document.createElement("div");

            inp = document.createElement("input");
            inp.type = "text";
            inp.value = formatValue(curVal, meta.type, floatDecimals);
            inp.readOnly = true;
            inp.disabled = locked;
            inp.dataset.vbNodeId = node.id; inp.dataset.vbWidget = wName; inp.dataset.vbType = meta.type;
            if (floatDecimals !== null) inp.dataset.vbDecimals = floatDecimals;
            inp.style.cssText = `flex:1;min-width:0;box-sizing:border-box;padding:${Math.round(3 * sc)}px ${Math.round(6 * sc)}px;background:${locked ? "rgba(100,200,255,0.15)" : "rgba(0,0,0,0.4)"};border:1px solid ${locked ? "#7dd3fc" : "#30363d"};border-radius:3px;color:${s.valueColor};font:${fs}px ${s.fontFamily};font-size:${fs}px;outline:none;cursor:${locked ? "not-allowed" : isSeed ? "text" : "ew-resize"};height:100%;user-select:none;text-align:center;${locked ? "box-shadow:0 0 6px #7dd3fc40,inset 0 0 10px #7dd3fc15;" : ""}${locked && isSeed ? "letter-spacing:0.5px;" : ""}`;

            // ── Fill bar ──────────────────────────────────────────────────────
            // If both min and max are defined, show a proportional fill bar
            // behind the text to visualise the value's position in the range.
            // data-vb-fill is read by _updateInputsInPlace() to keep the bar
            // in sync when the value is changed externally (e.g. canvas widget).
            fillBar = document.createElement("div");
            fillBar.dataset.vbFill    = node.id;
            fillBar.dataset.vbFillMin = wMin;
            fillBar.dataset.vbFillMax = wMax;
            fillBar.style.cssText = `position:absolute;left:1px;top:1px;bottom:1px;border-radius:2px;background:${locked ? "#7dd3fc30" : `${meta.color}25`};pointer-events:none;transition:width 0.08s ease;`;
            const updateFill = (v) => {
                if (wMin != null && wMax != null && wMax > wMin) {
                    const pct = Math.max(0, Math.min(1, (v - wMin) / (wMax - wMin))) * 100;
                    fillBar.style.width = `${pct}%`;
                    fillBar.style.display = "";
                } else {
                    fillBar.style.display = "none";
                }
            };
            updateFill(curVal);

            // Track drag state per input element.
            let drag = null; // { startX, startVal, moved }

            inp.addEventListener("mousedown", e => {
                e.stopPropagation();
                if (locked || inp !== e.target) return;
                // If already in edit mode (focused + writable), let normal text
                // selection happen instead of starting a drag.
                if (!inp.readOnly) return;
                e.preventDefault();
                const startVal = valueW ? (typeof valueW.value === "number" ? valueW.value : parseValue(inp.value, meta.type)) : parseValue(inp.value, meta.type);
                drag = { startX: e.clientX, startVal, moved: false };

                const onMove = ev => {
                    if (!drag) return;
                    const dx = ev.clientX - drag.startX;
                    if (Math.abs(dx) > 2) drag.moved = true;
                    if (!drag.moved) return;
                    // Pixels per step scales with panel width so a wider panel
                    // is less sensitive (more pixels needed per increment).
                    // Base: 2px/step (int) or 4px/step (float) at 420px width.
                    const widthScale = (s.panelWidth ?? DEF_W) / 420;
                    const pxPerStep = (meta.type === "FLOAT" ? 4 : 2) * widthScale;
                    const steps = Math.round(dx / pxPerStep);
                    let newVal;
                    if (meta.type === "FLOAT") {
                        newVal = parseFloat((drag.startVal + steps * stepVal).toFixed(6));
                    } else {
                        newVal = drag.startVal + steps * stepVal;
                    }
                    // Clamp to min/max if defined.
                    if (wMin != null && newVal < wMin) newVal = wMin;
                    if (wMax != null && newVal > wMax) newVal = wMax;
                    if (valueW) { valueW.value = newVal; node.setDirtyCanvas(true, false); }
                    inp.value = formatValue(newVal, meta.type, floatDecimals);
                    updateFill(newVal);
                };

                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    if (drag && !drag.moved) {
                        // No drag occurred — switch to text editing mode.
                        inp.readOnly = false;
                        inp.style.cursor = "text";
                        inp.style.userSelect = "text";
                        inp.style.borderColor = meta.color;
                        inp.style.color = "#fff";
                        inp.focus();
                        inp.select();
                    }
                    drag = null;
                };

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            });

            inp.addEventListener("blur", () => {
                // Commit the typed value and return to drag mode.
                if (!inp.readOnly && valueW && !locked) {
                    if (!inp.dataset.cancelled) {
                        let v = parseValue(inp.value, meta.type);
                        if (wMin != null && v < wMin) v = wMin;
                        if (wMax != null && v > wMax) v = wMax;
                        valueW.value = v;
                        node.setDirtyCanvas(true, false);
                    }
                    delete inp.dataset.cancelled;
                }
                inp.readOnly = true;
                inp.style.cursor = locked ? "not-allowed" : isSeed ? "text" : "ew-resize";
                inp.style.userSelect = "none";
                inp.style.borderColor = locked ? "#7dd3fc" : "#30363d";
                inp.style.boxShadow = locked ? "0 0 6px #7dd3fc40,inset 0 0 10px #7dd3fc15" : "";
                inp.style.color = s.valueColor;
                inp.value = formatValue(valueW?.value ?? curVal, meta.type, floatDecimals);
                updateFill(valueW?.value ?? curVal);
            });

            inp.addEventListener("keydown", e => {
                e.stopPropagation();
                if (locked) return;
                if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
                if (e.key === "Escape") { inp.dataset.cancelled = "1"; inp.blur(); }
                if (inp.readOnly) return; // keys only matter in edit mode
                if (!valueW) return;
                if (meta.type === "INT" || meta.type === "SEED") {
                    if (e.key === "ArrowUp") { e.preventDefault(); valueW.value = (parseInt(valueW.value) || 0) + 1; inp.value = formatValue(valueW.value, meta.type, floatDecimals); node.setDirtyCanvas(true, false); }
                    if (e.key === "ArrowDown") { e.preventDefault(); valueW.value = (parseInt(valueW.value) || 0) - 1; inp.value = formatValue(valueW.value, meta.type, floatDecimals); node.setDirtyCanvas(true, false); }
                }
                if (meta.type === "FLOAT") {
                    const kstep = e.shiftKey ? 0.1 : 0.01;
                    if (e.key === "ArrowUp") { e.preventDefault(); valueW.value = parseFloat((parseFloat(valueW.value || 0) + kstep).toFixed(4)); inp.value = formatValue(valueW.value, meta.type, floatDecimals); node.setDirtyCanvas(true, false); }
                    if (e.key === "ArrowDown") { e.preventDefault(); valueW.value = parseFloat((parseFloat(valueW.value || 0) - kstep).toFixed(4)); inp.value = formatValue(valueW.value, meta.type, floatDecimals); node.setDirtyCanvas(true, false); }
                }
            });

            // ── Step buttons (− / +) ──────────────────────────────────────────
            // Click to decrement/increment the value by one step.
            const mkStepBtn = (sign) => {
                const btn = document.createElement("button");
                btn.textContent = sign > 0 ? "+" : "−";
                btn.disabled = locked;
                btn.style.cssText = `flex-shrink:0;width:1.5em;height:100%;box-sizing:border-box;background:rgba(0,0,0,0.4);color:${locked ? "#555" : "#8892a4"};border:1px solid #30363d;border-radius:3px;padding:0;cursor:${locked ? "not-allowed" : "pointer"};font-size:${fs}px;line-height:1;user-select:none;`;
                btn.addEventListener("mousedown", e => e.stopPropagation());
                btn.onmouseenter = () => { if (!locked) { btn.style.color = "#eaeaea"; btn.style.borderColor = "#8892a4"; btn.style.background = `${meta.color}33`; } };
                btn.onmouseleave = () => { btn.style.color = locked ? "#555" : "#8892a4"; btn.style.borderColor = "#30363d"; btn.style.background = "rgba(0,0,0,0.4)"; };
                btn.onclick = () => {
                    if (locked || !valueW) return;
                    let newVal;
                    if (meta.type === "FLOAT") {
                        newVal = parseFloat((valueW.value + sign * stepVal).toFixed(6));
                    } else {
                        newVal = valueW.value + sign * stepVal;
                    }
                    if (wMin != null && newVal < wMin) newVal = wMin;
                    if (wMax != null && newVal > wMax) newVal = wMax;
                    valueW.value = newVal;
                    node.setDirtyCanvas(true, false);
                    inp.value = formatValue(newVal, meta.type, floatDecimals);
                    updateFill(newVal);
                };
                return btn;
            };

            inpRow.style.cssText = "display:flex;align-items:stretch;gap:2px;width:100%;flex:1;";
            // Wrap inp + fillBar together so the absolutely-positioned fill bar
            // is clipped to the input area and never bleeds over the step buttons.
            const inpWrap = document.createElement("div");
            inpWrap.style.cssText = "flex:1;min-width:0;position:relative;display:flex;align-items:stretch;";
            inpWrap.appendChild(fillBar);
            inpWrap.appendChild(inp);
            // Seed rows use dedicated ▲/▼ buttons (appended outside valWrap).
            // All other numeric rows keep the − / + step buttons.
            if (!isSeed) inpRow.appendChild(mkStepBtn(-1));
            inpRow.appendChild(inpWrap);
            if (!isSeed) inpRow.appendChild(mkStepBtn(+1));
            valWrap.appendChild(inpRow);
        } else {
            // STRING type — plain text input or multiline textarea, toggled per-node.
            const isMultiline = !!(this.anchor._vbMultilineStrings?.[node.id]);
            const inpRow = document.createElement("div");
            inpRow.style.cssText = "display:flex;align-items:stretch;gap:3px;width:100%;";

            if (isMultiline) {
                // Top-align row contents so action buttons don't sit centered
                // against a taller textarea.
                row.style.alignItems = "flex-start";
                valWrap.style.justifyContent = "flex-start";
            }

            const sharedStyle = `flex:1;min-width:0;box-sizing:border-box;padding:${Math.round(3 * sc)}px ${Math.round(6 * sc)}px;background:rgba(0,0,0,0.4);border:1px solid #30363d;border-radius:3px;color:${s.valueColor};font:${fs}px ${s.fontFamily};font-size:${fs}px;outline:none;`;

            if (isMultiline) {
                // Per-node textarea height stored as a ratio of rowH (e.g. 2 = rowH×2).
                if (!this.anchor._vbStringHeights) this.anchor._vbStringHeights = {};
                const taRatio = this.anchor._vbStringHeights[node.id] ?? 2;
                const taH = taRatio * rowH;
                const minTaH = rowH * 2;

                // Override the row's min-height to the actual content height so it is
                // never forced taller than the textarea by an inflated rowH value.
                row.style.minHeight = `${taH + 2 * padV}px`;

                const ta = document.createElement("textarea");
                ta.value = formatValue(curVal, meta.type);
                ta.dataset.vbNodeId = node.id; ta.dataset.vbWidget = wName; ta.dataset.vbType = meta.type;
                ta.style.cssText = sharedStyle + `resize:none;height:${taH}px;overflow-y:auto;line-height:1.4;flex:none;`;
                ta.rows = 2;
                ta.addEventListener("mousedown", e => e.stopPropagation());
                ta.addEventListener("focus", () => { ta.style.borderColor = meta.color; ta.style.color = "#fff"; });
                ta.addEventListener("blur", () => {
                    ta.style.borderColor = "#30363d"; ta.style.color = s.valueColor;
                    if (ta.dataset.cancelled) { delete ta.dataset.cancelled; ta.value = formatValue(valueW?.value ?? curVal, meta.type); return; }
                    if (valueW) { valueW.value = parseValue(ta.value, meta.type); node.setDirtyCanvas(true, false); }
                    ta.value = formatValue(valueW?.value ?? curVal, meta.type);
                });
                ta.addEventListener("keydown", e => {
                    e.stopPropagation();
                    // Shift+Enter submits; plain Enter adds newline
                    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); ta.blur(); }
                    if (e.key === "Escape") { ta.dataset.cancelled = "1"; ta.blur(); }
                });

                // Draggable bottom border for vertical resize — replaces + / − buttons.
                // Stores the new height as a ratio of rowH so it scales automatically
                // when the user later drags the panel corners.
                // Minimum ratio = 2 (minTaH = rowH × 2).
                const dragHandle = document.createElement("div");
                dragHandle.style.cssText = "height:8px;cursor:ns-resize;background:#21262d;flex-shrink:0;border-radius:0 0 3px 3px;border-top:1px solid #3d444d;margin-top:-1px;";
                dragHandle.title = "Drag to resize";
                dragHandle.onmouseenter = () => { dragHandle.style.background = "#30363d"; dragHandle.style.borderTopColor = "#8892a4"; };
                dragHandle.onmouseleave = () => { dragHandle.style.background = "#21262d"; dragHandle.style.borderTopColor = "#3d444d"; };
                dragHandle.addEventListener("mousedown", e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const canvasAnchored = !s.screenFixed && !(s.pinCorner && s.pinCorner !== "free");
                    const startY = e.clientY;
                    // Snapshot start height in pixels for accurate drag tracking.
                    const startTaH = (this.anchor._vbStringHeights?.[node.id] ?? 2) * rowH;
                    let rafPending = false;
                    const onMove = ev => {
                        const curSc = canvasAnchored ? (app.canvas?.ds?.scale ?? 1) : 1;
                        const dy = (ev.clientY - startY) / curSc;
                        const newTaH = Math.max(minTaH, startTaH + dy);
                        if (!this.anchor._vbStringHeights) this.anchor._vbStringHeights = {};
                        // Store as ratio so it scales automatically with userRowHeight.
                        this.anchor._vbStringHeights[node.id] = newTaH / rowH;
                        if (!rafPending) {
                            rafPending = true;
                            requestAnimationFrame(() => {
                                rafPending = false;
                                this._render();
                            });
                        }
                    };
                    const onUp = () => {
                        document.removeEventListener("mousemove", onMove);
                        document.removeEventListener("mouseup", onUp);
                        this._render();
                    };
                    document.addEventListener("mousemove", onMove);
                    document.addEventListener("mouseup", onUp);
                });

                const taWrap = document.createElement("div");
                taWrap.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;";
                taWrap.appendChild(ta);
                taWrap.appendChild(dragHandle);
                inpRow.appendChild(taWrap);
            } else {
                const inp = document.createElement("input");
                inp.type = "text";
                // Display newlines as ↵ so the user can see multiline content exists,
                // but track whether they actually edited the field to avoid writing
                // a newline-stripped value back to the widget on a mere focus+blur.
                const rawVal = String(valueW?.value ?? curVal ?? "");
                inp.value = rawVal.replace(/\n/g, "↵");
                let userEdited = false;
                inp.dataset.vbNodeId = node.id; inp.dataset.vbWidget = wName; inp.dataset.vbType = meta.type;
                inp.style.cssText = sharedStyle + `height:100%;`;
                inp.addEventListener("mousedown", e => e.stopPropagation());
                inp.addEventListener("focus", () => { inp.style.borderColor = meta.color; inp.style.color = "#fff"; inp.select(); });
                inp.addEventListener("input", () => { userEdited = true; });
                inp.addEventListener("blur", () => {
                    inp.style.borderColor = "#30363d"; inp.style.color = s.valueColor;
                    if (inp.dataset.cancelled) { delete inp.dataset.cancelled; inp.value = String(valueW?.value ?? curVal ?? "").replace(/\n/g, "↵"); userEdited = false; return; }
                    // Only write back if the user actually typed something; otherwise
                    // the ↵-substituted display value would clobber newlines in the widget.
                    if (userEdited && valueW) {
                        valueW.value = parseValue(inp.value, meta.type);
                        node.setDirtyCanvas(true, false);
                    }
                    inp.value = String(valueW?.value ?? curVal ?? "").replace(/\n/g, "↵");
                    userEdited = false;
                });
                inp.addEventListener("keydown", e => {
                    e.stopPropagation();
                    if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
                    if (e.key === "Escape") { inp.dataset.cancelled = "1"; inp.blur(); }
                });
                inpRow.appendChild(inp);
            }
            valWrap.appendChild(inpRow);
        }
        row.appendChild(valWrap);

        // ── Multiline toggle button (STRING only) ─────────────────────────────
        const isString = meta.type === "STRING";
        if (isString) {
            const isMultiline = !!(this.anchor._vbMultilineStrings?.[node.id]);
            const mlBtn = document.createElement("button");
            mlBtn.title = isMultiline ? "Switch to single-line" : "Switch to multiline";
            // Use a paragraph/lines icon: ¶ for multiline active, ≡ for single
            mlBtn.textContent = isMultiline ? "¶" : "≡";
            const mlActiveColor = isMultiline ? "#eaeaea" : "#8892a4";
            const mlActiveBorder = isMultiline ? "#8892a4" : "#30363d";
            mlBtn.style.cssText = `background:transparent;color:${mlActiveColor};border:1px solid ${mlActiveBorder};border-radius:3px;padding:0;cursor:pointer;font-size:${fs}px;flex-shrink:0;align-self:center;display:flex;align-items:center;justify-content:center;width:${btnSz}px;height:${btnSz}px;box-sizing:border-box;align-self:center;`;
            mlBtn.addEventListener("mousedown", e => e.stopPropagation());
            mlBtn.onmouseenter = () => { mlBtn.style.color = "#eaeaea"; mlBtn.style.borderColor = "#8892a4"; };
            mlBtn.onmouseleave = () => { mlBtn.style.color = mlActiveColor; mlBtn.style.borderColor = mlActiveBorder; };
            mlBtn.onclick = () => {
                if (!this.anchor._vbMultilineStrings) this.anchor._vbMultilineStrings = {};
                this.anchor._vbMultilineStrings[node.id] = !isMultiline;
                // Initialize ratio on first switch to multiline if not already stored.
                // The default ratio 2 means textarea height = 2 × userRowHeight.
                if (!isMultiline) {
                    if (!this.anchor._vbStringHeights) this.anchor._vbStringHeights = {};
                    if (this.anchor._vbStringHeights[node.id] == null) {
                        this.anchor._vbStringHeights[node.id] = 2;
                    }
                }
                this._render();
            };
            // Toggle button is always appended directly to the row.
            row.appendChild(mlBtn);
        }

        // ── Variable settings button (INT and FLOAT only — not SEED) ──────────
        if (isNumeric && !isSeed) {
            const settingsBtn = document.createElement("button");
            settingsBtn.textContent = "⚙";
            settingsBtn.title = "Variable settings (min / max / step)";
            const isOpen = () => !!document.getElementById(`__vb_varsettings_${node.id}`);
            const getActiveColor  = () => isOpen() ? "#eaeaea" : "#8892a4";
            const getActiveBorder = () => isOpen() ? "#8892a4" : "#30363d";
            settingsBtn.className = "__vb_row_btn";
            settingsBtn.style.cssText = `font-size:${fs}px;width:${btnSz}px;height:${btnSz}px;min-width:${btnSz}px;align-self:center;`;
            settingsBtn.style.color = getActiveColor();
            settingsBtn.style.borderColor = getActiveBorder();
            settingsBtn.addEventListener("mousedown", e => e.stopPropagation());
            settingsBtn.onmouseenter = () => { settingsBtn.style.color = "#eaeaea"; settingsBtn.style.borderColor = "#8892a4"; };
            settingsBtn.onmouseleave = () => { settingsBtn.style.color = getActiveColor(); settingsBtn.style.borderColor = getActiveBorder(); };
            settingsBtn.onclick = () => {
                const existing = document.getElementById(`__vb_varsettings_${node.id}`);
                if (existing) { existing.remove(); settingsBtn.style.color = "#8892a4"; settingsBtn.style.borderColor = "#30363d"; return; }

                // ── Floating var-settings popup ───────────────────────────────
                // Mounted on document.body as position:fixed so it floats freely
                // above all content and never overlaps or displaces other rows.
                // Width is clamped to a reasonable fraction of the viewport so it
                // remains legible on all screen sizes.
                const isFloat = meta.type === "FLOAT";
                const popup = document.createElement("div");
                popup.id = `__vb_varsettings_${node.id}`;
                popup.className = "__vb_varsettings";
                // No fixed width — let content determine it naturally.
                popup.style.fontSize = `${fs}px`;
                popup.style.background = this.settings.bgColor;

                // Position to the right of the panel, vertically aligned with the ⚙ button.
                // Store as pre-scale offsets from the board origin (dataset.offsetX/offsetY)
                // so _applyVarSettingsScale can recompute screen position every frame,
                // exactly as _applyFlyoutPosition does for the settings flyout.
                const btnRect = settingsBtn.getBoundingClientRect();
                const panelRect = this.el.getBoundingClientRect();
                const currentScale = (s.screenFixed || (s.pinCorner && s.pinCorner !== "free"))
                    ? 1 : (app.canvas?.ds?.scale ?? 1);
                const boardLeft = parseFloat(this.el.style.left) || 0;
                const boardTop  = parseFloat(this.el.style.top)  || 0;
                // Screen-space position we want: just to the right of the panel, aligned with button bottom.
                const wantLeft = panelRect.right + 6 * currentScale;
                const wantTop  = btnRect.bottom  + 4 * currentScale;
                // Convert to pre-scale offset from board origin.
                popup.dataset.offsetX = (wantLeft - boardLeft) / currentScale;
                popup.dataset.offsetY = (wantTop  - boardTop)  / currentScale;
                popup.style.left = `${wantLeft}px`;
                popup.style.top  = `${wantTop}px`;
                popup.style.transform = currentScale !== 1 ? `scale(${currentScale})` : "none";
                popup.style.transformOrigin = "top left";
                // Static layout, border, shadow live in .__vb_varsettings (varBoard.css).
                popup.addEventListener("mousedown", e => e.stopPropagation());
                popup.addEventListener("wheel", e => e.stopPropagation());

                // ── Popup header (drag handle + close) ────────────────────────
                const ph = document.createElement("div");
                ph.style.cssText = "display:flex;align-items:center;justify-content:space-between;"
                    + `padding:${Math.round(fs*0.55)}px ${Math.round(fs*0.9)}px ${Math.round(fs*0.45)}px;border-bottom:1px solid #202020;`
                    + "cursor:grab;border-radius:6px 6px 0 0;background:#0d1117;";
                const phTitle = document.createElement("span");
                phTitle.style.cssText = `font-size:${fs}px;font-weight:bold;color:${meta.color};pointer-events:none;`;
                phTitle.textContent = `⚙ ${label} — range`;
                const phClose = document.createElement("button");
                phClose.textContent = "×";
                phClose.className = "__vb_btn_close";
                phClose.style.fontSize = `${fs + 3}px`;
                phClose.addEventListener("mousedown", e => e.stopPropagation());
                phClose.onclick = () => { popup.remove(); settingsBtn.style.color = "#8892a4"; settingsBtn.style.borderColor = "#30363d"; };
                ph.appendChild(phTitle); ph.appendChild(phClose); popup.appendChild(ph);

                // Drag — remove the CSS transform during the drag so mouse delta
                // maps 1:1 to CSS position regardless of zoom level.
                // On mouseup, store the new CSS top-left as the anchor so that
                // _applyVarSettingsScale() re-applies zoom from the dragged position.
                ph.addEventListener("mousedown", e => {
                    if (e.target === phClose) return;
                    e.preventDefault(); e.stopPropagation();
                    ph.style.cursor = "grabbing";
                    const startX = e.clientX, startY = e.clientY;
                    const startOX = parseFloat(popup.dataset.offsetX) || 0;
                    const startOY = parseFloat(popup.dataset.offsetY) || 0;
                    const mv = ev => {
                        const sc = (s.screenFixed || (s.pinCorner && s.pinCorner !== "free"))
                            ? 1 : (app.canvas?.ds?.scale ?? 1);
                        popup.dataset.offsetX = startOX + (ev.clientX - startX) / sc;
                        popup.dataset.offsetY = startOY + (ev.clientY - startY) / sc;
                    };
                    const up = () => {
                        ph.style.cursor = "grab";
                        document.removeEventListener("mousemove", mv);
                        document.removeEventListener("mouseup", up);
                    };
                    document.addEventListener("mousemove", mv);
                    document.addEventListener("mouseup", up);
                });

                // ── Range inputs (min / max / step) ───────────────────────────
                const body = document.createElement("div");
                body.style.cssText = `display:flex;flex-direction:column;gap:${Math.round(fs*0.55)}px;padding:${Math.round(fs*0.9)}px ${Math.round(fs*1.1)}px ${Math.round(fs*1.1)}px;`;
                popup.appendChild(body);

                // inputRefs lets each field cross-validate against its siblings.
                const inputRefs = {};

                // flash() briefly highlights an input red to signal invalid input.
                const flash = inp => {
                    const prev = inp.style.borderColor;
                    inp.style.borderColor = "#f85149";
                    setTimeout(() => { inp.style.borderColor = prev; }, 600);
                };

                const mkField = (labelText, ovKey, curOvVal, opts = {}) => {
                    // opts.isInt      — parse as integer instead of float (default: !isFloat)
                    // opts.arrowStep  — how much ▲/▼ changes the value (default 1 for int, 0.1 for float)
                    // opts.min        — hard floor for arrow nudge (optional)
                    // opts.max        — hard ceiling for arrow nudge (optional)
                    // opts.commit     — custom save+validate fn(v, inp); if absent uses range-override logic
                    const parseAs  = (opts.isInt !== undefined ? opts.isInt : !isFloat) ? parseInt : parseFloat;
                    const arrowStep = opts.arrowStep !== undefined ? opts.arrowStep : (isFloat ? 0.1 : 1);

                    const row = document.createElement("div");
                    row.style.cssText = `display:flex;align-items:center;gap:${Math.round(fs*0.55)}px;`;
                    const lbl = document.createElement("label");
                    lbl.textContent = labelText;
                    lbl.style.cssText = `font-size:${fs}px;color:${s.labelColor};flex:0 0 ${Math.round(32*(fs/11))}px;text-align:right;`;

                    const inp = document.createElement("input");
                    inp.type = "text";
                    inp.placeholder = `${labelText.toLowerCase()} …`;
                    inp.value = curOvVal !== undefined ? String(curOvVal) : "";
                    inp.style.cssText = `flex:1;min-width:0;box-sizing:border-box;padding:${Math.round(fs*0.27)}px ${Math.round(fs*0.55)}px;background:rgba(0,0,0,0.5);border:1px solid #30363d55;border-radius:3px;color:#8892a4;font:${fs}px ${s.fontFamily};outline:none;`;
                    inputRefs[ovKey] = inp;

                    // Default commit: save to _vbRangeOverrides with cross-validation.
                    const defaultCommit = (v, inputEl) => {
                        if (!this.anchor._vbRangeOverrides) this.anchor._vbRangeOverrides = {};
                        if (!this.anchor._vbRangeOverrides[node.id]) this.anchor._vbRangeOverrides[node.id] = {};
                        const curMin  = ovKey === "min"  ? v : this._rangeVal(node.id, "min",  isFloat);
                        const curMax  = ovKey === "max"  ? v : this._rangeVal(node.id, "max",  isFloat);
                        const curStep = ovKey === "step" ? v : this._rangeVal(node.id, "step", isFloat);
                        let reject = false;
                        if (ovKey === "step" && v <= 0) reject = true;
                        if (ovKey === "min" && curMax !== null && v >= curMax) reject = true;
                        if (ovKey === "max" && curMin !== null && v <= curMin) reject = true;
                        if (reject) {
                            flash(inputEl);
                            inputEl.value = curOvVal !== undefined ? String(curOvVal) : "";
                            delete this.anchor._vbRangeOverrides[node.id][ovKey];
                            return false;
                        }
                        this.anchor._vbRangeOverrides[node.id][ovKey] = v;
                        return true;
                    };
                    const commitFn = opts.commit ?? defaultCommit;

                    inp.addEventListener("mousedown", e => e.stopPropagation());
                    inp.addEventListener("focus", () => { inp.style.borderColor = meta.color + "99"; inp.style.color = "#eaeaea"; inp.select(); });
                    inp.addEventListener("blur", () => {
                        inp.style.borderColor = "#30363d55"; inp.style.color = "#8892a4";
                        const raw = inp.value.trim();
                        if (raw === "") {
                            if (!this.anchor._vbRangeOverrides) this.anchor._vbRangeOverrides = {};
                            if (!this.anchor._vbRangeOverrides[node.id]) this.anchor._vbRangeOverrides[node.id] = {};
                            delete this.anchor._vbRangeOverrides[node.id][ovKey];
                        } else {
                            const v = parseAs(raw);
                            if (isNaN(v)) {
                                inp.value = curOvVal !== undefined ? String(curOvVal) : "";
                            } else {
                                commitFn(v, inp);
                            }
                        }
                        this._render();
                    });
                    inp.addEventListener("keydown", e => {
                        e.stopPropagation();
                        if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
                        if (e.key === "Escape") { inp.value = curOvVal !== undefined ? String(curOvVal) : ""; inp.blur(); }
                    });

                    // ── ▲ / ▼ arrow buttons ───────────────────────────────────
                    const btnCss = `flex-shrink:0;width:${Math.round(fs * 1.5)}px;height:${Math.round(fs * 1.5)}px;`
                        + `box-sizing:border-box;background:rgba(0,0,0,0.4);color:#8892a4;`
                        + `border:1px solid #30363d;border-radius:3px;padding:0;cursor:pointer;`
                        + `font-size:${Math.round(fs * 0.7)}px;line-height:1;display:flex;align-items:center;justify-content:center;`;

                    const mkArrow = (sign, symbol) => {
                        const btn = document.createElement("button");
                        btn.textContent = symbol;
                        btn.style.cssText = btnCss;
                        btn.title = sign > 0 ? `Increase ${labelText}` : `Decrease ${labelText}`;
                        btn.addEventListener("mousedown", e => e.stopPropagation());
                        btn.onmouseenter = () => { btn.style.color = "#eaeaea"; btn.style.borderColor = meta.color; };
                        btn.onmouseleave = () => { btn.style.color = "#8892a4"; btn.style.borderColor = "#30363d"; };
                        btn.onclick = () => {
                            const cur = parseAs(inp.value);
                            const base = isNaN(cur) ? (curOvVal !== undefined ? curOvVal : 0) : cur;
                            let next = isFloat && !opts.isInt
                                ? parseFloat((base + sign * arrowStep).toFixed(10))
                                : Math.round(base + sign * arrowStep);
                            if (opts.min !== undefined && next < opts.min) next = opts.min;
                            if (opts.max !== undefined && next > opts.max) next = opts.max;
                            inp.value = String(next);
                            const ok = commitFn(next, inp);
                            if (ok !== false) this._render();
                        };
                        return btn;
                    };

                    const arrowUp   = mkArrow(+1, "▲");
                    const arrowDown = mkArrow(-1, "▼");

                    row.appendChild(lbl);
                    row.appendChild(arrowDown);
                    row.appendChild(inp);
                    row.appendChild(arrowUp);
                    body.appendChild(row);
                };

                mkField("Min",  "min",  rangeOvr.min  !== undefined ? rangeOvr.min  : wMin);
                mkField("Max",  "max",  rangeOvr.max  !== undefined ? rangeOvr.max  : wMax);
                mkField("Step", "step", rangeOvr.step !== undefined ? rangeOvr.step : stepVal);

                // ── Decimals (FLOAT only) ─────────────────────────────────────
                // Controls the number of decimal places shown in the panel input.
                // Stored as rangeOvr.decimals; default is 2 when not set.
                if (isFloat) {
                    mkField("Dec", "decimals", rangeOvr.decimals !== undefined ? rangeOvr.decimals : 2, {
                        isInt: true,
                        arrowStep: 1,
                        min: 0,
                        max: 10,
                        commit: (v, inputEl) => {
                            if (v < 0 || v > 10) { flash(inputEl); inputEl.value = rangeOvr.decimals !== undefined ? String(rangeOvr.decimals) : ""; return false; }
                            if (!this.anchor._vbRangeOverrides) this.anchor._vbRangeOverrides = {};
                            if (!this.anchor._vbRangeOverrides[node.id]) this.anchor._vbRangeOverrides[node.id] = {};
                            this.anchor._vbRangeOverrides[node.id].decimals = v;
                            return true;
                        },
                    });
                }

                document.body.appendChild(popup);
                settingsBtn.style.color = "#eaeaea";
                settingsBtn.style.borderColor = "#8892a4";

                // Close when clicking outside the popup or its trigger button.
                setTimeout(() => {
                    const away = ev => {
                        if (!popup.contains(ev.target) && ev.target !== settingsBtn) {
                            popup.remove();
                            settingsBtn.style.color = "#8892a4";
                            settingsBtn.style.borderColor = "#30363d";
                            document.removeEventListener("mousedown", away);
                        }
                    };
                    document.addEventListener("mousedown", away, { signal: this._awayAC.signal });
                }, 50);
            };
            row.appendChild(settingsBtn);
        }

        // ── Seed: ice-cube freeze toggle + ▲/▼ post-run step toggles + dice ───
        if (isSeed && valueW) {
            const iceSz = Math.round(rowH - 6 * sc);

            const iceBtn     = document.createElement("button");
            const seedIncBtn = document.createElement("button");
            const seedDecBtn = document.createElement("button");
            const dice       = document.createElement("button");

            // setSeedCtrl(newCtrl) — central updater.
            // Updates _seedControl, the closed-over `locked` variable, and ALL
            // visual states in one place so no handler can leave things inconsistent.
            // newCtrl: "freeze" | "+1" | "-1" | null
            const setSeedCtrl = (newCtrl) => {
                this._seedControl.set(node.id, newCtrl);
                locked = newCtrl === "freeze";
                const isFreeze = locked;
                const isInc    = newCtrl === "+1";
                const isDec    = newCtrl === "-1";

                // ── Ice / Freeze button ──────────────────────────────────────
                iceBtn.title = isFreeze
                    ? "Seed is frozen — click to unfreeze"
                    : "Freeze seed — prevents randomisation";
                iceBtn.style.background   = isFreeze ? "rgba(125,211,252,0.15)" : "rgba(0,0,0,0.3)";
                iceBtn.style.borderColor  = isFreeze ? "#7dd3fc" : "#30363d";
                iceBtn.style.filter       = isFreeze ? "none" : "grayscale(0.6) opacity(0.5)";

                // ── +1 button ────────────────────────────────────────────────
                seedIncBtn.title = isInc
                    ? "Increment seed by 1 after each run — click to disable"
                    : "Increment seed by 1 after each run";
                seedIncBtn.style.background  = isInc ? "rgba(34,197,94,0.15)"  : "rgba(0,0,0,0.3)";
                seedIncBtn.style.borderColor = isInc ? "#4ade80" : "#30363d";
                seedIncBtn.style.color       = isInc ? "#4ade80" : "#8892a4";
                seedIncBtn.style.filter      = isInc ? "none" : "grayscale(0.6) opacity(0.5)";

                // ── −1 button ────────────────────────────────────────────────
                seedDecBtn.title = isDec
                    ? "Decrement seed by 1 after each run — click to disable"
                    : "Decrement seed by 1 after each run";
                seedDecBtn.style.background  = isDec ? "rgba(248,113,113,0.15)" : "rgba(0,0,0,0.3)";
                seedDecBtn.style.borderColor = isDec ? "#f87171" : "#30363d";
                seedDecBtn.style.color       = isDec ? "#f87171" : "#8892a4";
                seedDecBtn.style.filter      = isDec ? "none" : "grayscale(0.6) opacity(0.5)";

                // ── Dice button ──────────────────────────────────────────────
                dice.disabled      = isFreeze;
                dice.title         = isFreeze ? "Seed is frozen — click 🧊 to unfreeze" : "Randomise seed";
                dice.style.cursor  = isFreeze ? "not-allowed" : "pointer";
                dice.style.opacity = isFreeze ? "0.3" : "1";

                // ── Seed input box ───────────────────────────────────────────
                inp.disabled            = isFreeze;
                inp.style.cursor        = isFreeze ? "not-allowed" : "text";
                inp.style.background    = isFreeze ? "rgba(100,200,255,0.15)" : "rgba(0,0,0,0.4)";
                inp.style.borderColor   = isFreeze ? "#7dd3fc" : "#30363d";
                inp.style.boxShadow     = isFreeze ? "0 0 6px #7dd3fc40,inset 0 0 10px #7dd3fc15" : "";
                inp.style.letterSpacing = isFreeze ? "0.5px" : "";
                fillBar.style.background = isFreeze ? "#7dd3fc30" : `${meta.color}25`;
            };

            // ── Ice / Freeze toggle ──────────────────────────────────────────
            iceBtn.textContent = "🧊";
            // Base layout styles only — control-state styles applied by setSeedCtrl below.
            iceBtn.style.cssText = `border:1px solid;border-radius:4px;padding:0;width:${iceSz}px;height:${iceSz}px;cursor:pointer;font-size:${Math.round(iceSz * 0.65)}px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;align-self:center;transition:all 0.15s;`;
            iceBtn.addEventListener("mousedown", e => e.stopPropagation());
            iceBtn.onclick = () => {
                const cur = this._seedControl?.get(node.id) ?? null;
                setSeedCtrl(cur === "freeze" ? null : "freeze");
            };

            // ── +1 / −1 post-run toggle buttons ─────────────────────────────
            // Each button sets the "increment/decrement seed after each run"
            // mode.  Clicking an active button deactivates it (back to default).
            // Only one of the three mode buttons (🧊, +1, −1) can be active.
            const mkSeedCtrlBtn = (btn, mode) => {
                btn.textContent = mode === "+1" ? "▲" : "▼";
                // Base layout styles only — control-state styles applied by setSeedCtrl below.
                btn.style.cssText = `border:1px solid;border-radius:4px;padding:0;width:${iceSz}px;height:${iceSz}px;cursor:pointer;font-size:${Math.round(iceSz * 0.42)}px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;align-self:center;transition:all 0.15s;`;
                btn.addEventListener("mousedown", e => e.stopPropagation());
                btn.onclick = () => {
                    const cur = this._seedControl?.get(node.id) ?? null;
                    setSeedCtrl(cur === mode ? null : mode);
                };
            };
            mkSeedCtrlBtn(seedIncBtn, "+1");
            mkSeedCtrlBtn(seedDecBtn, "-1");

            // ── Dice (immediate randomise) ───────────────────────────────────
            dice.textContent = "⚄";
            dice.style.cssText = `background:#db6d28;color:#fff;border:none;border-radius:3px;padding:0;width:${iceSz}px;height:${iceSz}px;display:flex;align-items:center;justify-content:center;font-size:${Math.round(iceSz * 0.65)}px;flex-shrink:0;align-self:center;`;
            dice.addEventListener("mousedown", e => e.stopPropagation());
            dice.onclick = () => { if (locked || !valueW) return; const newSeed = randomSeed(); valueW.value = newSeed; node.setDirtyCanvas(true, false); if (inp) inp.value = formatValue(newSeed, meta.type); };

            // Apply the current control state to all buttons and the input in one pass.
            setSeedCtrl(this._seedControl?.get(node.id) ?? null);

            row.appendChild(iceBtn);
            row.appendChild(seedIncBtn);
            row.appendChild(seedDecBtn);
            row.appendChild(dice);
        }

        // Locate + Delete
        // font-size tracks the same `fs` used by all other row elements so the
        // em-based dimensions in .__vb_row_btn scale with both row height and
        // panel width.
        const loc = document.createElement("button");
        loc.textContent = "🎯"; loc.title = "Locate node on canvas";
        loc.className = "__vb_row_btn";
        loc.style.cssText = `font-size:${fs}px;width:${btnSz}px;height:${btnSz}px;min-width:${btnSz}px;align-self:center;`;
        loc.addEventListener("mousedown", e => e.stopPropagation());
        loc.onclick = () => { app.canvas.selectNode(node); app.canvas.centerOnNode(node); };
        row.appendChild(loc);

        const del = document.createElement("button");
        del.textContent = "×"; del.title = "Remove this variable node";
        del.className = "__vb_row_btn __vb_row_btn_del";
        del.style.cssText = `font-size:${fs}px;width:${btnSz}px;height:${btnSz}px;min-width:${btnSz}px;align-self:center;`;
        del.addEventListener("mousedown", e => e.stopPropagation());
        del.onclick = () => app.graph.remove(node);
        row.appendChild(del);

        container.appendChild(row);

        return container;
    }
    // ── Drag-and-drop reorder ─────────────────────────────────────────────────
    // Wires up pointer-event-based drag-to-reorder on the variable rows.
    //
    // When the user presses the ⠿ drag handle, we:
    //   1. Clone the row as a ghost element (fixed-position, semi-transparent)
    //      and remove the original row from the container so the remaining rows
    //      close the gap.
    //   2. Track pointermove on the container to move the ghost and compute
    //      which slot the cursor is hovering over, showing a dashed placeholder.
    //   3. On pointerup, recompute _vbOrder by splicing the dragged node into
    //      the drop slot, then call _render() to rebuild with the new order.
    //
    // Pointer capture is set on the container so the drag remains live even if
    // the cursor leaves the panel bounds.

    _setupDragDrop(container, nodes, rowH) {
        let dragging = null;
        let dropIndex = null;
        let placeholder = null;

        const getRows = () => [...container.querySelectorAll(":scope > div")];
        const removePlaceholder = () => { placeholder?.remove(); placeholder = null; };
        const insertPlaceholder = (idx) => {
            removePlaceholder();
            placeholder = document.createElement("div");
            placeholder.className = "__vb_drop_placeholder";
            placeholder.style.height = `${rowH}px`;
            const rows = getRows();
            if (idx >= rows.length) container.appendChild(placeholder);
            else container.insertBefore(placeholder, rows[idx]);
            dropIndex = idx;
        };

        const onMove = e => {
            if (!dragging) return;
            dragging.ghost.style.top = `${e.clientY - dragging.grabOffsetY}px`;
            const rows = getRows().filter(r => r !== placeholder);
            const mouseY = e.clientY;
            let newIdx = rows.length;
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i].getBoundingClientRect();
                if (mouseY < r.top + r.height / 2) { newIdx = i; break; }
            }
            if (newIdx !== dropIndex) insertPlaceholder(newIdx);
        };

        const onUp = () => {
            if (!dragging) return;
            dragging.ghost.remove();
            removePlaceholder();
            const order = [...nodes];
            order.splice(dragging.originIndex, 1);
            order.splice(dropIndex, 0, dragging.nodeRef);
            this.anchor._vbOrder = order.map(n => n.id);
            dragging = null; dropIndex = null;
            this._render();
        };

        container.addEventListener("pointermove", onMove);
        container.addEventListener("pointerup", onUp);

        container.querySelectorAll(".__vb_handle").forEach((handle, i) => {
            handle.addEventListener("pointerdown", e => {
                e.preventDefault(); e.stopPropagation();
                container.setPointerCapture(e.pointerId);
                const rowEl = handle.closest(".__vb_rows > div") || handle.parentElement;
                const rect = rowEl.getBoundingClientRect();
                const grabOffsetY = e.clientY - rect.top;
                const ghost = rowEl.cloneNode(true);
                // .__vb_drag_ghost provides the fixed-position overlay styling;
                // width/left/top must be set inline as they depend on the row's
                // live bounding rect.
                ghost.classList.add("__vb_drag_ghost");
                ghost.style.width  = `${rect.width}px`;
                ghost.style.left   = `${rect.left}px`;
                ghost.style.top    = `${e.clientY - grabOffsetY}px`;
                document.body.appendChild(ghost);
                rowEl.remove();
                dragging = { el: rowEl, nodeRef: nodes[i], originIndex: i, ghost, grabOffsetY };
                dropIndex = i;
                insertPlaceholder(i);
            });
        });
    }

    // ── Add variable dialog ───────────────────────────────────────────────────
    // _showAddDialog() opens a modal dialog that lets the user create one or
    // more VB variable nodes in a single action.
    //
    // The dialog shows a list of rows, each with a type <select> and a label
    // <input>.  Row 0 always has a + button (to append another row); all other
    // rows have a × button (to remove that row).
    //
    // Type selection behaviour:
    //   • The first row always defaults to INT, which is the most commonly used
    //     variable type.
    //   • When the user clicks the + button to add another row, the new row
    //     inherits the type of the *last* row in the list at the moment + is
    //     clicked.  This lets the user rapidly add multiple variables of the
    //     same type without re-selecting it each time.
    //
    // Label generation:
    //   • Each row is seeded with a default label derived from its type name.
    //   • When the type <select> changes and the current label looks like a
    //     generated default (i.e. "Integer", "Float_2", etc.), it is replaced
    //     with a fresh default for the newly selected type.
    //   • uniqueLabel() ensures every label is distinct from both already-
    //     existing variable nodes and from sibling rows in the same dialog.
    //
    // On confirmation, createVBNode() is called once per row in list order.
    // Empty labels are highlighted in accent blue and block submission.

    _showAddDialog() {
        // Prevent opening the dialog twice — guard on document, not this.el,
        // because the dialog is now mounted on body (free from the board panel).
        if (document.querySelector(".__vb_add")) return;

        // Type colors and human-readable labels used within the dialog only.
        const TYPE_COLORS = {
            FLOAT: "#175ab8", INT: "#1a6329", SEED: "#b55820",
            STRING: "#5a33a3", BOOL: "#228282",
            SAMPLER: "#bf831f", SCHEDULER: "#198758",
        };
        const TYPE_LABELS = {
            FLOAT: "Float", INT: "Integer", SEED: "Seed",
            STRING: "String", BOOL: "Bool",
            SAMPLER: "Sampler", SCHEDULER: "Scheduler",
        };
        // TYPE_LIST controls the order of options in every type <select>.
        // INT is listed first because it is the most common use case.
        const TYPE_LIST = ["INT", "FLOAT", "SEED", "STRING", "BOOL", "SAMPLER", "SCHEDULER"];

        // Derive font-size and scale from the actual panel dimensions (same as
        // the main panel rows) so the dialog appearance matches the panel.
        const s = this.settings;
        const sc_dlg = scaleFor(s.panelWidth ?? DEF_W);
        const rowH = rowHeightFrom(s);
        const fs = fontFromRow(rowH);
        // in the graph, used to ensure newly created nodes have unique labels.
        const getUsedLabels = () => getVBNodes().map(n => {
            const lw = n.widgets?.find(w => w.name === "label");
            return lw?.value || n.title || "";
        });
        // uniqueLabel() returns 'base' if it is not in use, otherwise appends
        // _2, _3, ... until an unused variant is found.  'extra' is a list of
        // sibling labels already chosen in this dialog session.
        const uniqueLabel = (base, extra = []) => {
            const all = [...getUsedLabels(), ...extra];
            if (!all.includes(base)) return base;
            let c = 2; while (all.includes(`${base}_${c}`)) c++;
            return `${base}_${c}`;
        };
        // currentLabels() collects all labels currently filled in within the
        // dialog, used as the 'extra' argument to uniqueLabel() so siblings
        // don't collide with each other.
        const currentLabels = () =>
            [...lblsList.querySelectorAll("input[data-lbl]")].map(i => i.value.trim()).filter(Boolean);

        // ── Dialog shell ──────────────────────────────────────────────────────
        // Mounted directly on document.body as position:fixed so it is
        // completely free from the board panel — it neither inherits the
        // canvas zoom transform nor disappears when the board re-renders.
        // Position is tracked every frame using the same board-relative offset
        // policy as the settings flyout (_applyAddDialogPosition).
        // Width is derived from the dialog's own content (type column + label
        // input min-width + button column + gaps + side padding) so it is
        // independent of the main panel width.
        const dlg = document.createElement("div");
        dlg.className = "__vb_add";
        // Static structure (position:fixed, z-index, border, border-radius,
        // box-shadow, font-family, color, user-select) lives in .__vb_add (varBoard.css).
        // Only dynamic values are set here.
        dlg.style.fontSize = `${fs}px`;
        // Width: control-column width (swatch + hex-input + reset button, all scaled
        // at fs/11) plus the longest label estimate (8.5 chars), one row-gap (0.6em)
        // and left+right padding (0.95em each), then capped at 90 % of the viewport
        // width so the dialog always fits on screen.  Floor of 220px for readability.
        const ctrlW = Math.round(44 * (fs / 11)) + 5 + Math.round(64 * (fs / 11)) + 5 + Math.round(14 * (fs / 11));
        const dlgW = Math.min(
            Math.round(window.innerWidth * 0.9),
            Math.max(220, ctrlW + Math.round(fs * 8.5) + Math.round(fs * 0.6) + Math.round(fs * 1.9))
        );
        dlg.style.width = `${dlgW}px`;
        dlg.style.background = s.bgColor;
        // Compute board-relative offset so _applyAddDialogPosition tracks the
        // board in exactly the same way as the settings flyout.  Default: screen-
        // centred horizontally, 20 % from the top — converted to pre-scale offsets
        // from the board's origin so they remain stable as the canvas zooms.
        if (!this._addDialogOffset) {
            const posScale = (s.screenFixed || (s.pinCorner && s.pinCorner !== "free"))
                ? 1 : (app.canvas?.ds?.scale ?? 1);
            const transScale = app.canvas?.ds?.scale ?? 1;
            const boardLeft = parseFloat(this.el?.style.left ?? "0") || 0;
            const boardTop  = parseFloat(this.el?.style.top  ?? "0") || 0;
            const screenLeft = (window.innerWidth  - dlgW * transScale) / 2;
            const screenTop  = Math.round(window.innerHeight * 0.2);
            this._addDialogOffset = {
                x: (screenLeft - boardLeft) / posScale,
                y: (screenTop  - boardTop)  / posScale,
            };
        }
        // Apply initial position immediately to avoid a one-frame visual jump.
        {
            const posScale = (s.screenFixed || (s.pinCorner && s.pinCorner !== "free"))
                ? 1 : (app.canvas?.ds?.scale ?? 1);
            const transScale = app.canvas?.ds?.scale ?? 1;
            const boardLeft = parseFloat(this.el?.style.left ?? "0") || 0;
            const boardTop  = parseFloat(this.el?.style.top  ?? "0") || 0;
            dlg.style.left = `${boardLeft + this._addDialogOffset.x * posScale}px`;
            dlg.style.top  = `${boardTop  + this._addDialogOffset.y * posScale}px`;
            dlg.style.transform = transScale !== 1 ? `scale(${transScale})` : "none";
            dlg.style.transformOrigin = "top left";
        }
        dlg.addEventListener("mousedown", e => e.stopPropagation());
        dlg.addEventListener("wheel", e => e.stopPropagation());

        // mk() is a micro-helper for creating styled elements with optional text.
        const mk = (tag, css = "", text = "") => {
            const el = document.createElement(tag);
            if (css) el.style.cssText = css;
            if (text) el.textContent = text;
            return el;
        };

        // ── Draggable header ──────────────────────────────────────────────────
        // Dragging updates _addDialogOffset (divided by scale so drag feels
        // 1:1 at any zoom level); the rAF loop repositions the dialog each frame.
        const hdr = mk("div",
            "display:flex;align-items:center;justify-content:space-between;"
            + "padding:10px 14px 8px;border-bottom:1px solid #202020;"
            + "cursor:grab;border-radius:8px 8px 0 0;background:#0d1117;");
        const hdrTitle = mk("span", `font-weight:bold;font-size:${fs + 2}px;color:${s.labelColor};pointer-events:none;`, "＋ Add Variable");
        const hdrClose = mk("button",
            `flex-shrink:0;font-size:${fs + 4}px;padding:0 2px;`);
        hdrClose.className = "__vb_btn_close";
        hdrClose.textContent = "×";
        hdrClose.title = "Close";
        hdrClose.addEventListener("mousedown", e => e.stopPropagation());
        hdrClose.onclick = () => close();
        hdr.appendChild(hdrTitle);
        hdr.appendChild(hdrClose);

        // Drag logic — deltas are in screen space; divide by the current canvas
        // scale to convert them to the pre-scale offset space stored in
        // _addDialogOffset.  Mirrors the settings flyout drag exactly.
        hdr.addEventListener("mousedown", e => {
            if (e.target === hdrClose) return;
            e.preventDefault(); e.stopPropagation();
            hdr.style.cursor = "grabbing";
            const startX = e.clientX, startY = e.clientY;
            const startOX = this._addDialogOffset?.x ?? 0;
            const startOY = this._addDialogOffset?.y ?? 0;
            const mv = e2 => {
                const sc = (s.screenFixed || (s.pinCorner && s.pinCorner !== "free"))
                    ? 1 : (app.canvas?.ds?.scale ?? 1);
                this._addDialogOffset = {
                    x: startOX + (e2.clientX - startX) / sc,
                    y: startOY + (e2.clientY - startY) / sc,
                };
            };
            const up = () => {
                hdr.style.cursor = "grab";
                document.removeEventListener("mousemove", mv);
                document.removeEventListener("mouseup", up);
            };
            document.addEventListener("mousemove", mv);
            document.addEventListener("mouseup", up);
        });
        dlg.appendChild(hdr);

        // Content area — padded separately so the header bar goes edge-to-edge.
        const body = mk("div", `padding:${Math.round(fs * 1.07)}px ${Math.round(fs * 1.38)}px ${Math.round(fs * 1.38)}px;`);
        dlg.appendChild(body);

        // ── Column headers ────────────────────────────────────────────────────
        // typeColW: wide enough to fit "SCHEDULER" at any font scale.
        const typeColW = Math.round(110 * (fs / 11));
        const colHdr = mk("div",
            `display:grid;grid-template-columns:${typeColW}px 1fr ${Math.round(Math.max(22,fs*1.7))}px;`
            + "gap:5px;margin-bottom:3px;");
        colHdr.appendChild(mk("span", `font-size:${fs}px;color:${s.labelColor};`, "Type"));
        colHdr.appendChild(mk("span", `font-size:${fs}px;color:${s.labelColor};`, "Label"));
        colHdr.appendChild(mk("span", ""));  // spacer over the button column
        body.appendChild(colHdr);

        // ── Row list container ────────────────────────────────────────────────
        const lblsList = mk("div",
            "display:flex;flex-direction:column;gap:5px;margin-bottom:14px;");
        body.appendChild(lblsList);

        // ── makeTypeSelect() ──────────────────────────────────────────────────
        // Creates a <select> pre-set to defaultType, with a colored border that
        // updates to match the chosen type.  SAMPLER and SCHEDULER options are
        // prefixed with a ▾ glyph so users can see they produce a dropdown in
        // the panel.  When the type changes and the label still looks like a
        // generated default, the label is auto-updated too.
        const COMBO_TYPES = new Set(["SAMPLER", "SCHEDULER"]);
        const typeLabel = t => COMBO_TYPES.has(t) ? `▾ ${TYPE_LABELS[t]}` : TYPE_LABELS[t];
        const makeTypeSelect = (defaultType = "INT") => {
            const sel = makeCustomSelect(
                TYPE_LIST.map(t => ({ value: t, label: typeLabel(t) })),
                defaultType,
                () => {
                    sel.style.borderColor = TYPE_COLORS[sel.value] + "99";
                    const row = sel.closest("[data-row]");
                    const inp = row?.querySelector("input[data-lbl]");
                    if (!inp) return;
                    const cur = inp.value.trim();
                    const isDefault = cur === "" || Object.values(TYPE_LABELS).some(v =>
                        cur === v || new RegExp(`^${v}_\\d+$`).test(cur));
                    if (isDefault) inp.value = uniqueLabel(TYPE_LABELS[sel.value], currentLabels());
                },
                this._awayAC.signal
            );
            sel.style.width = `${typeColW}px`;
            sel.style.flexShrink = "0";
            sel.style.borderRadius = "4px";
            sel.style.font = `${fs}px monospace`;
            sel.className = "__vb_select";
            sel.style.color = s.valueColor;
            sel.style.borderColor = TYPE_COLORS[defaultType] + "99";
            return sel;
        };

        // ── makeLabelInput() ──────────────────────────────────────────────────
        // Creates a text input for the variable label.  Enter confirms the
        // dialog; Escape closes it without creating nodes.
        const makeLabelInput = (val = "") => {
            const inp = mk("input",
                "flex:1;min-width:0;box-sizing:border-box;padding:4px 8px;"
                + "background:#0d1117;border:1px solid #202020;border-radius:4px;"
                + `color:${s.labelColor};font:${fs}px monospace;outline:none;`);
            inp.type = "text"; inp.autocomplete = "off"; inp.value = val;
            inp.dataset.lbl = "1";
            inp.addEventListener("mousedown", e => e.stopPropagation());
            inp.addEventListener("keydown", e => {
                e.stopPropagation();
                if (e.key === "Enter") confirm();
                if (e.key === "Escape") close();
            });
            return inp;
        };

        // ── makePlusBtn() ─────────────────────────────────────────────────────
        // The + button lives permanently in row 0.  When clicked it appends a
        // new row whose type defaults to the type of the *last* row currently
        // in the list — so rapidly clicking + to add many variables of the
        // same type works without re-selecting each time.
        const makePlusBtn = () => {
            const btnSz = Math.round(Math.max(22, fs * 1.7));
            const btn = mk("button",
                `flex-shrink:0;width:${btnSz}px;height:${btnSz}px;border-radius:4px;`
                + "border:1px solid #1a4a80;background:#0f3460;color:#7fb3f0;"
                + `font-size:${Math.round(fs * 1.3)}px;line-height:1;cursor:pointer;`);
            btn.textContent = "+";
            btn.title = "Add another variable";
            btn.addEventListener("mousedown", e => e.stopPropagation());
            btn.onmouseenter = () => btn.style.background = "#1a4a80";
            btn.onmouseleave = () => btn.style.background = "#0f3460";
            btn.onclick = () => {
                // Read the type from the LAST row in the list, not the first.
                // This way the user can pick a type on any row, then click + to
                // keep adding more variables of that same type.
                const allSelects = [...lblsList.querySelectorAll("[role='combobox']")];
                const lastSel = allSelects[allSelects.length - 1];
                const defType = lastSel ? lastSel.value : "INT";
                addRow(defType, uniqueLabel(TYPE_LABELS[defType], currentLabels()));
            };
            return btn;
        };

        // ── makeRemoveBtn() ───────────────────────────────────────────────────
        // The × button appears on all rows except row 0.  Clicking it removes
        // that row from the dialog without affecting the graph.
        const makeRemoveBtn = (rowEl) => {
            const btnSz = Math.round(Math.max(22, fs * 1.7));
            const btn = mk("button",
                `flex-shrink:0;width:${btnSz}px;height:${btnSz}px;border-radius:4px;`
                + "border:1px solid #202020;background:transparent;color:#8892a4;"
                + `font-size:${Math.round(fs * 1.3)}px;line-height:1;cursor:pointer;font-weight:bold;`);
            btn.textContent = "×";
            btn.title = "Remove this variable";
            btn.addEventListener("mousedown", e => e.stopPropagation());
            btn.onmouseenter = () => { btn.style.color = "#ff6b6b"; btn.style.borderColor = "#ff6b6b"; };
            btn.onmouseleave = () => { btn.style.color = "#8892a4"; btn.style.borderColor = "#202020"; };
            btn.onclick = () => rowEl.remove();
            return btn;
        };

        // ── addRow() ──────────────────────────────────────────────────────────
        // Appends a new row to lblsList.  Row 0 (isFirst=true) gets the +
        // button; all subsequent rows get the × remove button.  The label
        // input is focused after creation so the user can type immediately.
        const addRow = (type = "INT", val = "", isFirst = false) => {
            const row = mk("div",
                `display:grid;grid-template-columns:${typeColW}px 1fr ${Math.round(Math.max(22,fs*1.7))}px;gap:5px;align-items:center;`);
            row.dataset.row = "1";
            const sel = makeTypeSelect(type);
            const inp = makeLabelInput(val);
            const btn = isFirst ? makePlusBtn() : makeRemoveBtn(row);
            row.appendChild(sel);
            row.appendChild(inp);
            row.appendChild(btn);
            lblsList.appendChild(row);
            requestAnimationFrame(() => { inp.focus(); inp.select(); });
            return row;
        };

        // ── confirm() / close() ───────────────────────────────────────────────
        // confirm() validates that no labels are empty (highlighting empties in
        // accent blue), then calls createVBNode() for each row in order.
        // close() simply removes the dialog without creating anything.
        // close() resets _addDialogOffset so the next open starts fresh.
        const close = () => { dlg.remove(); this._addDialogOffset = null; };
        const confirm = () => {
            const rows = [...lblsList.querySelectorAll("[data-row]")];
            let bad = false;
            rows.forEach(row => {
                const inp = row.querySelector("input[data-lbl]");
                if (!inp) return;
                inp.style.borderColor = "#202020";
                if (!inp.value.trim()) { inp.style.borderColor = "#3b82f6"; bad = true; }
            });
            if (bad) return;
            rows.forEach(row => {
                const inp = row.querySelector("input[data-lbl]");
                const sel = row.querySelector("[role='combobox']");
                if (!inp || !sel) return;
                const label = inp.value.trim();
                const type = sel.value;
                if (!label) return;
                createVBNode(type, this.anchor, label);
            });
            close();
            // After batch node creation the panel re-renders and grows; schedule
            // extra size syncs so the canvas node footprint catches up correctly.
            setTimeout(() => this._syncNodeSize(), 150);
            setTimeout(() => this._syncNodeSize(), 400);
        };

        // ── Action buttons row ────────────────────────────────────────────────
        const btnsRow = mk("div", "display:flex;gap:6px;");
        const addBtn = mk("button",
            "flex:1;padding:7px;background:#0f3460;border:none;border-radius:4px;"
            + `color:#eaeaea;font:${fs}px monospace;cursor:pointer;`, "Add");
        addBtn.addEventListener("mousedown", e => e.stopPropagation());
        addBtn.onclick = confirm;
        const cancelBtn = mk("button",
            "flex:1;padding:7px;background:#21262d;border:none;border-radius:4px;"
            + `color:#8b949e;font:${fs}px monospace;cursor:pointer;`, "Cancel");
        cancelBtn.addEventListener("mousedown", e => e.stopPropagation());
        cancelBtn.onclick = close;
        btnsRow.appendChild(addBtn); btnsRow.appendChild(cancelBtn);
        body.appendChild(btnsRow);

        // Mount on document.body — completely free from the board panel.
        // The dialog is position:fixed so it stays put regardless of canvas
        // pan/zoom and survives board re-renders without any detach/re-attach.
        document.body.appendChild(dlg);

        // Seed row 0 with INT as the first type — the most common variable type.
        // isFirst=true gives this row the + button instead of a × button.
        addRow("INT", uniqueLabel("Integer", []), true);

        // Close the dialog if the user clicks anywhere outside it.
        // The 50ms delay prevents the click that opened the dialog from
        // immediately triggering the away-click listener.
        setTimeout(() => {
            const away = ev => {
                if (!dlg.contains(ev.target)) { close(); document.removeEventListener("mousedown", away); }
            };
            document.addEventListener("mousedown", away, { signal: this._awayAC.signal });
        }, 50);
    }
    // ── Utility button builders ───────────────────────────────────────────────
    // _makeBtn() creates a simple styled <button> that stops mousedown
    // propagation so clicks on it don't accidentally interact with the canvas.
    //
    // _stepBtn() is a variant used for the ↑ / ↓ step buttons on value inputs.
    // It adds hover color transitions and accepts an onClick callback directly.

    _makeBtn(text, bg, color, fs = 11) {
        const b = document.createElement("button");
        b.textContent = text;
        // Font and padding derived from fs (rowH-based) so button scales with row height.
        b.style.cssText = `background:${bg};color:${color};border:none;border-radius:4px;padding:${Math.round(fs * 0.45)}px ${Math.round(fs * 0.9)}px;cursor:pointer;font-family:monospace;font-size:${fs}px;`;
        b.addEventListener("mousedown", e => e.stopPropagation());
        return b;
    }

    _stepBtn(label, onClick, sc = 1) {
        const b = document.createElement("button");
        b.textContent = label;
        b.style.cssText = `background:rgba(0,0,0,0.3);color:#8892a4;border:1px solid #30363d;border-radius:3px;padding:1px ${Math.round(5 * sc)}px;cursor:pointer;font-size:${Math.round(12 * sc)}px;font-family:monospace;flex-shrink:0;line-height:1.4;`;
        b.addEventListener("mousedown", e => e.stopPropagation());
        b.addEventListener("mouseover", () => { b.style.color = "#eaeaea"; b.style.borderColor = "#8892a4"; });
        b.addEventListener("mouseout", () => { b.style.color = "#8892a4"; b.style.borderColor = "#30363d"; });
        b.onclick = onClick;
        return b;
    }

    // ── Canvas node size sync ─────────────────────────────────────────────────
    // _syncNodeSize() keeps the LiteGraph canvas node footprint in sync with
    // the DOM panel's actual rendered dimensions so the node selection box and
    // the visual overlay match.
    //
    // Width is read from _vbSettings.panelWidth (the authoritative value) rather
    // than el.offsetWidth, which can return stale intermediate values mid-reflow.
    // Height is always content-driven, so we read el.offsetHeight directly.

    _syncNodeSize() {
        if (!this.el || !this.anchor) return;
        const s = this.anchor._vbSettings;
        const w = s?.panelWidth ?? DEF_W;
        // Height is always content-driven — read from live DOM.
        const h = this.el.offsetHeight;
        let dirty = false;
        if (this.anchor.size[0] !== w) { this.anchor.size[0] = w; dirty = true; }
        if (this.anchor.size[1] !== h) { this.anchor.size[1] = h; dirty = true; }
        if (dirty) this.anchor.setDirtyCanvas(true, true);
    }

    // _rangeVal() reads the current effective value for a range key ("min",
    // "max", or "step") for a given node.  Returns the override value if set,
    // otherwise null.  Used by the var-settings popup to cross-validate inputs.
    _rangeVal(nodeId, key, isFloat) {
        const ovr = this.anchor._vbRangeOverrides?.[nodeId];
        if (ovr && ovr[key] !== undefined) return ovr[key];
        return null;
    }

    // ── In-place value/label update ───────────────────────────────────────────
    // _updateInputsInPlace() is the lightweight alternative to a full _render()
    // used when only values or labels changed on existing nodes (no nodes were
    // added or removed).  It iterates over all live input elements that carry
    // a data-vb-node-id attribute and updates their value from the corresponding
    // widget — but only if the input is not currently focused, to avoid
    // interrupting the user while they are typing.

    // ── Post-run seed stepping ────────────────────────────────────────────────
    // _stepSeedControls() applies the +1 / −1 control mode to every seed node
    // whose control is set to "+1" or "-1".  Called after each queuePrompt so
    // that the seed changes AFTER a run completes — matching KSampler behaviour.
    _stepSeedControls() {
        if (!this.anchor) return;
        const nodes = getVBNodes(this.anchor._vbOrder ?? []);
        for (const node of nodes) {
            if (node.comfyClass !== "VB_Seed") continue;
            const ctrl = this._seedControl?.get(node.id);
            if (ctrl !== "+1" && ctrl !== "-1") continue;
            const valueW = node.widgets?.find(w => w.name === "seed");
            if (!valueW) continue;
            const cur = typeof valueW.value === "number" ? valueW.value : parseInt(valueW.value) || 0;
            valueW.value = Math.max(0, cur + (ctrl === "+1" ? 1 : -1));
            node.setDirtyCanvas(true, false);
        }
    }

    _updateInputsInPlace() {
        if (!this.el) return;
        this.el.querySelectorAll("input[data-vb-node-id], textarea[data-vb-node-id]").forEach(inp => {
            // Skip only writable (non-readOnly) focused inputs: the user may be
            // actively typing and we must not clobber their in-progress edit.
            // readOnly inputs can become activeElement during a horizontal drag
            // without accepting text input, so they are safe to update.
            if (inp === document.activeElement && !inp.readOnly) return;
            const node = app.graph.getNodeById(parseInt(inp.dataset.vbNodeId));
            if (!node) return;
            const w = node.widgets?.find(w => w.name === inp.dataset.vbWidget);
            if (!w) return;
            // Single-line string inputs display newlines as ↵ so multiline content
            // is visible without clobbering the widget's actual newline characters.
            const raw = formatValue(w.value, inp.dataset.vbType, inp.dataset.vbDecimals !== undefined ? parseInt(inp.dataset.vbDecimals) : null);
            const fresh = (inp.tagName === "INPUT" && inp.dataset.vbType === "STRING")
                ? String(w.value ?? "").replace(/\n/g, "↵")
                : raw;
            if (inp.value !== fresh) inp.value = fresh;

            // Keep the fill bar in sync for numeric (INT / FLOAT / SEED) rows.
            // The fill bar element carries data-vb-fill=nodeId so we can find it
            // from inside _updateInputsInPlace without a closure reference.
            const fillBar = inp.parentElement?.querySelector(`[data-vb-fill="${node.id}"]`);
            if (fillBar) {
                const fMin = parseFloat(fillBar.dataset.vbFillMin);
                const fMax = parseFloat(fillBar.dataset.vbFillMax);
                const num  = typeof w.value === "number" ? w.value : parseValue(raw, inp.dataset.vbType);
                if (!isNaN(fMin) && !isNaN(fMax) && fMax > fMin) {
                    const pct = Math.max(0, Math.min(1, (num - fMin) / (fMax - fMin))) * 100;
                    fillBar.style.width   = `${pct}%`;
                    fillBar.style.display = "";
                } else {
                    fillBar.style.display = "none";
                }
            }
        });

        // Update BOOL custom toggle switches (div[data-vb-type="BOOL"]) in-place.
        this.el.querySelectorAll("div[data-vb-type='BOOL'][data-vb-node-id]").forEach(track => {
            const node = app.graph.getNodeById(parseInt(track.dataset.vbNodeId));
            if (!node) return;
            const w = node.widgets?.find(w => w.name === track.dataset.vbWidget);
            if (!w) return;
            const checked = !!w.value;
            const color   = track.dataset.vbToggleColor ?? "#888";
            const trackW  = parseInt(track.dataset.vbTrackW)  || 36;
            const thumbSz = parseInt(track.dataset.vbThumbSz) || 14;
            const thumbPad = parseInt(track.dataset.vbThumbPad) || 3;
            track.style.background = checked ? color : "#444";
            const thumb = track.firstElementChild;
            if (thumb) thumb.style.left = `${checked ? (trackW - thumbSz - thumbPad) : thumbPad}px`;
            // Update the adjacent label span.
            const lbl = track.parentElement?.querySelector(`[data-vb-toggle-lbl="${node.id}"]`);
            if (lbl) lbl.textContent = checked ? "true" : "false";
        });

        // Update COMBO selects (SAMPLER / SCHEDULER) in-place.
        // Custom selects are <div role="combobox"> elements, not <select>.
        this.el.querySelectorAll("[role='combobox'][data-vb-node-id]").forEach(sel => {
            if (sel.listEl) return; // don't disrupt open dropdowns
            const node = app.graph.getNodeById(parseInt(sel.dataset.vbNodeId));
            if (!node) return;
            const w = node.widgets?.find(w => w.name === sel.dataset.vbWidget);
            if (!w) return;
            const fresh = String(w.value ?? "");
            if (sel.value !== fresh) sel.value = fresh;
        });

        this.el.querySelectorAll("[data-vb-label]").forEach(div => {
            const node = app.graph.getNodeById(parseInt(div.dataset.vbLabel));
            if (!node) return;
            const labelW = node.widgets?.find(w => w.name === "label");
            const fresh = labelW?.value || node.title || "";
            if (div.textContent !== fresh) div.textContent = fresh;
        });
    }

    // ── Inline label rename ───────────────────────────────────────────────────
    // _startInlineRename() replaces the label <div> with a text <input> so the
    // user can rename the variable directly in the panel row.  The label <div>
    // is hidden (not removed) so it snaps back into place after blur.
    // Enter commits; Escape cancels and restores the original text.

    _startInlineRename(lbl, labelW, node) {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = labelW.value || node.title || "";
        inp.style.cssText = "width:100%;box-sizing:border-box;padding:1px 4px;background:#0d1117;border:1px solid #3b82f6;border-radius:3px;color:#fff;font:11px monospace;outline:none;";
        inp.addEventListener("mousedown", e => e.stopPropagation());
        inp.addEventListener("keydown", e => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
            if (e.key === "Escape") { inp.dataset.cancelled = "1"; inp.blur(); }
        });
        inp.addEventListener("blur", () => {
            const name = inp.value.trim();
            if (!inp.dataset.cancelled && name) { labelW.value = name; node.title = name; node.setDirtyCanvas(true, false); }
            lbl.textContent = labelW.value || node.title || "";
            lbl.style.display = "";
            inp.remove();
        });
        lbl.style.display = "none";
        lbl.parentElement.insertBefore(inp, lbl.nextSibling);
        requestAnimationFrame(() => { inp.focus(); inp.select(); });
    }

    // ── Settings flyout ───────────────────────────────────────────────────────
    // _toggleSettings() opens or closes the settings flyout.  If one is already
    // open (identified by its id "__vb_settings_fly") it is removed; otherwise
    // _showSettingsPanel() is called to create and attach a new one.
    //
    // _showSettingsPanel() creates the flyout as a child of this.el (the main
    // panel element) using position:absolute.  This is critical: because this.el
    // already receives a CSS transform:scale() from _applyPosition(), the flyout
    // automatically inherits that scale and zooms with the canvas — no extra
    // positioning logic needed.
    //
    // The flyout can be dragged within this.el using its header grip.  Mouse
    // deltas are divided by the current canvas scale so the drag feels 1:1
    // regardless of zoom level.
    //
    // The flyout is preserved across _render() calls by detaching and
    // re-attaching it before/after innerHTML = "" in _render().

    _toggleSettings() {
        const existing = document.getElementById("__vb_settings_fly");
        if (existing) { existing.remove(); this._settingsOpen = false; this._flyoutOffset = null; return; }
        this._settingsOpen = true;
        this._showSettingsPanel();
    }

    _showSettingsPanel() {
        // Derive font-size and scale from the actual panel dimensions (same as
        // the main panel rows) so the flyout appearance matches the panel.
        const s = this.settings;
        const sc_hdr = scaleFor(s.panelWidth ?? DEF_W);
        const rowH = rowHeightFrom(s);
        const fs = fontFromRow(rowH);
        // Match the font size used by the hex-color inputs in _makeColorControl
        // so that all right-side controls in the settings rows are visually
        // consistent: both dropdowns and hex inputs scale at 10px × (fs/11).
        const selectFs = Math.round(10 * (fs / 11));
        const boardW = this.anchor._vbSettings?.panelWidth ?? DEF_W;
        // Total width shared by dropdown selects and color picker controls so
        // all right-side controls in the settings rows are visually aligned.
        // Mirrors the components of _makeColorControl: swatch(44) + gap(5) +
        // hex input(64) + gap(5) + reset button(~14) — all scaled at fs/11.
        const ctrlW = Math.round(44 * (fs / 11)) + 5 + Math.round(64 * (fs / 11)) + 5 + Math.round(14 * (fs / 11));

        const panel = document.createElement("div");
        panel.id = "__vb_settings_fly";
        panel.className = "__vb_settings";

        // The flyout is position:fixed on body and is repositioned every frame
        // by _applyPosition() so it zooms and moves in lock-step with the board.
        // We store its position as a pre-scale CSS-pixel offset from the board's
        // own left/top (i.e. in the same coordinate space that _applyPosition
        // uses for the board element).  Default: open to the right of the board.
        // Only set the default when not already set (e.g. restoring after preset
        // load preserves the user's dragged position by pre-setting _flyoutOffset).
        if (!this._flyoutOffset) this._flyoutOffset = { x: boardW + 10, y: 0 };

        // Width budget: label column (longest label "Icon animation" ≈ 14 chars at
        // monospace ≈ fs×8.5 px) + one row-gap (0.6em) + control column (ctrlW) +
        // extra width for the "coming soon" badge next to the Position-mode dropdown
        // (gap 6px + text ≈ fs×0.85×11×0.6 ≈ fs×5.6, rounded to fs×6)
        // + left+right padding (0.95em each).  The result is capped at 90 % of the
        // viewport width so the flyout always fits on screen regardless of resolution,
        // and floored at 260 px for readability at tiny font sizes.
        const flyW = Math.min(
            Math.round(window.innerWidth * 0.9),
            Math.max(260, ctrlW + Math.round(fs * 8.5) + Math.round(fs * 0.6) + Math.round(fs * 1.9))
        );
        panel.style.cssText = [
            // Dynamic values that vary per-panel or per-render:
            `font-size:${fs}px`,
            `font-family:monospace`,
            `width:${flyW}px`,
            "left:0px", "top:0px",  // repositioned each frame by _applyPosition
            `background:#0d1117`,
        ].join(";");
        // Static layout, borders live in .__vb_settings (varBoard.css).
        panel.addEventListener("mousedown", e => e.stopPropagation());
        panel.addEventListener("wheel", e => e.stopPropagation());

        // Close the flyout when the user clicks anywhere outside it.
        setTimeout(() => {
            const away = ev => {
                const btn = this.el?.querySelector(".__vb_settings_btn");
                if (!panel.contains(ev.target) && ev.target !== btn) {
                    panel.remove(); this._settingsOpen = false; this._flyoutOffset = null;
                    document.removeEventListener("mousedown", away);
                }
            };
            document.addEventListener("mousedown", away, { signal: this._awayAC.signal });
        }, 50);

        // ── Draggable header ──────────────────────────────────────────────────
        const flyHdr = document.createElement("div");
        flyHdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;"
            + `padding:${Math.round(fs * 0.6)}px ${Math.round(fs * 0.95)}px;border-bottom:1px solid #202020;`
            + "cursor:grab;border-radius:8px 8px 0 0;background:" + s.bgColor + ";flex-shrink:0;";
        flyHdr.title = "Drag to move";
        const flyTitle = document.createElement("span");
        flyTitle.style.cssText = `font-weight:bold;font-size:${fs + 1}px;color:${s.labelColor};user-select:none;pointer-events:none;`;
        flyTitle.textContent = "⚙ Panel Settings";
        const flyClose = document.createElement("button");
        flyClose.textContent = "×";
        flyClose.className = "__vb_btn_close";
        flyClose.style.fontSize = `${fs + 4}px`;
        flyClose.style.padding = "0 4px";
        flyClose.addEventListener("mousedown", e => e.stopPropagation());
        flyClose.onclick = () => { panel.remove(); this._settingsOpen = false; this._flyoutOffset = null; };
        flyHdr.appendChild(flyTitle); flyHdr.appendChild(flyClose);
        panel.appendChild(flyHdr);

        // Drag — deltas are in screen space; divide by the current canvas scale
        // to convert them to the pre-scale CSS-pixel offset space we store in
        // _flyoutOffset.  This keeps the drag feeling 1:1 at any zoom level.
        flyHdr.addEventListener("mousedown", e => {
            if (e.target === flyClose) return;
            e.preventDefault(); e.stopPropagation();
            flyHdr.style.cursor = "grabbing";
            const startX = e.clientX, startY = e.clientY;
            const startOX = this._flyoutOffset?.x ?? 0;
            const startOY = this._flyoutOffset?.y ?? 0;
            const mv = e2 => {
                const sc = (s.screenFixed || (s.pinCorner && s.pinCorner !== "free"))
                    ? 1 : (app.canvas?.ds?.scale ?? 1);
                this._flyoutOffset = {
                    x: startOX + (e2.clientX - startX) / sc,
                    y: startOY + (e2.clientY - startY) / sc,
                };
            };
            const up = () => {
                flyHdr.style.cursor = "grab";
                document.removeEventListener("mousemove", mv);
                document.removeEventListener("mouseup", up);
            };
            document.addEventListener("mousemove", mv);
            document.addEventListener("mouseup", up);
        });

        // Content area — padded separately so the header goes edge-to-edge.
        const content = document.createElement("div");
        content.style.cssText = `display:flex;flex-direction:column;gap:${Math.round(fs * 0.6)}px;padding:${Math.round(fs * 0.8)}px ${Math.round(fs * 0.95)}px ${Math.round(fs * 0.95)}px;overflow-x:hidden;`;
        panel.appendChild(content);

        // addRow() wraps a label + control into a flex row inside a target container.
        const addRow = (labelText, control, target = content) => {
            const row = document.createElement("div");
            row.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:${Math.round(fs * 0.6)}px;flex-wrap:wrap;`;
            const lbl = document.createElement("label");
            lbl.style.cssText = `font-size:${fs}px;color:${s.labelColor};flex-shrink:1;min-width:0;`;
            lbl.textContent = labelText;
            // The control must never shrink or wrap — it holds its measured width.
            control.style.flexShrink = "0";
            row.appendChild(lbl);
            row.appendChild(control);
            target.appendChild(row);
            return row;
        };

        const addColorRow = addRow;

        // mkComingSoon() creates a small italic badge used next to disabled controls.
        const mkComingSoon = () => {
            const el = document.createElement("span");
            el.textContent = "coming soon";
            el.style.cssText = `font-size:${Math.round(fs * 0.85)}px;color:#484f58;font-style:italic;`;
            return el;
        };

        // mkGroup() creates a rounded-border rectangle grouping container appended to content.
        const mkGroup = () => {
            const g = document.createElement("div");
            g.style.cssText = `display:flex;flex-direction:column;gap:${Math.round(fs * 0.55)}px;`
                + `border:1px solid ${s.accentColor ?? ACCENT};border-radius:5px;`
                + `padding:${Math.round(fs * 0.55)}px ${Math.round(fs * 0.65)}px;`;
            content.appendChild(g);
            return g;
        };

        // ── Appearance group: Background color, Text color, Value color,
        //                      Icon color, Icon shape, Icon animation, Font family ──
        const appearanceGroup = mkGroup();

        // Background color
        addColorRow("Background color", this._makeColorControl(
            s.bgColor,
            color => {
                this.anchor._vbSettings.bgColor = color;
                this.el.style.background = color;
                flyHdr.style.background = color;
                document.querySelectorAll(".__vb_varsettings").forEach(p => { p.style.background = color; });
            },
            fs
        ), appearanceGroup);

        // Text color
        addColorRow("Text color", this._makeColorControl(
            s.labelColor,
            color => {
                this.anchor._vbSettings.labelColor = color;
                this.el.querySelectorAll("[data-vb-label]").forEach(d => d.style.color = color);
                document.querySelectorAll(".__vb_varsettings").forEach(p => {
                    p.style.color = color;
                    p.querySelectorAll("label").forEach(l => { l.style.color = color; });
                });
                flyTitle.style.color = color;
                panel.querySelectorAll("label").forEach(l => { l.style.color = color; });
                presetsLabel.style.color = color;
            },
            fs
        ), appearanceGroup);

        // Value color
        addColorRow("Value color", this._makeColorControl(
            s.valueColor,
            color => {
                this.anchor._vbSettings.valueColor = color;
                this.el.querySelectorAll("input[data-vb-node-id]").forEach(i => { if (i !== document.activeElement) i.style.color = color; });
                this.el.querySelectorAll("[data-vb-toggle-lbl]").forEach(el => { el.style.color = color; });
                document.querySelectorAll(".__vb_select, .__vb_input_sm").forEach(el => { el.style.color = color; });
            },
            fs
        ), appearanceGroup);

        // Icon color
        addColorRow("Icon color", this._makeColorControl(
            s.accentColor ?? ACCENT,
            color => {
                this.anchor._vbSettings.accentColor = color;
                applyAnimCSS(color);
                const iconSvg = this.el.querySelector(".__vb_panel_hdr svg");
                if (iconSvg) {
                    iconSvg.replaceWith(makeHeaderIcon(s.iconShape ?? "panel-rows", s.iconStyle, color, scaleFor(this.settings.panelWidth ?? DEF_W)));
                    this._lastIconColor = color;
                }
            },
            fs
        ), appearanceGroup);

        // Icon shape
        const shapeSel = makeCustomSelect(
            Object.entries(ICON_SHAPES).map(([key, def]) => ({ value: key, label: def.label })),
            s.iconShape ?? "panel-rows",
            () => {
                this.anchor._vbSettings.iconShape = shapeSel.value;
                const iconSvg = this.el.querySelector(".__vb_panel_hdr svg");
                if (iconSvg) {
                    iconSvg.replaceWith(makeHeaderIcon(shapeSel.value, s.iconStyle, s.accentColor ?? ACCENT, scaleFor(this.settings.panelWidth ?? DEF_W)));
                    this._lastIconShape = shapeSel.value;
                }
            },
            this._awayAC.signal
        );
        shapeSel.className = "__vb_select";
        shapeSel.style.color = s.valueColor;
        shapeSel.style.fontSize = `${selectFs}px`;
        shapeSel.style.width = `${ctrlW}px`;
        addRow("Icon shape", shapeSel, appearanceGroup);

        // Icon animation
        const iconSel = makeCustomSelect(
            [{ value: "pulse", label: "Pulse" }, { value: "flicker", label: "Flicker" }, { value: "glow", label: "Glow" }, { value: "none", label: "None" }],
            s.iconStyle ?? "none",
            () => {
                this.anchor._vbSettings.iconStyle = iconSel.value;
                const iconSvg = this.el.querySelector(".__vb_panel_hdr svg");
                if (iconSvg) {
                    iconSvg.replaceWith(makeHeaderIcon(s.iconShape ?? "panel-rows", iconSel.value, s.accentColor ?? ACCENT, scaleFor(this.settings.panelWidth ?? DEF_W)));
                    this._lastIconStyle = iconSel.value;
                }
            },
            this._awayAC.signal
        );
        iconSel.className = "__vb_select";
        iconSel.style.color = s.valueColor;
        iconSel.style.fontSize = `${selectFs}px`;
        iconSel.style.width = `${ctrlW}px`;
        addRow("Icon animation", iconSel, appearanceGroup);

        // Font family
        const fontSel = makeCustomSelect(
            ["monospace", "sans-serif", "serif", "system-ui", "'Courier New'", "'Consolas'"].map(f => ({ value: f, label: f.replace(/'/g, "") })),
            s.fontFamily ?? "monospace",
            () => {
                this.anchor._vbSettings.fontFamily = fontSel.value;
                this._render();
            },
            this._awayAC.signal
        );
        fontSel.className = "__vb_select";
        fontSel.style.color = s.valueColor;
        fontSel.style.fontSize = `${selectFs}px`;
        fontSel.style.width = `${ctrlW}px`;
        addRow("Font family", fontSel, appearanceGroup);

        // ── Options group: Optional drag areas, Colored nodes, Hide datatype ──
        const optionsGroup = mkGroup();

        // Optional drag areas — 3-line label with half-size italic last line
        const currentDragArea = Array.isArray(s.dragArea) ? s.dragArea : ["right"];
        const dragAreaWrapper = document.createElement("div");
        dragAreaWrapper.style.cssText = `display:flex;flex-direction:column;gap:${Math.round(fs * 0.4)}px;`;
        ["left", "right", "bottom"].forEach(edge => {
            const lbl = document.createElement("label");
            lbl.style.cssText = `display:flex;align-items:center;gap:3px;font-size:${fs}px;color:${s.labelColor};cursor:pointer;`;
            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.dataset.vbEdge = edge;
            chk.checked = currentDragArea.includes(edge);
            chk.style.cssText = `width:${Math.round(fs * 1.1)}px;height:${Math.round(fs * 1.1)}px;cursor:pointer;accent-color:${s.accentColor ?? ACCENT};flex-shrink:0;`;
            chk.addEventListener("mousedown", e => e.stopPropagation());
            chk.addEventListener("change", () => {
                const newArea = ["left", "right", "bottom"].filter(e2 => {
                    const c = dragAreaWrapper.querySelector(`input[data-vb-edge="${e2}"]`);
                    return c?.checked;
                });
                this.anchor._vbSettings.dragArea = newArea;
                this._rebuildMoveStrips();
            });
            lbl.appendChild(chk);
            lbl.appendChild(document.createTextNode(edge));
            dragAreaWrapper.appendChild(lbl);
        });
        // Three-line label: "Optional" (full size) / "drag areas" (full size) /
        // "to move the panel" (italic, half the font size of "Optional")
        const dragAreaRow = document.createElement("div");
        dragAreaRow.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:${Math.round(fs * 0.6)}px;`;
        const dragAreaLbl = document.createElement("label");
        dragAreaLbl.style.cssText = `font-size:${fs}px;color:${s.labelColor};flex-shrink:0;line-height:1.35;`;
        dragAreaLbl.innerHTML = `Optional<br>drag areas<br><em style="font-size:${Math.round(fs * 0.5)}px;">to move the panel</em>`;
        dragAreaRow.appendChild(dragAreaLbl);
        dragAreaRow.appendChild(dragAreaWrapper);
        // Bordered container to visually group the drag-areas controls.
        const dragAreaBox = document.createElement("div");
        dragAreaBox.style.cssText = `border:1px solid #202020;border-radius:5px;`
            + `padding:${Math.round(fs * 0.5)}px ${Math.round(fs * 0.6)}px;`;
        dragAreaBox.appendChild(dragAreaRow);
        optionsGroup.appendChild(dragAreaBox);

        // Colored nodes
        const coloredNodesChk = document.createElement("input");
        coloredNodesChk.type = "checkbox";
        coloredNodesChk.checked = s.coloredNodes !== false;
        coloredNodesChk.style.cssText = `width:${Math.round(fs * 1.1)}px;height:${Math.round(fs * 1.1)}px;cursor:pointer;accent-color:${s.accentColor ?? ACCENT};flex-shrink:0;`;
        coloredNodesChk.addEventListener("mousedown", e => e.stopPropagation());
        coloredNodesChk.addEventListener("change", () => {
            const enabled = coloredNodesChk.checked;
            this.anchor._vbSettings.coloredNodes = enabled;
            getVBNodes().forEach(n => {
                const ns = NODE_STYLE[n.comfyClass];
                if (!ns) return;
                if (enabled) { n.color = ns.color; n.bgcolor = ns.bgcolor; }
                else { delete n.color; delete n.bgcolor; }
                n.setDirtyCanvas(true, false);
            });
        });
        addRow("Colored nodes", coloredNodesChk, optionsGroup);

        // Hide datatype badge
        const badgeChk = document.createElement("input");
        badgeChk.type = "checkbox";
        badgeChk.checked = !!s.hideBadge;
        badgeChk.style.cssText = `width:${Math.round(fs * 1.1)}px;height:${Math.round(fs * 1.1)}px;cursor:pointer;accent-color:${s.accentColor ?? ACCENT};flex-shrink:0;`;
        badgeChk.addEventListener("mousedown", e => e.stopPropagation());
        badgeChk.addEventListener("change", () => {
            this.anchor._vbSettings.hideBadge = badgeChk.checked;
            this._render();
        });
        addRow("Hide datatype", badgeChk, optionsGroup);

        // ── Collapsible "coming soon" section ─────────────────────────────────
        // Header row: clickable toggle with the same italic/muted styling as
        // the mkComingSoon() badge, plus a ▶/▼ chevron indicator.
        const csIsOpen = { v: false };  // closed by default
        const csSect = document.createElement("div");
        csSect.style.cssText = "display:flex;flex-direction:column;";
        content.appendChild(csSect);

        const csHdr = document.createElement("div");
        csHdr.style.cssText = `display:flex;align-items:center;gap:${Math.round(fs * 0.4)}px;cursor:pointer;padding:${Math.round(fs * 0.25)}px 0;user-select:none;`;
        csHdr.addEventListener("mousedown", e => e.stopPropagation());

        const csChevron = document.createElement("span");
        csChevron.textContent = "▶";
        csChevron.style.cssText = `font-size:${Math.round(fs * 0.7)}px;color:#484f58;transition:transform 0.15s;display:inline-block;`;

        const csTitle = document.createElement("span");
        csTitle.textContent = "coming soon";
        csTitle.style.cssText = `font-size:${Math.round(fs * 0.85)}px;color:#484f58;font-style:italic;`;

        csHdr.appendChild(csChevron);
        csHdr.appendChild(csTitle);
        csSect.appendChild(csHdr);

        const csBody = document.createElement("div");
        csBody.style.cssText = `display:none;flex-direction:column;gap:${Math.round(fs * 0.55)}px;`
            + `border:1px solid #202020;border-radius:5px;opacity:0.45;`
            + `padding:${Math.round(fs * 0.55)}px ${Math.round(fs * 0.65)}px;margin-top:${Math.round(fs * 0.3)}px;`;
        csSect.appendChild(csBody);

        csHdr.addEventListener("click", () => {
            csIsOpen.v = !csIsOpen.v;
            csBody.style.display = csIsOpen.v ? "flex" : "none";
            csChevron.style.transform = csIsOpen.v ? "rotate(90deg)" : "rotate(0deg)";
        });

        // Position mode (inside collapsible body)
        const _posCur = s.screenFixed ? (s.pinCorner !== "free" ? s.pinCorner : "free-screen") : "free-canvas";
        const posSel = makeCustomSelect(
            [
                { value: "free-canvas",  label: "Free (canvas)" },
                { value: "free-screen",  label: "Free (screen)" },
                { value: "top-left",     label: "📌 Top-left" },
                { value: "top-right",    label: "📌 Top-right" },
                { value: "bottom-left",  label: "📌 Bottom-left" },
                { value: "bottom-right", label: "📌 Bottom-right" },
            ],
            _posCur,
            undefined,
            this._awayAC.signal
        );
        posSel.className = "__vb_select";
        posSel.style.color = s.valueColor;
        posSel.style.fontSize = `${selectFs}px`;
        posSel.style.width = `${ctrlW}px`;
        posSel.disabled = true;
        addRow("Position mode", posSel, csBody);

        // Corner offset inputs — hidden (position mode inactive)
        const offsetWrap = document.createElement("div");
        offsetWrap.style.cssText = "display:none;flex-direction:column;gap:5px;padding:4px 0 2px;";
        csBody.appendChild(offsetWrap);

        // Presets (inside collapsible body)
        const presetsToggle = document.createElement("div");
        presetsToggle.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:3px 0;user-select:none;cursor:not-allowed;";
        const presetsLabel = document.createElement("span");
        presetsLabel.style.cssText = `font-size:${fs}px;color:${s.labelColor};font-weight:bold;`;
        presetsLabel.textContent = "Presets";
        presetsToggle.appendChild(presetsLabel);
        csBody.appendChild(presetsToggle);

        // Mount on document.body — free from the board panel.
        document.body.appendChild(panel);
    }

    // _buildPresetsSection() populates the collapsible presets body with a save
    // row (name input + 💾 button) and a scrollable list of saved presets.
    // loadPresets / savePresets are passed down from the caller so the section
    // can refresh the list after a save or delete without re-opening the flyout.

    _buildPresetsSection(panel, fs = 11) {
        // loadPresets() reads from localStorage; returns {} on parse error.
        // savePresets() serialises and writes the full presets map back.
        const loadPresets = () => {
            try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || "{}"); }
            catch { return {}; }
        };
        const savePresets = (p) => localStorage.setItem(PRESETS_KEY, JSON.stringify(p));

        // Save-current-settings row: name input + 💾 button.
        // A copy of _vbSettings is saved so later changes to settings don't
        // retroactively modify the preset.
        const saveRow = document.createElement("div");
        saveRow.style.cssText = "display:flex;gap:4px;align-items:center;";
        const nameInp = document.createElement("input");
        nameInp.type = "text"; nameInp.placeholder = "Preset name…";
        nameInp.className = "__vb_input_sm";
        nameInp.style.cssText += "flex:1;min-width:0;";
        nameInp.style.color = s.valueColor;
        nameInp.addEventListener("mousedown", e => e.stopPropagation());
        nameInp.addEventListener("keydown", e => e.stopPropagation());
        const saveBtn = document.createElement("button");
        saveBtn.textContent = "💾 Save";
        saveBtn.style.cssText = `padding:${Math.round(3*(fs/11))}px ${Math.round(8*(fs/11))}px;background:#0f3460;border:none;border-radius:3px;color:#eaeaea;font:${fs}px monospace;cursor:pointer;flex-shrink:0;`;
        saveBtn.addEventListener("mousedown", e => e.stopPropagation());
        saveBtn.onclick = () => {
            const name = nameInp.value.trim();
            if (!name) { nameInp.style.borderColor = "#3b82f6"; return; }
            nameInp.style.borderColor = "#202020";
            const presets = loadPresets();
            // Save a clean copy of settings without transient state
            const snap = { ...this.anchor._vbSettings };
            presets[name] = snap;
            savePresets(presets);
            nameInp.value = "";
            this._rebuildPresetList(panel, loadPresets, savePresets, fs);
        };
        saveRow.appendChild(nameInp);
        saveRow.appendChild(saveBtn);
        panel.appendChild(saveRow);

        // The preset list is rebuilt by _rebuildPresetList() after every save
        // or delete so it always reflects the current localStorage state.
        const listWrap = document.createElement("div");
        listWrap.className = "__vb_preset_list";
        listWrap.style.cssText = "display:flex;flex-direction:column;gap:3px;margin-top:4px;";
        panel.appendChild(listWrap);
        this._rebuildPresetList(panel, loadPresets, savePresets, fs);
    }

    _rebuildPresetList(panel, loadPresets, savePresets, fs = 11) {
        const listWrap = panel.querySelector(".__vb_preset_list");
        if (!listWrap) return;
        listWrap.innerHTML = "";
        const presets = loadPresets();
        const names = Object.keys(presets);
        if (names.length === 0) {
            const empty = document.createElement("div");
            empty.style.cssText = `font-size:${fs}px;color:#444;font-style:italic;padding:2px 0;`;
            empty.textContent = "No saved presets";
            listWrap.appendChild(empty);
            return;
        }
        names.forEach(name => {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;gap:4px;align-items:center;";

            const lbl = document.createElement("div");
            lbl.textContent = name;
            lbl.style.cssText = `flex:1;font-size:${fs}px;color:#cdd9e5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;

            const loadBtn = document.createElement("button");
            loadBtn.textContent = "↓ Load";
            loadBtn.style.cssText = `padding:${Math.round(2*(fs/11))}px ${Math.round(6*(fs/11))}px;background:#238636;border:none;border-radius:3px;color:#fff;font:${fs}px monospace;cursor:pointer;flex-shrink:0;`;
            loadBtn.addEventListener("mousedown", e => e.stopPropagation());
            loadBtn.onclick = () => {
                const snap = presets[name];
                if (!snap) return;
                this.anchor._vbSettings = { ...DEFAULT_SETTINGS, ...snap };
                // If the settings flyout is open, reopen it with the new values
                // so that all dropdowns reflect the loaded preset immediately.
                if (this._settingsOpen) {
                    const savedOffset = this._flyoutOffset;
                    document.getElementById("__vb_settings_fly")?.remove();
                    this._render();
                    this._flyoutOffset = savedOffset; // pre-set so _showSettingsPanel preserves position
                    this._showSettingsPanel();
                } else {
                    this._render();
                }
            };

            const delBtn = document.createElement("button");
            delBtn.textContent = "×";
            delBtn.style.cssText = `padding:${Math.round(2*(fs/11))}px ${Math.round(5*(fs/11))}px;background:transparent;border:none;color:#8892a4;font:${Math.round(fs*1.18)}px monospace;cursor:pointer;flex-shrink:0;`;
            delBtn.addEventListener("mousedown", e => e.stopPropagation());
            delBtn.onmouseenter = () => delBtn.style.color = "#ff6b6b";
            delBtn.onmouseleave = () => delBtn.style.color = "#8892a4";
            delBtn.onclick = () => {
                const p = loadPresets();
                delete p[name];
                savePresets(p);
                this._rebuildPresetList(panel, loadPresets, savePresets, fs);
                requestAnimationFrame(() => this._syncNodeSize());
            };

            row.appendChild(lbl);
            row.appendChild(loadBtn);
            row.appendChild(delBtn);
            listWrap.appendChild(row);
        });
    }

    // _makeColorControl() builds a compact color picker widget composed of:
    //   • A colored swatch div that opens the native <input type="color"> picker
    //   • A hex text input for manual entry (validates /^#[0-9a-fA-F]{6}$/)
    //   • A ↺ reset button that restores the initial color
    // All three elements call onChange(hexColor) whenever the color changes so
    // the caller can apply the new color immediately without waiting for a
    // full re-render.

    _makeColorControl(initColor, onChange, fs = 11) {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;align-items:center;gap:5px;";

        const swatchWrap = document.createElement("div");
        swatchWrap.style.cssText = "position:relative;flex-shrink:0;";

        const swW = Math.round(44 * (fs / 11));
        const swH = Math.round(18 * (fs / 11));
        const swatch = document.createElement("div");
        swatch.style.cssText = `width:${swW}px;height:${swH}px;border-radius:3px;cursor:pointer;border:1px solid #202020;background:${initColor};`;

        const picker = document.createElement("input");
        picker.type = "color";
        picker.value = initColor;
        picker.className = "__vb_color_picker_input";
        // Static hide/overlay styling lives in .__vb_color_picker_input (varBoard.css).

        swatch.addEventListener("mousedown", e => { e.stopPropagation(); picker.click(); });
        picker.addEventListener("mousedown", e => e.stopPropagation());
        picker.addEventListener("input", e => {
            swatch.style.background = e.target.value;
            hexInp.value = e.target.value;
            onChange(e.target.value);
        });

        const hexInp = document.createElement("input");
        hexInp.type = "text";
        hexInp.value = initColor;
        hexInp.maxLength = 7;
        hexInp.className = "__vb_input_sm";
        hexInp.style.color = this.settings.valueColor;
        hexInp.style.width = `${Math.round(64 * (fs / 11))}px`;
        hexInp.style.fontSize = `${Math.round(10 * (fs / 11))}px`;
        hexInp.addEventListener("mousedown", e => e.stopPropagation());
        hexInp.addEventListener("keydown", e => e.stopPropagation());
        hexInp.addEventListener("input", e => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                swatch.style.background = v;
                picker.value = v;
                onChange(v);
            }
        });

        const reset = document.createElement("button");
        reset.textContent = "↺";
        reset.className = "__vb_btn_reset";
        reset.style.fontSize = `${Math.round(12 * (fs / 11))}px`;
        reset.addEventListener("mousedown", e => e.stopPropagation());
        reset.onclick = () => { picker.value = initColor; hexInp.value = initColor; swatch.style.background = initColor; onChange(initColor); };

        swatchWrap.appendChild(swatch); swatchWrap.appendChild(picker);
        wrap.appendChild(swatchWrap); wrap.appendChild(hexInp); wrap.appendChild(reset);
        return wrap;
    }

    // ── Lightweight rAF position loop ─────────────────────────────────────────
    // _startPositionLoop() starts a minimal requestAnimationFrame loop that runs
    // for the full lifetime of the DOMPanel.  Every frame it:
    //
    //   1. Calls _applyPosition() to reposition the panel to track the canvas
    //      anchor node's current screen position and zoom level.
    //
    //   2. Hides or shows the panel depending on whether the anchor node is
    //      collapsed (anchor.flags.collapsed).
    //
    //   3. Detects height changes to keep the canvas node footprint in sync with
    //      the DOM panel via _syncNodeSize().
    //
    // Value and structure changes are handled by the event-driven methods below
    // (_handleGraphChange and _updateInputsInPlace) — NOT by this loop.
    //
    // Errors inside the loop are swallowed (with a warning) so that a single
    // bad frame never kills the rAF chain.

    _startPositionLoop() {
        const tick = () => {
            this._raf = requestAnimationFrame(tick);
            if (!this.el || !this.anchor) return;
            try {
                const s = this.settings;
                this._applyPosition(s);

                // Mirror the anchor node's collapsed state.
                this.el.style.display = this.anchor.flags?.collapsed ? "none" : "flex";
            } catch (e) {
                console.warn("[VB] tick error:", e);
            }
        };
        this._raf = requestAnimationFrame(tick);
    }

    // ── Event-driven graph change handler ─────────────────────────────────────
    // _syncVbOrder() keeps this.anchor._vbOrder in sync with the live graph:
    // it removes IDs for deleted nodes and appends IDs for newly-added nodes
    // that aren't yet in the order array.  Called before every _render() so
    // that the order array is always consistent with the live graph.

    _syncVbOrder() {
        if (!this.anchor) return;
        const ordered = getVBNodes(this.anchor._vbOrder);
        const liveIds = ordered.map(n => n.id);
        const prev = this.anchor._vbOrder ?? [];
        const pruned = prev.filter(id => liveIds.includes(id));
        const added  = liveIds.filter(id => !prev.includes(id));
        if (pruned.length + added.length !== prev.length || added.length)
            this.anchor._vbOrder = [...pruned, ...added];
    }

    // _handleGraphChange() is called by the graph-level hooks in setup() when
    // VB variable nodes are added/removed or connections change.  It syncs the
    // order array and schedules a full re-render on the next animation frame.
    // Debouncing via _renderScheduled prevents multiple events fired in the same
    // tick (e.g. loading a workflow with many nodes) from triggering redundant
    // re-renders.

    _handleGraphChange() {
        this._syncVbOrder();

        if (this._renderScheduled) return;
        this._renderScheduled = true;
        requestAnimationFrame(() => {
            this._renderScheduled = false;
            this._render();
        });
    }

    // _attachGraphListeners() registers this panel in the module-level
    // _vbPanelRegistry so that the graph hooks installed in setup() can
    // dispatch events to it.  Called once from the constructor.

    _attachGraphListeners() {
        _vbPanelRegistry.add(this);
    }

    // _applyPosition() computes the correct screen position for this.el and
    // writes it to the element's style every frame.  Three modes:
    //
    //   pinned corner — snaps to a viewport edge with CORNER_MARGIN px inset;
    //     recalculated every frame so it stays correct if the panel height
    //     changes (e.g. after adding a variable).
    //
    //   screen-fixed free — left/top from settings.screenX / screenY; no
    //     transform applied.
    //
    //   canvas-anchored (default) — converts the anchor node's canvas-space
    //     position to screen space using LiteGraph's ds (display state), then
    //     applies transform:scale(ds.scale) with origin top-left so the panel
    //     grows and shrinks with the canvas zoom.  The settings flyout is a
    //     separate body-mounted element; _applyFlyoutPosition() mirrors the same
    //     transform onto it every frame so it stays in sync.
    _applyPosition(s) {
        const pinned = s.pinCorner && s.pinCorner !== "free";
        const dsScale = app.canvas?.ds?.scale ?? 1;
        if (pinned) {
            const corner = CORNERS[s.pinCorner];
            if (!corner) return;
            const w = this.el.offsetWidth;
            const h = this.el.offsetHeight;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const offH = s.pinOffsetH ?? CORNER_MARGIN;
            const offV = s.pinOffsetV ?? CORNER_MARGIN;
            this.el.style.left = corner.h === "left" ? `${offH}px` : `${vw - w - offH}px`;
            this.el.style.top  = corner.v === "top"  ? `${offV}px` : `${vh - h - offV}px`;
            this.el.style.transform = "none";
            this._applyFlyoutPosition(parseInt(this.el.style.left) || 0, parseInt(this.el.style.top) || 0, 1, dsScale);
            this._applyAddDialogPosition(parseInt(this.el.style.left) || 0, parseInt(this.el.style.top) || 0, 1, dsScale);
            this._applyVarSettingsScale(parseInt(this.el.style.left) || 0, parseInt(this.el.style.top) || 0, 1, dsScale);
        } else if (s.screenFixed) {
            this.el.style.left = `${s.screenX ?? 20}px`;
            this.el.style.top = `${s.screenY ?? 20}px`;
            this.el.style.transform = "none";
            this._applyFlyoutPosition(s.screenX ?? 20, s.screenY ?? 20, 1, dsScale);
            this._applyAddDialogPosition(s.screenX ?? 20, s.screenY ?? 20, 1, dsScale);
            this._applyVarSettingsScale(s.screenX ?? 20, s.screenY ?? 20, 1, dsScale);
        } else {
            if (!app.canvas?.ds) return;
            const ds = app.canvas.ds;
            const rect = app.canvas.canvas.getBoundingClientRect();
            // Title has been stripped: position DOM panel at pos[1] directly
            // (no titleH offset needed).
            const left = rect.left + (this.anchor.pos[0] + ds.offset[0]) * ds.scale;
            const top = rect.top + (this.anchor.pos[1] + ds.offset[1]) * ds.scale;
            this.el.style.left = `${left}px`;
            this.el.style.top = `${top}px`;
            this.el.style.transform = `scale(${ds.scale})`;
            this.el.style.transformOrigin = "top left";
            this._applyFlyoutPosition(left, top, ds.scale);
            this._applyAddDialogPosition(left, top, ds.scale);
            this._applyVarSettingsScale(left, top, ds.scale);
        }
    }

    // _applyFlyoutPosition() repositions and rescales the settings flyout every
    // frame so it tracks the board panel exactly — same zoom, same pan.
    // boardLeft/boardTop are the screen-space CSS left/top of the board.
    // posScale converts _flyoutOffset (pre-scale offsets from the board's origin)
    // to screen space; transScale is the visual CSS transform scale applied to the
    // flyout.  In canvas-anchored mode both equal ds.scale.  In screen-fixed and
    // pinned-corner modes posScale is 1 (offsets are already in screen pixels) while
    // transScale is still ds.scale so the flyout zooms with the canvas.
    _applyFlyoutPosition(boardLeft, boardTop, posScale, transScale = posScale) {
        const fly = document.getElementById("__vb_settings_fly");
        if (!fly || !this._flyoutOffset) return;
        const fx = boardLeft + this._flyoutOffset.x * posScale;
        const fy = boardTop  + this._flyoutOffset.y * posScale;
        fly.style.left = `${fx}px`;
        fly.style.top  = `${fy}px`;
        fly.style.transform = transScale !== 1 ? `scale(${transScale})` : "none";
        fly.style.transformOrigin = "top left";
    }

    // _applyAddDialogPosition() repositions and rescales the add-variable dialog
    // every frame so it tracks the board panel exactly — same zoom, same pan.
    // posScale converts _addDialogOffset to screen space; transScale is the visual
    // CSS transform scale.  In canvas-anchored mode both equal ds.scale; in
    // screen-fixed and pinned-corner modes posScale is 1 while transScale is
    // ds.scale so the dialog zooms with the canvas regardless of position mode.
    _applyAddDialogPosition(boardLeft, boardTop, posScale, transScale = posScale) {
        const dlg = document.querySelector(".__vb_add");
        if (!dlg || !this._addDialogOffset) return;
        const fx = boardLeft + this._addDialogOffset.x * posScale;
        const fy = boardTop  + this._addDialogOffset.y * posScale;
        dlg.style.left = `${fx}px`;
        dlg.style.top  = `${fy}px`;
        dlg.style.transform = transScale !== 1 ? `scale(${transScale})` : "none";
        dlg.style.transformOrigin = "top left";
    }

    // _applyVarSettingsScale() repositions and rescales all open per-variable
    // settings popups every frame, mirroring _applyFlyoutPosition exactly.
    // boardLeft/boardTop are the screen-space CSS left/top of the board panel.
    // posScale converts dataset.offsetX/offsetY (pre-scale offsets from the board
    // origin) to screen px.  transScale is the CSS transform scale applied to the
    // popup.  In canvas-anchored mode both equal ds.scale; in screen-fixed and
    // pinned-corner modes posScale is 1 while transScale is ds.scale.
    _applyVarSettingsScale(boardLeft, boardTop, posScale, transScale = posScale) {
        document.querySelectorAll(".__vb_varsettings").forEach(popup => {
            const ox = parseFloat(popup.dataset.offsetX);
            const oy = parseFloat(popup.dataset.offsetY);
            if (!isNaN(ox) && !isNaN(oy)) {
                popup.style.left = `${boardLeft + ox * posScale}px`;
                popup.style.top  = `${boardTop  + oy * posScale}px`;
            }
            popup.style.transform = transScale !== 1 ? `scale(${transScale})` : "none";
            popup.style.transformOrigin = "top left";
        });
    }

    // destroy() is called when the VB_Panel node is removed from the graph.
    // It deregisters the panel from _vbPanelRegistry (preventing further event
    // dispatches), cancels the rAF position loop, removes the DOM element (which
    // also removes any child flyout), and cleans up the add-variable dialog.

    destroy() {
        _vbPanelRegistry.delete(this);
        this._resizeObs?.disconnect();
        cancelAnimationFrame(this._raf);
        // Abort all document-level away-click listeners registered with this panel's signal.
        this._awayAC.abort();
        // Close any open custom select dropdowns (they register their own away listeners).
        this.el?.querySelectorAll("[role='combobox']").forEach(sel => sel.closeList?.());
        this.el?.remove();
        this.el = null;
        // All floating panels (add dialog, settings flyout, var-settings popups)
        // live on document.body and must be removed explicitly.
        document.querySelector(".__vb_add")?.remove();
        document.getElementById("__vb_settings_fly")?.remove();
        document.querySelectorAll(".__vb_varsettings").forEach(el => el.remove());
    }
}

// ─── VBNodeMixin ──────────────────────────────────────────────────────────────
// Methods in this class are mixed into the VB_Panel LiteGraph node prototype
// in beforeRegisterNodeDef().  They give the otherwise-empty virtual node all
// the canvas behaviors it needs: initialisation, draw hook, serialisation,
// and lifecycle events.
//
// _vbInit() is called once (guarded by _vbSettingsReady) to set up all private
// state.  Called from onNodeCreated (prototype), nodeCreated, and loadedGraphNode.
// Must be idempotent — safe to call multiple times without double-initialising.
//
// computeSize() is overridden to always return the DOM panel's live offsetHeight
// so LiteGraph can never stamp a stale drag-derived height over it.
//
// onResize() is a no-op that locks the node back to its DOM dimensions so
// LiteGraph cannot override them via canvas drag handles.

class VBNodeMixin {
    _vbInit() {
        if (!this._domPanel) this._domPanel = null;  // never overwrite a live panel
        this._vbOrder = this._vbOrder ?? [];
        this._vbSettings = this._vbSettings ?? { ...DEFAULT_SETTINGS };
        this._vbRangeOverrides = this._vbRangeOverrides ?? {};  // { nodeId → { min, max, step } }
        this._vbMultilineStrings = this._vbMultilineStrings ?? {};  // { nodeId → bool }
        this._vbLabelWidths = this._vbLabelWidths ?? {};  // { nodeId → px width of label column }
        this._vbStringHeights = this._vbStringHeights ?? {};  // { nodeId → px height of multiline textarea }
        if (!this.size) this.size = [DEF_W, 80];
        this.size[0] = this._vbSettings.panelWidth ?? DEF_W;
        this.resizable = false;
        // Fully transparent — the DOM panel is the only visual representation.
        // Setting color and bgcolor to fully-transparent strings prevents
        // LiteGraph from painting any visible fill or border on the canvas node.
        this.color   = "rgba(0,0,0,0)";
        this.bgcolor = "rgba(0,0,0,0)";
        // Suppress every LiteGraph draw pass so nothing is painted on the canvas.
        // The node remains fully interactive (draggable, selectable) because
        // LiteGraph's hit-testing uses this.size, not the visual output.
        this.onDrawTitle      = () => {};
        this.onDrawBackground = () => {};
        this.onDrawForeground = () => {};
        // computeSize() reports live DOM dimensions so LiteGraph stays in sync.
        // Title bar is fully invisible, so size[1] = full domH with no titleH offset.
        this.computeSize = () => {
            // Title bar is fully invisible (onDrawTitle suppressed), so
            // LiteGraph must NOT add titleH on top — size[1] = full domH.
            const domH = this._domPanel?.el?.offsetHeight;
            const w = this._vbSettings?.panelWidth ?? DEF_W;
            return [w, domH > 0 ? domH : this.size[1]];
        };
    }

    // onResize: the panel is not user-resizable; this no-op prevents LiteGraph
    // from applying stale canvas-drag dimensions to the DOM panel.
    onResize(size) {
        if (!this._vbSettings) return;
        // Lock size back to DOM reality so LiteGraph cannot override it.
        const w = this._vbSettings.panelWidth ?? DEF_W;
        const domH = this._domPanel?.el?.offsetHeight;
        size[0] = w;
        if (domH) size[1] = domH;
    }

    onAdded() {
        // Fallback: some older ComfyUI builds call onAdded instead of nodeCreated.
        // Cancel any stale rAF loop whose DOM element is no longer connected.
        if (this._domPanel && !this._domPanel.el?.isConnected) {
            cancelAnimationFrame(this._domPanel._raf);
            this._domPanel = null;
        }
        if (!this._vbSettingsReady) {
            this._vbInit();
            this._vbSettingsReady = true;
        }
        if (!this._domPanel) {
            this._domPanel = new DOMPanel(this);
            const sync = () => this._domPanel?._syncNodeSize();
            requestAnimationFrame(() => requestAnimationFrame(sync));
            setTimeout(sync, 50);
            setTimeout(sync, 150);
        }
    }

    // onRemoved fires when the node is deleted from the canvas.
    onRemoved() { this._domPanel?.destroy(); this._domPanel = null; }

    onSerialize(o) {
        // Persist all VarBoard-specific properties alongside the node's
        // standard serialised data so they survive workflow save/load.
        o.vbOrder = this._vbOrder ?? [];
        o.vbSettings = this._vbSettings ?? {};
        o.vbRangeOverrides = this._vbRangeOverrides ?? {};
        o.vbMultilineStrings = this._vbMultilineStrings ?? {};
        o.vbLabelWidths = this._vbLabelWidths ?? {};
        o.vbStringHeights = this._vbStringHeights ?? {};
    }

    onConfigure(o) {
        // Restore persisted properties.  Merge vbSettings over DEFAULT_SETTINGS
        // so any keys added in future versions always have a sensible fallback.
        this._vbOrder = o.vbOrder ?? [];
        this._vbSettings = { ...DEFAULT_SETTINGS, ...(o.vbSettings ?? {}) };
        this._vbRangeOverrides = o.vbRangeOverrides ?? {};
        this._vbMultilineStrings = o.vbMultilineStrings ?? {};
        this._vbLabelWidths = o.vbLabelWidths ?? {};

        // ── Backward compatibility: migrate old-format settings ───────────────
        // Workflows saved before this refactoring stored panelHeight (null or px)
        // and rowHeight (px fallback).  New format stores only userRowHeight.
        // Detect old format by the absence of userRowHeight in the saved settings.
        const savedSettings = o.vbSettings ?? {};
        const sv = this._vbSettings;
        if (!('userRowHeight' in savedSettings)) {
            if (savedSettings.panelHeight != null) {
                // Old fixed-height mode: derive the rowH that was in use at save time.
                // Approximate using equal-division of available height.
                const oldNodes = (o.vbOrder ?? []).length;
                if (oldNodes > 0) {
                    // Use the saved panelWidth explicitly so the scale factor matches the
                    // actual panel that was saved, not the post-merge default.
                    const oldSc = scaleFor(savedSettings.panelWidth ?? DEF_W);
                    const oldHdrH = headerHeightFor(oldSc);
                    const availH = savedSettings.panelHeight - PANEL_BORDER - oldHdrH - ROWS_PAD_B;
                    const derived = Math.max(1, Math.floor(availH / oldNodes));
                    sv.userRowHeight = derived;
                } else {
                    sv.userRowHeight = DEFAULT_ROW_H;
                }
            } else if ('rowHeight' in savedSettings) {
                sv.userRowHeight = savedSettings.rowHeight;
            }
            // Remove old keys so they don't accumulate in the saved workflow.
            delete sv.panelHeight;
            delete sv.panelExtraHeight;
            delete sv.rowHeight;
        }

        // ── Migrate _vbStringHeights from absolute pixels to ratios ───────────
        // Old format: { nodeId: pixels (minimum taH = rowH × 2, always >= derivedRowH) }
        // New format: { nodeId: ratio (multiple of userRowHeight, always >= 2) }
        // Heuristic: values >= derivedRowH are treated as absolute pixels (convert to
        // ratio by dividing by derivedRowH).  Smaller values are treated as ratios
        // already.  This reliably separates the formats because the minimum pixel
        // value (rowH × 2) always exceeds derivedRowH, while ratios start at 2
        // and are far smaller than derivedRowH in any realistic configuration.
        const derivedRowH = sv.userRowHeight ?? DEFAULT_ROW_H;
        const rawHeights = o.vbStringHeights ?? {};
        this._vbStringHeights = {};
        for (const [id, h] of Object.entries(rawHeights)) {
            if (typeof h === "number") {
                this._vbStringHeights[id] = h >= derivedRowH
                    ? Math.max(2, h / derivedRowH)   // convert px → ratio
                    : Math.max(2, h);                  // already a ratio
            }
        }

        if (this.size) {
            this.size[0] = this._vbSettings.panelWidth ?? DEF_W;
        }
    }
}

// ─── Extension registration ───────────────────────────────────────────────────
// app.registerExtension() is the ComfyUI API entry point for frontend plugins.
//
// beforeRegisterNodeDef() — wraps onNodeCreated on the VB_Panel prototype so
//   that VBNodeMixin methods (onRemoved, onResize, onDrawForeground, etc.) are
//   in place before any instance is constructed.  This is the canonical pattern
//   from the ComfyUI frontend skill: modify the prototype here, act on instances
//   in nodeCreated / loadedGraphNode.
//
// nodeCreated() — fires on every fresh node instance right after creation (when
//   the user places the node from the menu or the graph is loaded in newer
//   ComfyUI builds).  We initialise VarBoard state and attach the DOMPanel here.
//
// loadedGraphNode() — fires for each node when a saved workflow is loaded.
//   Used to re-attach the DOMPanel to VB_Panel nodes that were saved.
//
// setup() — runs once after all nodes are registered.  Hooks graphCleared and
//   onConfigure to clean up stale DOM panels when a new workflow is loaded.

app.registerExtension({
    name: "varboard.main",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === VB_PANEL_TYPE) {
            // Mix VBNodeMixin instance methods onto the prototype so every
            // VB_Panel node has onRemoved, onResize, onDrawForeground, etc.
            // We wrap onNodeCreated (the LiteGraph instance init hook) to call
            // _vbInit() so state is ready before the first draw.
            for (const key of Object.getOwnPropertyNames(VBNodeMixin.prototype)) {
                if (key !== "constructor") nodeType.prototype[key] = VBNodeMixin.prototype[key];
            }
            // inside beforeRegisterNodeDef, in: if (nodeData.name === VB_PANEL_TYPE) { ... }

            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                origOnNodeCreated?.apply(this, arguments);

                // Ensure VarBoard state exists as early as possible, independent of
                // extensionService nodeCreated/loadedGraphNode being invoked.
                if (!this._vbSettingsReady) {
                    this._vbInit();
                    this._vbSettingsReady = true;
                }

                // Create the DOM panel here (LiteGraph lifecycle), so we still work even if
                // another extension throws in ComfyUI's extensionService nodeCreated chain.
                // Also recover from stale panels whose DOM element was removed.
                if (this._domPanel && !this._domPanel.el?.isConnected) {
                    cancelAnimationFrame(this._domPanel._raf);
                    this._domPanel = null;
                }

                if (!this._domPanel) {
                    this._domPanel = new DOMPanel(this);
                    const sync = () => this._domPanel?._syncNodeSize();
                    requestAnimationFrame(() => requestAnimationFrame(sync));
                    setTimeout(sync, 50);
                    setTimeout(sync, 150);
                }
            };
        }
        if (VB_VAR_TYPES.includes(nodeData.name)) {
            // Apply type-coded canvas colors to variable nodes, if coloredNodes is enabled.
            const orig = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                orig?.apply(this, arguments);
                // Find any live panel to read settings; fall back to coloredNodes=true if none found.
                let coloredNodes = true;
                for (const panel of _vbPanelRegistry) {
                    if (panel.anchor?._vbSettings?.coloredNodes !== undefined) {
                        coloredNodes = panel.anchor._vbSettings.coloredNodes;
                        break;
                    }
                }
                const s = NODE_STYLE[this.comfyClass];
                if (s && coloredNodes) { this.color = s.color; this.bgcolor = s.bgcolor; }

                // Intercept title changes so that editing the node title on the
                // canvas also updates the label widget and triggers a panel refresh.
                // We define a per-instance title property that wraps the real value
                // stored in _vbTitle (falling back to the prototype's own title value).
                let _title = this.title;
                Object.defineProperty(this, "title", {
                    get() { return _title; },
                    set(val) {
                        _title = val;
                        // Sync the label widget to match the new title.
                        const lw = this.widgets?.find(w => w.name === "label");
                        if (lw && lw.value !== val) {
                            lw.value = val;
                            // Notify all open panels so the label column updates live.
                            _vbPanelRegistry.forEach(p => p._updateInputsInPlace());
                        }
                    },
                    configurable: true,
                });
            };
            // Override onWidgetChanged to reactively push value updates to any
            // open VarBoard panel.  When the user edits a widget directly on the
            // node canvas, this fires immediately and calls _updateInputsInPlace()
            // on every registered panel — a lightweight DOM patch, not a full
            // rebuild.  This replaces the previous per-frame signature-diff loop.
            const origOnWidgetChanged = nodeType.prototype.onWidgetChanged;
            nodeType.prototype.onWidgetChanged = function(name, value, old_value, widget) {
                origOnWidgetChanged?.apply(this, arguments);
                if (VB_VAR_TYPES.includes(this.comfyClass)) {
                    // When the label widget is edited directly on the canvas node,
                    // keep node.title in sync so the canvas title bar matches.
                    if (name === "label" && typeof value === "string" && this.title !== value) {
                        this.title = value;
                    }
                    _vbPanelRegistry.forEach(p => p._updateInputsInPlace());
                }
            };
        }
    },

    // nodeCreated fires when a node is freshly placed on the canvas (or when
    // ComfyUI instantiates nodes during graph load in recent builds).
    // Create the DOMPanel here if one doesn't exist yet.
    // For VB variable nodes dropped from the node menu (no label pre-assigned),
    // apply the canonical TYPE_DEFAULT_LABELS name with deduplication.
    nodeCreated(node) {
        if (VB_VAR_TYPES.includes(node.comfyClass)) {
            const baseName = TYPE_DEFAULT_LABELS[node.comfyClass];
            if (baseName) {
                const lw = node.widgets?.find(w => w.name === "label");
                const cur = (lw?.value ?? node.title ?? "").trim();
                // Only rename when the label is genuinely unset: empty, equal to
                // the comfyClass name (e.g. "VB_Int"), or still equal to the Python
                // backend's own default (e.g. "int_var") — all of which indicate the
                // user has not intentionally named this node yet.
                const pythonDefault = PYTHON_DEFAULT_LABELS[node.comfyClass];
                const needsRename = !cur || cur === node.comfyClass || cur === pythonDefault;
                if (needsRename) {
                    const usedLabels = getVBNodes().map(n => {
                        const w = n.widgets?.find(w => w.name === "label");
                        return (w?.value || n.title || "").trim();
                    });
                    let label = baseName;
                    if (usedLabels.includes(label)) {
                        let c = 2;
                        while (usedLabels.includes(`${baseName}_${c}`)) c++;
                        label = `${baseName}_${c}`;
                    }
                    if (lw) lw.value = label;
                    node.title = label;
                }
            }
        }

        if (node.comfyClass !== VB_PANEL_TYPE) return;
        // Cancel any stale rAF loop whose DOM element is no longer connected.
        if (node._domPanel && !node._domPanel.el?.isConnected) {
            cancelAnimationFrame(node._domPanel._raf);
            node._domPanel = null;
        }
        if (!node._vbSettingsReady) {
            node._vbInit();
            node._vbSettingsReady = true;
        }
        if (!node._domPanel) {
            node._domPanel = new DOMPanel(node);
            const sync = () => node._domPanel?._syncNodeSize();
            requestAnimationFrame(() => requestAnimationFrame(sync));
            setTimeout(sync, 50);
            setTimeout(sync, 150);
            // Apply coloredNodes to any existing VB variable nodes now that the
            // panel (and its settings) is available.  Without this, nodes that
            // were placed before the panel was created would only get colored when
            // the user toggles the checkbox.
            setTimeout(() => {
                const coloredNodes = node._vbSettings?.coloredNodes !== false;
                getVBNodes().forEach(n => {
                    const ns = NODE_STYLE[n.comfyClass];
                    if (!ns) return;
                    if (coloredNodes) {
                        n.color   = ns.color;
                        n.bgcolor = ns.bgcolor;
                    } else {
                        delete n.color;
                        delete n.bgcolor;
                    }
                    n.setDirtyCanvas(true, false);
                });
            }, 0);
        }
    },

    // loadedGraphNode fires for every node when a saved workflow is opened.
    // Re-attach the DOMPanel to any VB_Panel node that was saved without one.
    loadedGraphNode(node) {
        if (node.comfyClass !== VB_PANEL_TYPE) return;
        // Cancel any rAF loop on a stale DOMPanel whose DOM element has been
        // removed (e.g. by cleanup() during a workflow switch).
        if (node._domPanel && !node._domPanel.el?.isConnected) {
            cancelAnimationFrame(node._domPanel._raf);
            node._domPanel = null;
        }
        if (!node._vbSettingsReady) {
            node._vbInit();
            node._vbSettingsReady = true;
        }
        if (!node._domPanel) {
            node._domPanel = new DOMPanel(node);
            // Defer size sync: the DOM needs at least one full reflow after mount.
            // We use multiple checkpoints to catch slow renders and fixed-height panels.
            const sync = () => node._domPanel?._syncNodeSize();
            requestAnimationFrame(() => requestAnimationFrame(sync));
            setTimeout(sync, 50);
            setTimeout(sync, 200);
            setTimeout(sync, 500);
        }
        // Defer color application so all var nodes are instantiated first.
        // This respects the coloredNodes setting saved in the workflow.
        setTimeout(() => {
            const coloredNodes = node._vbSettings?.coloredNodes !== false;
            getVBNodes().forEach(n => {
                const ns = NODE_STYLE[n.comfyClass];
                if (!ns) return;
                if (coloredNodes) {
                    n.color   = ns.color;
                    n.bgcolor = ns.bgcolor;
                } else {
                    delete n.color;
                    delete n.bgcolor;
                }
                n.setDirtyCanvas(true, false);
            });
        }, 100);
    },

    async setup() {
        // Clean up all floating panel DOM elements before a new workflow loads
        // so stale panels from the previous graph don't leak into the new one.
        // Also clear _domPanel refs and _vbSettingsReady flags on all live nodes
        // so loadedGraphNode correctly recreates panels after the new graph loads.
        const cleanup = () => {
            document.querySelectorAll(".__vb_panel").forEach(el => el.remove());
            document.querySelector(".__vb_add")?.remove();
            document.getElementById("__vb_settings_fly")?.remove();
            document.querySelectorAll(".__vb_varsettings").forEach(el => el.remove());
            // Null out stale DOMPanel references on any currently loaded nodes so
            // the guard `if (!node._domPanel)` in loadedGraphNode fires correctly.
            if (app.graph?._nodes) {
                app.graph._nodes.forEach(n => {
                    if (n.comfyClass === VB_PANEL_TYPE) {
                        n._domPanel = null;
                        n._vbSettingsReady = false;
                    }
                });
            }
        };
        app.api.addEventListener("graphCleared", cleanup);
        // When a prompt is queued, seed widgets whose control is set to
        // "randomise" are updated in the frontend immediately.  Refresh all
        // panel inputs right after queueing so the new seed appears without
        // waiting for server execution to complete.
        const origQueuePrompt = app.queuePrompt.bind(app);
        app.queuePrompt = async function(...args) {
            const result = await origQueuePrompt(...args);
            // Apply +1 / −1 seed step controls after each queue so the seed
            // advances for the NEXT run (KSampler-style post-run behaviour).
            // Wrapped in try/catch so any VarBoard UI error never prevents the
            // queue result from being returned to ComfyUI or other extensions.
            try {
                _vbPanelRegistry.forEach(p => p._stepSeedControls());
                _vbPanelRegistry.forEach(p => p._updateInputsInPlace());
            } catch (e) {
                console.warn("[VB] post-queue update error:", e);
            }
            return result;
        };
        // After a workflow execution completes, seed widgets that are not frozen
        // may have been randomised server-side.  Refresh all panel inputs so the
        // new seed values appear immediately without waiting for the next render.
        app.api.addEventListener("executed", () => {
            _vbPanelRegistry.forEach(p => p._updateInputsInPlace());
        });
        const origConfigure = app.graph.onConfigure;
        app.graph.onConfigure = function (...args) {
            cleanup();
            return origConfigure?.apply(this, args);
        };

        // ── Event-driven graph hooks ──────────────────────────────────────────
        // Install graph-level hooks once here.  They dispatch to every currently
        // registered DOMPanel via _vbPanelRegistry so panels react to structural
        // graph changes without a per-frame polling loop.
        //
        // onNodeAdded / onNodeRemoved: fire when VB variable nodes are added or
        //   deleted from the graph, triggering a full _handleGraphChange().
        // onConnectionChange: fires on any connection edit; triggers
        //   _handleGraphChange() so the panel stays consistent with the graph.
        //
        // These hooks wrap and chain through any previously installed handlers
        // so they are composable with other ComfyUI extensions.

        const origNodeAdded = app.graph.onNodeAdded;
        app.graph.onNodeAdded = function(node) {
            origNodeAdded?.apply(this, arguments);
            if (VB_VAR_TYPES.includes(node.comfyClass)) {
                _vbPanelRegistry.forEach(p => p._handleGraphChange());
            }
        };

        const origNodeRemoved = app.graph.onNodeRemoved;
        app.graph.onNodeRemoved = function(node) {
            origNodeRemoved?.apply(this, arguments);
            if (VB_VAR_TYPES.includes(node.comfyClass)) {
                _vbPanelRegistry.forEach(p => p._handleGraphChange());
            }
        };

        const origConnectionChange = app.graph.onConnectionChange;
        app.graph.onConnectionChange = function(side, node, slot, target_node, target_slot) {
            origConnectionChange?.apply(this, arguments);
            // Only dispatch when the connection involves a VB variable node so
            // unrelated connection edits don't trigger unnecessary re-renders.
            if (VB_VAR_TYPES.includes(node?.comfyClass) ||
                VB_VAR_TYPES.includes(target_node?.comfyClass)) {
                _vbPanelRegistry.forEach(p => p._handleGraphChange());
            }
        };
    },
});