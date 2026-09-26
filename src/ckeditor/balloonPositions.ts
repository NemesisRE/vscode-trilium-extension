import { type Editor, type PositioningFunction } from 'ckeditor5';

const VERTICAL_GAP = 10;
const HORIZONTAL_MARGIN = 4;

/**
 * Widget toolbar balloons (see inline_icon_toolbar.ts) are centered over their target by
 * CKEditor's own named position presets, which only offer a few discrete, fixed-offset
 * alignments (dead center, or edge-aligned with a constant ~25px arrow gap). None of them
 * adapt to how little room is actually left near an edge, so a widget close to the left or
 * right edge of a narrow editing pane - a real scenario here, since a VS Code editor pane
 * can be much narrower than Trilium's own browser tab - still gets a balloon that renders
 * partly off-screen (confirmed with a headless reproduction: an icon at x=10 in a 360px-wide
 * pane got a balloon at `left: -15px` even with the edge-aligned preset selected, because
 * that preset's offset is a flat 25px regardless of how much space remains).
 *
 * These two positions clamp the balloon horizontally to the editing root's own visible
 * bounds instead of using a fixed offset, and drop the arrow - which would otherwise point
 * away from the target once the balloon has been shifted off the presets' assumed spot -
 * rather than let the balloon go off-screen.
 */
export function edgeClampedToolbarPositions(editor: Editor): PositioningFunction[] {
  const clampLeft = (idealLeft: number, balloonWidth: number) => {
    const root = editor.editing.view.getDomRoot();
    const bounds = root?.getBoundingClientRect();
    const min = (bounds ? bounds.left : 0) + HORIZONTAL_MARGIN;
    const viewportRight = bounds ? bounds.right : document.documentElement.clientWidth;
    const max = Math.max(min, viewportRight - balloonWidth - HORIZONTAL_MARGIN);
    return Math.min(Math.max(idealLeft, min), max);
  };

  const north: PositioningFunction = (targetRect, balloonRect) => ({
    top: targetRect.top - balloonRect.height - VERTICAL_GAP,
    left: clampLeft(targetRect.left + targetRect.width / 2 - balloonRect.width / 2, balloonRect.width),
    name: 'arrow_s',
    config: { withArrow: false },
  });

  const south: PositioningFunction = (targetRect, balloonRect) => ({
    top: targetRect.bottom + VERTICAL_GAP,
    left: clampLeft(targetRect.left + targetRect.width / 2 - balloonRect.width / 2, balloonRect.width),
    name: 'arrow_n',
    config: { withArrow: false },
  });

  return [north, south];
}
