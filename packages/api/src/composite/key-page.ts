/**
 * Key-page geometry and the ffmpeg filter graph that draws it. Both are pure: no
 * process is started and no file is read here, so the layout can be unit-tested.
 *
 * Layout: the frame is width x height. The slide keeps its native aspect (10:16 or 9:16),
 * is scaled to slideScale of the frame height, sits at the left or right edge and is
 * centred vertically unless offsetY moves it (-1 top edge, 1 bottom edge). Everything else is the background: the key colour for chroma keying,
 * black for luma keying, and fully transparent for the ATEM media still (atem-media).
 */

import type { CompositeOutputKind, CompositeSide, KeyMode, SlideAspect } from "./composite-model.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KeyPageGeometry {
  width: number;
  height: number;
  side: CompositeSide;
  /** Where the slide is drawn. */
  slide: Rect;
  /** Fill colour of everything outside the slide, "#rrggbb". */
  background: string;
  /** True when the background must carry alpha 0 (ATEM media still). */
  transparent: boolean;
}

export interface KeyPageInput {
  kind: CompositeOutputKind;
  width: number;
  height: number;
  side: CompositeSide;
  slideAspect: SlideAspect;
  slideScale: number;
  /** -1 left edge, 0 centred, 1 right edge. Missing means the edge named by `side`. */
  offsetX?: number;
  /** -1 top edge, 0 centred, 1 bottom edge. Missing means centred. */
  offsetY?: number;
  keyColor: string;
  keyMode: KeyMode;
}

const SLIDE_RATIO: Record<SlideAspect, number> = {
  "10:16": 10 / 16,
  "9:16": 9 / 16
};

/** Round to the nearest even number, the same rule the video effects use. */
export function makeEven(value: number): number {
  return Math.round(value / 2) * 2;
}

export function keyPageGeometry(input: KeyPageInput): KeyPageGeometry {
  const slideHeight = Math.min(input.height, makeEven(input.height * input.slideScale));
  const slideWidth = Math.min(input.width, makeEven(slideHeight * SLIDE_RATIO[input.slideAspect]));
  // Vertical placement: centred at offsetY 0, flush with the top or bottom edge at -1 or 1.
  // Both heights are even, so the free space is even and the centred offset is whole.
  const free = input.height - slideHeight;
  const y = Math.round(free / 2 + (input.offsetY ?? 0) * (free / 2));
  const freeX = input.width - slideWidth;
  const x =
    input.offsetX === undefined
      ? input.side === "left"
        ? 0
        : freeX
      : Math.round(freeX / 2 + input.offsetX * (freeX / 2));

  const transparent = input.kind === "atem-media";
  const background = input.keyMode === "luma" ? "#000000" : input.keyColor;

  return {
    width: input.width,
    height: input.height,
    side: input.side,
    slide: { x, y, width: slideWidth, height: slideHeight },
    background,
    transparent
  };
}

/**
 * The filter_complex for one slide frame. Input 0 is the slide (a PNG on stdin); the
 * background is generated, so the only input is [0:v]. The output label is [out].
 */
export function keyPageFilterGraph(geometry: KeyPageGeometry): string {
  const { width, height, slide } = geometry;
  const colour = geometry.transparent ? "black@0" : `0x${geometry.background.slice(1)}`;
  return [
    `color=c=${colour}:s=${width}x${height}:r=1,format=rgba[bg]`,
    `[0:v]scale=${slide.width}:${slide.height}:flags=lanczos,format=rgba[slide]`,
    `[bg][slide]overlay=x=${slide.x}:y=${slide.y}:format=auto,format=rgba[out]`
  ].join(";");
}
