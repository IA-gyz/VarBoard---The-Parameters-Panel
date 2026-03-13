import { app } from "/scripts/app.js";
import {
    DEF_W, DEFAULT_ROW_H, DEFAULT_SETTINGS, PANEL_BORDER, ROWS_PAD_B,
    VB_PANEL_TYPE, VB_VAR_TYPES, TYPE_DEFAULT_LABELS, PYTHON_DEFAULT_LABELS, NODE_STYLE
} from "./constants.js";
import { scaleFor, headerHeightFor, getVBNodes } from "./utils.js";
import { DOMPanel } from "./DOMPanel.js";
import { _vbPanelRegistry } from "./components.js";

// LiteGraphHooks.js

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
        // Wrap app.queuePrompt to step +1/−1 seed controls after each queue.
        // Guard with typeof check in case this ComfyUI build surfaces the method
        // under a different name or not at all — we must not throw during setup.
        // Seed stepping (▲/▼) is now handled by writing to ComfyUI's native
        // control_after_generate widget, so no queuePrompt wrapping is needed.
        // We still refresh the panel after queueing so any frontend-side seed
        // randomisation (ComfyUI's own "randomize" mode) is reflected immediately.
        if (typeof app.queuePrompt === "function") {
            const origQueuePrompt = app.queuePrompt.bind(app);
            app.queuePrompt = async function(...args) {
                const result = await origQueuePrompt(...args);
                try {
                    _vbPanelRegistry.forEach(p => p._updateInputsInPlace());
                } catch (e) {
                    console.warn("[VB] post-queue update error:", e);
                }
                return result;
            };
        }
        // After a workflow execution completes, seed widgets that are not frozen
        // may have been randomised server-side.  Refresh all panel inputs so the
        // new seed values appear immediately without waiting for the next render.
        app.api.addEventListener("executed", () => {
            // After a node executes, refresh panel inputs so any server-side
            // seed randomisation is reflected immediately in the panel display.
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
            patchNodeConnections(node);
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

        // ── Connection-change detection ───────────────────────────────────────
        // LiteGraph fires onConnectionsChange (plural) on the *node* object —
        // NOT onConnectionChange on the graph.  We patch every VB node so its
        // onConnectionsChange refreshes the dot colours instantly without a
        // full re-render.  New VB nodes get patched in onNodeAdded above.
        // The ComfyUI api "graphChanged" event is a belt-and-suspenders fallback.
        const patchNodeConnections = (node) => {
            if (!VB_VAR_TYPES.includes(node.comfyClass)) return;
            const orig = node.onConnectionsChange;
            node.onConnectionsChange = function(...args) {
                orig?.apply(this, args);
                _vbPanelRegistry.forEach(p => p._updateInputsInPlace());
            };
        };
        app.graph._nodes?.forEach?.(patchNodeConnections);

        try {
            app.api.addEventListener("graphChanged", () =>
                _vbPanelRegistry.forEach(p => p._updateInputsInPlace())
            );
        } catch (_) {}
    },
});