import { createLayoutNode } from './layout/engine.js';
import { LayoutDisplay, LayoutMeasureMode } from './layout/node.js';
import measureText from './measure-text.js';
import { addPendingClear, nodeCache, textPaintCache } from './node-cache.js';
import squashTextNodes from './squash-text-nodes.js';
import { expandTabs } from './tabstops.js';
import wrapText from './wrap-text.js';
/**
 * Create an element node of the given kind, allocating its yoga layout node
 * unless the kind renders without layout (`ink-virtual-text`, `ink-link`,
 * `ink-progress`).
 * @param nodeName - the element kind to create.
 * @returns the new element node.
 */
export const createNode = (nodeName) => {
    const needsYogaNode = nodeName !== 'ink-virtual-text' &&
        nodeName !== 'ink-link' &&
        nodeName !== 'ink-progress';
    const node = {
        nodeName,
        style: {},
        attributes: {},
        childNodes: [],
        parentNode: undefined,
        yogaNode: needsYogaNode ? createLayoutNode() : undefined,
        dirty: false,
    };
    if (nodeName === 'ink-text') {
        node.yogaNode?.setMeasureFunc(measureTextNode.bind(null, node));
    }
    else if (nodeName === 'ink-raw-ansi') {
        node.yogaNode?.setMeasureFunc(measureRawAnsiNode.bind(null, node));
    }
    return node;
};
/**
 * Append a child element to a parent, moving it from its current parent if
 * any and keeping the yoga tree in sync.
 * @param node - the parent element.
 * @param childNode - the element to append.
 */
export const appendChildNode = (node, childNode) => {
    if (childNode.parentNode) {
        removeChildNode(childNode.parentNode, childNode);
    }
    childNode.parentNode = node;
    node.childNodes.push(childNode);
    if (childNode.yogaNode) {
        node.yogaNode?.insertChild(childNode.yogaNode, node.yogaNode.getChildCount());
    }
    markDirty(node);
};
/**
 * Insert a child before an existing sibling, moving it from its current
 * parent if any and keeping the yoga tree in sync. Nodes without a yoga
 * node do not affect yoga indices.
 * @param node - the parent element.
 * @param newChildNode - the node to insert.
 * @param beforeChildNode - the sibling the new node is inserted before;
 *   when absent from the parent, the new node is appended.
 */
export const insertBeforeNode = (node, newChildNode, beforeChildNode) => {
    if (newChildNode.parentNode) {
        removeChildNode(newChildNode.parentNode, newChildNode);
    }
    newChildNode.parentNode = node;
    const index = node.childNodes.indexOf(beforeChildNode);
    if (index >= 0) {
        // Calculate yoga index BEFORE modifying childNodes.
        // We can't use DOM index directly because some children (like ink-progress,
        // ink-link, ink-virtual-text) don't have yogaNodes, so DOM indices don't
        // match yoga indices.
        let yogaIndex = 0;
        if (newChildNode.yogaNode && node.yogaNode) {
            for (let i = 0; i < index; i++) {
                if (node.childNodes[i]?.yogaNode) {
                    yogaIndex++;
                }
            }
        }
        node.childNodes.splice(index, 0, newChildNode);
        if (newChildNode.yogaNode && node.yogaNode) {
            node.yogaNode.insertChild(newChildNode.yogaNode, yogaIndex);
        }
        markDirty(node);
        return;
    }
    node.childNodes.push(newChildNode);
    if (newChildNode.yogaNode) {
        node.yogaNode?.insertChild(newChildNode.yogaNode, node.yogaNode.getChildCount());
    }
    markDirty(node);
};
/**
 * Remove a child node from a parent, clearing its yoga node, cached rects,
 * and parent reference.
 * @param node - the parent element.
 * @param removeNode - the child node to remove.
 */
export const removeChildNode = (node, removeNode) => {
    if (removeNode.yogaNode) {
        removeNode.parentNode?.yogaNode?.removeChild(removeNode.yogaNode);
    }
    // Collect cached rects from the removed subtree so they can be cleared
    collectRemovedRects(node, removeNode);
    removeNode.parentNode = undefined;
    const index = node.childNodes.indexOf(removeNode);
    if (index >= 0) {
        node.childNodes.splice(index, 1);
    }
    markDirty(node);
};
function collectRemovedRects(parent, removed, underAbsolute = false) {
    if (removed.nodeName === '#text')
        return;
    const elem = removed;
    // If this node or any ancestor in the removed subtree was absolute,
    // its painted pixels may overlap non-siblings — flag for global blit
    // disable. Normal-flow removals only affect direct siblings, which
    // hasRemovedChild already handles.
    const isAbsolute = underAbsolute || elem.style.position === 'absolute';
    const cached = nodeCache.get(elem);
    if (cached) {
        addPendingClear(parent, cached, isAbsolute);
        nodeCache.delete(elem);
    }
    for (const child of elem.childNodes) {
        collectRemovedRects(parent, child, isAbsolute);
    }
}
/**
 * Set an attribute on an element, skipping `children` and unchanged values
 * so unrelated renders do not mark the node dirty.
 * @param node - the element to update.
 * @param key - the attribute name.
 * @param value - the attribute value.
 */
export const setAttribute = (node, key, value) => {
    // Skip 'children' - React handles children via appendChild/removeChild,
    // not attributes. React always passes a new children reference, so
    // tracking it as an attribute would mark everything dirty every render.
    if (key === 'children') {
        return;
    }
    // Skip if unchanged
    if (node.attributes[key] === value) {
        return;
    }
    node.attributes[key] = value;
    markDirty(node);
};
/**
 * Replace an element's style, skipping the write when the new style is
 * shallow-equal to the current one to avoid needless dirty marks.
 * @param node - the node to update.
 * @param style - the new style object.
 */
export const setStyle = (node, style) => {
    // Compare style properties to avoid marking dirty unnecessarily.
    // React creates new style objects on every render even when unchanged.
    if (stylesEqual(node.style, style)) {
        return;
    }
    node.style = style;
    markDirty(node);
};
/**
 * Replace an element's text styles, skipping the write when the new styles
 * are shallow-equal to the current ones to avoid needless dirty marks.
 * @param node - the element to update.
 * @param textStyles - the new text styles.
 */
export const setTextStyles = (node, textStyles) => {
    // Same dirty-check guard as setStyle: React (and buildTextStyles in Text.tsx)
    // allocate a new textStyles object on every render even when values are
    // unchanged, so compare by value to avoid markDirty -> yoga re-measurement
    // on every Text re-render.
    if (shallowEqual(node.textStyles, textStyles)) {
        return;
    }
    node.textStyles = textStyles;
    markDirty(node);
};
function stylesEqual(a, b) {
    return shallowEqual(a, b);
}
function shallowEqual(a, b) {
    // Fast path: same object reference (or both undefined)
    if (a === b)
        return true;
    if (a === undefined || b === undefined)
        return false;
    // Get all keys from both objects
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    // Different number of properties
    if (aKeys.length !== bKeys.length)
        return false;
    // Compare each property
    for (const key of aKeys) {
        if (a[key] !== b[key])
            return false;
    }
    return true;
}
/**
 * Create a text node holding the given string.
 * @param text - the text content.
 * @returns the new text node.
 */
export const createTextNode = (text) => {
    const node = {
        nodeName: '#text',
        nodeValue: text,
        yogaNode: undefined,
        parentNode: undefined,
        style: {},
    };
    setTextNodeValue(node, text);
    return node;
};
const textMeasureCache = new WeakMap();
// Yoga probes several widths/modes repeatedly in one layout. Retain only
// the current text's results so streaming cannot accumulate old snapshots.
const TEXT_MEASURE_CACHE_SIZE = 8;
const measureTextNode = function (node, width, widthMode) {
    const rawText = node.nodeName === '#text' ? node.nodeValue : squashTextNodes(node);
    const textWrap = node.style.textWrap ?? 'wrap';
    let cache = textMeasureCache.get(node);
    if (cache === undefined || cache.rawText !== rawText || cache.wrap !== textWrap) {
        // Tabs use the same measurement expansion as the uncached path.
        cache = { rawText, text: expandTabs(rawText), wrap: textWrap, entries: [] };
        textMeasureCache.set(node, cache);
    }
    for (const entry of cache.entries) {
        if (Object.is(entry.width, width) && entry.widthMode === widthMode)
            return entry.result;
    }
    // Check above before measureText walks every line, even on a wrap-cache hit.
    const result = measureTextDimensions(cache.text, width, widthMode, textWrap);
    if (cache.entries.length === TEXT_MEASURE_CACHE_SIZE)
        cache.entries.shift();
    cache.entries.push({ width, widthMode, result });
    return result;
};
function measureTextDimensions(text, width, widthMode, textWrap) {
    const dimensions = measureText(text, width);
    // Text fits into container, no need to wrap
    if (dimensions.width <= width) {
        return dimensions;
    }
    // This is happening when <Box> is shrinking child nodes and layout asks
    // if we can fit this text node in a <1px space, so we just say "no"
    if (dimensions.width >= 1 && width > 0 && width < 1) {
        return dimensions;
    }
    // For text with embedded newlines (pre-wrapped content), avoid re-wrapping
    // at measurement width when layout is asking for intrinsic size (Undefined mode).
    // This prevents height inflation during min/max size checks.
    //
    // However, when layout provides an actual constraint (Exactly or AtMost mode),
    // we must respect it and measure at that width. Otherwise, if the actual
    // rendering width is smaller than the natural width, the text will wrap to
    // more lines than layout expects, causing content to be truncated.
    if (text.includes('\n') && widthMode === LayoutMeasureMode.Undefined) {
        const effectiveWidth = Math.max(width, dimensions.width);
        return measureText(text, effectiveWidth);
    }
    const wrappedText = wrapText(text, width, textWrap);
    // The wrapper has already chosen physical rows. Reapplying width-based
    // row counting here double-counts trailing spaces at fractional widths.
    return measureText(wrappedText, Infinity);
}
// ink-raw-ansi nodes hold pre-rendered ANSI strings with known dimensions.
// No stringWidth, no wrapping, no tab expansion — the producer (e.g. ColorDiff)
// already wrapped to the target width and each line is exactly one terminal row.
const measureRawAnsiNode = function (node) {
    return {
        width: node.attributes['rawWidth'],
        height: node.attributes['rawHeight'],
    };
};
/**
 * Mark a node and all its ancestors as dirty for re-rendering.
 * Also marks yoga dirty for text remeasurement if this is a text node.
 * @param node - the node whose dirty chain to mark; a no-op when undefined.
 */
export const markDirty = (node) => {
    let current = node;
    let markedYoga = false;
    while (current) {
        if (current.nodeName !== '#text') {
            ;
            (current).dirty = true;
            // Culling can clear the paint dirty bit without preparing changed text.
            // Invalidate at mutation time so re-entry cannot reuse stale content.
            textPaintCache.delete(current);
            // Only mark yoga dirty on leaf nodes that have measure functions
            if (!markedYoga &&
                (current.nodeName === 'ink-text' ||
                    current.nodeName === 'ink-raw-ansi') &&
                current.yogaNode) {
                current.yogaNode.markDirty();
                markedYoga = true;
            }
        }
        current = current.parentNode;
    }
};
/**
 * Invalidate cached layout for a whole subtree — the response to a viewport
 * change.
 *
 * {@link markDirty} walks *upward* from the one node whose content changed,
 * which is the right shape for every ordinary mutation: one node is new, its
 * ancestors need to know. A resize is the opposite shape. Nothing in the tree
 * changed, yet every measurement in it was taken against a width that no
 * longer exists — so the invalidation has to run the other way, down to the
 * leaves, or the nodes that were never touched keep answering with the sizes
 * they computed for the old terminal.
 *
 * @param node - subtree root; a no-op when undefined.
 */
export const markTreeDirty = (node) => {
    const stack = node === undefined ? [] : [node];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current.nodeName === '#text')
            continue;
        const element = current;
        element.dirty = true;
        textPaintCache.delete(element);
        // markDirty() is only legal on yoga nodes that carry a measure function;
        // those are exactly the two text node kinds (see createNode).
        if ((current.nodeName === 'ink-text' || current.nodeName === 'ink-raw-ansi') &&
            current.yogaNode) {
            current.yogaNode.markDirty();
        }
        for (const child of element.childNodes)
            stack.push(child);
    }
};
/**
 * Walk to the root and call its onRender (the throttled scheduleRender).
 * Use for DOM-level mutations (scrollTop changes) that should trigger an
 * Ink frame without going through React's reconciler. Pair with markDirty()
 * so the renderer knows which subtree to re-evaluate.
 * @param node - the node to walk up from; a no-op when undefined.
 */
export const scheduleRenderFrom = (node) => {
    let cur = node;
    while (cur?.parentNode)
        cur = cur.parentNode;
    if (cur && cur.nodeName !== '#text')
        (cur).onRender?.();
};
/**
 * Replace a text node's value, skipping the write when unchanged and
 * marking the node dirty otherwise.
 * @param node - the text node to update.
 * @param text - the new text value; non-strings are stringified.
 */
export const setTextNodeValue = (node, text) => {
    if (typeof text !== 'string') {
        text = String(text);
    }
    // Skip if unchanged
    if (node.nodeValue === text) {
        return;
    }
    node.nodeValue = text;
    markDirty(node);
};
function isDOMElement(node) {
    return node.nodeName !== '#text';
}
/**
 * Clear yogaNode references on a node and its whole subtree before freeing.
 * freeRecursive() frees the node and ALL its children, so every reference
 * must be cleared to prevent dangling pointers.
 * @param node - the node whose subtree to clear.
 */
export const clearYogaNodeReferences = (node) => {
    if ('childNodes' in node) {
        for (const child of node.childNodes) {
            clearYogaNodeReferences(child);
        }
    }
    node.yogaNode = undefined;
};
/**
 * Find the React component stack responsible for content at screen row `y`.
 *
 * DFS the DOM tree accumulating yoga offsets. Returns the debugOwnerChain of
 * the deepest node whose bounding box contains `y`. Called from ink.tsx when
 * log-update triggers a full reset, to attribute the flicker to its source.
 *
 * Only useful when DSH_TUI_DEBUG_REPAINTS is set (otherwise chains are
 * undefined and this returns []).
 * @param root - the ink-root element to search from.
 * @param y - the screen row to locate.
 * @returns the debugOwnerChain of the deepest node containing `y`, or an
 *   empty array when none is recorded.
 */
export function findOwnerChainAtRow(root, y) {
    let best = [];
    walk(root, 0);
    return best;
    function walk(node, offsetY) {
        const yoga = node.yogaNode;
        if (!yoga || yoga.getDisplay() === LayoutDisplay.None)
            return;
        const top = offsetY + yoga.getComputedTop();
        const height = yoga.getComputedHeight();
        if (y < top || y >= top + height)
            return;
        if (node.debugOwnerChain)
            best = node.debugOwnerChain;
        for (const child of node.childNodes) {
            if (isDOMElement(child))
                walk(child, top);
        }
    }
}
