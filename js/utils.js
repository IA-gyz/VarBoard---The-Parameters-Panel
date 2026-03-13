import { app } from "/scripts/app.js";
import { COMBO_OPTIONS, VB_VAR_TYPES, NODE_CLASS_MAP, DEF_W } from "./constants.js";

// stable; INT and SEED are rendered as plain integers; STRING passes through.
//
// parseValue() is the inverse: converts the string the user typed back into the
// native JS type expected by the widget (number for INT/FLOAT/SEED, string for
// STRING).  Values that cannot be parsed fall back to 0 / 0.0 / "".

export function formatValue(value, type, decimals) {
    if (type === "FLOAT") {
        const d = (decimals !== undefined && decimals !== null) ? Math.max(0, Math.min(10, parseInt(decimals))) : 2;
        return parseFloat(value).toFixed(d);
    }
    if (type === "INT" || type === "SEED") return String(parseInt(value) || 0);
    if (type === "BOOL") return value ? "true" : "false";
    return String(value ?? "");
}

export function parseValue(str, type) {
    if (type === "INT" || type === "SEED") return parseInt(str) || 0;
    if (type === "FLOAT") return parseFloat(str) || 0.0;
    if (type === "BOOL") return str === "true" || str === true || str === 1;
    return str;
}

// randomSeed() returns a random 32-bit unsigned integer for the dice button.
export function randomSeed() { return Math.floor(Math.random() * 0xFFFFFFFF); }

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

export function getVBNodes(order) {
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

export function createVBNode(type, anchorNode, label) {
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

// ─── Unified panel sizing ─────────────────────────────────────────────────────
// A single scale factor `sc` drives every visual element — header, rows,
// buttons, badges, fonts, paddings, icons, toggles, seed buttons — so that
// resizing the panel horizontally rescales everything proportionally.
//
// scaleFor(panelWidth)
//   Returns sc = panelWidth / DEF_W  (DEF_W = 420 px).
//   Scale is purely width-driven; panel height has no effect on sc.
//
// headerHeightFor(sc) — header bar height = HDR_BASE_H * (sc ?? 1.0)
// fontFromRow(rowH)   — row-level font size (fraction of rowH)
//
// Panel height is always derived bottom-up from content:
//   domHeight = PANEL_BORDER + hdrH + ROWS_PAD_B + nodeCount × userRowHeight
//             + multilineOverhead
//   where multilineOverhead = Σ (taH_i − userRowHeight + DRAG_HANDLE_H + 2×padV)
//   across multiline rows, and taH_i = ratio_i × userRowHeight.
// The DOM height is never set explicitly — it always equals the content height.

// Re-import HDR_BASE_H, PANEL_BORDER, ROWS_PAD_B, DRAG_HANDLE_H, DEFAULT_ROW_H from constants.js
import { HDR_BASE_H, PANEL_BORDER, ROWS_PAD_B, DRAG_HANDLE_H, DEFAULT_ROW_H } from "./constants.js";

export function scaleFor(panelWidth) {
    return panelWidth / DEF_W;
}

export function headerHeightFor(sc) { return Math.round(HDR_BASE_H * (sc ?? 1.0)); }

export function fontFromRow(rowH) {
    // Font is a fraction of rowH.
    return Math.max(1, Math.round(rowH * 0.42));
}

// rowHeightFrom() returns the user-set row height from settings.
export function rowHeightFrom(settings) { return settings.userRowHeight ?? DEFAULT_ROW_H; }
