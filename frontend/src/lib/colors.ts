/**
 * Colour resolution. Design tokens are referenced by name and resolved by the browser
 * from styles/tokens.css; label, cover and board palettes come from GET /api/meta and are
 * never hard-coded (CLAUDE.md section 3, Section 5.6).
 *
 * The palette shapes are declared structurally here rather than imported from api/types.ts,
 * because lib/ depends on no other layer and types.ts is regenerated from OpenAPI.
 */

/** Colour tokens lib/ and components may name. Values live in styles/tokens.css. */
export type ColorToken =
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'text'
  | 'text-muted'
  | 'logo'
  | 'border'
  | 'hover';

/** `tokenVar('success')` -> `var(--success)`, for the runtime-computed inline styles 5.x allows. */
export function tokenVar(token: ColorToken): string {
  return `var(--${token})`;
}

export type LabelTone = 'subtle' | 'normal' | 'bold';

/** One row of `meta.label_colors` (Section 2.9.2). */
export interface LabelColorSet {
  subtle: string;
  normal: string;
  bold: string;
  text: string;
  text_bold: string;
}

export type LabelPalette = Record<string, LabelColorSet>;

export interface LabelStyle {
  background: string;
  color: string;
}

/** The palette key an unknown or absent colour falls back to. */
export const FALLBACK_LABEL_KEY = 'none';

/**
 * Resolves a label's background and text colour from the server palette.
 * An unknown key falls back to `none`; a palette without `none` falls back to tokens.
 */
export function labelStyle(key: string, tone: LabelTone, palette: LabelPalette): LabelStyle {
  const colors = palette[key] ?? palette[FALLBACK_LABEL_KEY];
  if (colors === undefined) {
    return { background: tokenVar('hover'), color: tokenVar('text') };
  }
  return { background: colors[tone], color: tone === 'bold' ? colors.text_bold : colors.text };
}

/** `meta.list_colors`: the ten column colours keyed `green … gray` (Sections 2.4.1 and 4.4). */
export type ListPalette = Record<string, string>;

/**
 * The background of a list column: the server's hex for `lists.color`, or the default grey
 * column when the list has no colour or carries a key this server does not publish
 * (Section 2.4.1). The `--list-bg` token is the only value that is not a palette entry,
 * which is why the fallback is named rather than literal.
 */
export function listBackground(key: string | null, palette: ListPalette): string {
  if (key === null) return 'var(--list-bg)';
  return palette[key] ?? 'var(--list-bg)';
}

/** `meta.cover_colors`: the ten card-cover colours keyed `green … gray` (Sections 2.6.5, 4.7). */
export type CoverPalette = Record<string, string>;

/**
 * A card's `cover`, declared structurally like the palettes above so `lib/` keeps depending on
 * nothing: it is `CardCover` (`api/types.ts`) and `CoverRow` (`boardState.ts`), which are the
 * same five fields.
 */
export interface CoverInput {
  kind: 'color' | 'attachment';
  value: string;
  image_url?: string;
  dominant_color?: string;
}

export interface CoverStyle {
  /** What fills the band: the palette's hex for a colour cover, the image's dominant colour
   *  under an image one — which is what `object-fit: contain` leaves showing (Section 2.5.1). */
  background: string;
  /** The 2:1 thumbnail of an image cover, or null for a colour cover. */
  imageUrl: string | null;
}

/**
 * The fill and the image behind a cover, for the tile's band (Section 2.5.1) and the modal's
 * 160px strip (Section 2.6.1). Both read the same two fields off the same `cover` object, so the
 * rule — a colour cover is a `cover_colors` key, an image cover paints `image_url` over its
 * `dominant_color`, and anything the server did not send falls back to the neutral wash — is
 * written once here rather than in each of them.
 */
export function coverStyle(cover: CoverInput, palette: CoverPalette): CoverStyle {
  if (cover.kind === 'color') {
    return { background: palette[cover.value] ?? tokenVar('hover'), imageUrl: null };
  }
  return {
    background: cover.dominant_color ?? tokenVar('hover'),
    imageUrl: cover.image_url ?? null,
  };
}

/**
 * Which diagonal-stripe pattern a label wears in the colourblind-friendly mode of Section
 * 2.6.5. The answer is the label's slot in the server's own palette, so the ten keys get ten
 * different patterns and no component writes a second list of them down; a key this palette
 * does not publish has no pattern and answers -1.
 */
export function labelPatternIndex(key: string, palette: LabelPalette): number {
  return Object.keys(palette).indexOf(key);
}
