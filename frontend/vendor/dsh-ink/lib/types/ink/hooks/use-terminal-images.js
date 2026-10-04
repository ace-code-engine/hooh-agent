import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
const noCellSize = () => undefined;
const noProtocol = () => undefined;
/**
 * The protocol images are painted with, or undefined without graphics.
 *
 * Kitty provides persistent placements; Sixel paints rasters into the
 * renderer-managed transcript surface. Both may host inline media as long as
 * the placement joins the normal image lifecycle (a `presentation` of
 * `'transcript'` or `'preview'`), which is the real capability boundary.
 */
export function useTerminalImageProtocol() {
    const images = useContext(TerminalImagesContext);
    return useSyncExternalStore(images.subscribe, images.getProtocol ?? noProtocol);
}
/** Only measured pixels qualify for an original-pixel (100%) image view. */
export function useTerminalImageCellSize() {
    const images = useContext(TerminalImagesContext);
    return useSyncExternalStore(images.subscribe, images.getCellSize ?? noCellSize);
}
export const TerminalImagesContext = createContext({
    subscribe: () => () => { },
    getSnapshot: () => false,
    request: () => () => { },
});
/** Request the renderer's capability probe before reading or decoding pixels. */
export function useTerminalImages(requested = true) {
    const images = useContext(TerminalImagesContext);
    const available = useSyncExternalStore(images.subscribe, images.getSnapshot);
    useEffect(() => {
        if (requested)
            return images.request();
    }, [images, requested]);
    return requested && available;
}
