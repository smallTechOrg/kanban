import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Check, Upload } from 'lucide-react';
import { Spinner, cx } from '@/components/ui';
import { useBackgrounds, useUploadBackground } from '@/hooks/useBackgrounds';
import { useBoardMeta } from '@/hooks/useBoardData';
import { useUpdateBoard } from '@/hooks/useBoards';
import { useMeta } from '@/hooks/useMeta';
import { boardBackgroundStyle, type BackgroundStyle } from '@/lib/boardGroups';
import styles from './BoardBackgroundPicker.module.css';

/** The two tabs of Section 2.3.4. */
type Tab = 'colors' | 'custom';

const TABS: readonly Tab[] = ['colors', 'custom'];
const TAB_LABEL: Record<Tab, string> = { colors: 'Colors', custom: 'Custom' };

/** The types `storage.BACKGROUND_EXTENSIONS` accepts; anything else is a 415 (Section 6.9). */
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp';

/** An empty palette with a stable identity, so a render before `['meta']` lands is not a new one. */
const NO_GRADIENTS: Readonly<Record<string, string>> = {};

/** `gradient-ocean` -> "Ocean gradient", `blue` -> "Blue"; the keys come from the server. */
function swatchName(key: string): string {
  const bare = key.replace('gradient-', '');
  const titled = bare.charAt(0).toUpperCase() + bare.slice(1);
  return key.startsWith('gradient-') ? `${titled} gradient` : titled;
}

/**
 * Paint one background on the element that wears the board's, which is how the hover preview of
 * Section 2.3.4 works without committing anything.
 *
 * All four properties are always written, empty string included: `BoardPage` sets the same four
 * as an inline style and React diffs them against its own previous props rather than against the
 * DOM, so a half-written preview would outlive the pointer. `.page` carries
 * `transition: background-color var(--t-bg)`, which is the documented 0.2 s fade.
 */
function paint(surface: HTMLElement | null, style: BackgroundStyle): void {
  if (surface === null) return;
  surface.style.backgroundColor = style.backgroundColor ?? '';
  surface.style.backgroundImage = style.backgroundImage ?? '';
  surface.style.backgroundSize = style.backgroundSize ?? '';
  surface.style.backgroundPosition = style.backgroundPosition ?? '';
}

/** The 96x64 tile an uploaded image is shown as: its 400x240 preview, never the original. */
function imageStyle(thumbUrl: string): BackgroundStyle {
  return {
    backgroundImage: `url("${thumbUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}

export interface BoardBackgroundPickerProps {
  boardId: number;
}

/**
 * The board menu's "Change background" sub-panel (Section 2.3.4): a "Colors" tab holding the four
 * 64x40 gradient thumbnails over the 3x3 grid of 96x64 colour swatches, and a "Custom" tab
 * holding an Upload tile and the caller's previously uploaded images.
 *
 * Every value is the server's. The presets come from `GET /api/boards/{board_id}/backgrounds`,
 * which is `constants.BOARD_COLORS` / `BOARD_GRADIENTS` — the same palettes `GET /api/meta`
 * serves — so no swatch holds a colour of its own (CLAUDE.md section 3). Choosing one is
 * `PATCH /api/boards/{board_id}`: `{background_type, background_value}` for a preset and
 * `{background_image_id}` for a library image, which the server turns into the three background
 * columns and the thumbnail URL itself (Section 4.3). Only the Upload tile has an endpoint of its
 * own, because only it carries bytes.
 *
 * Hovering previews on the element that paints the board background — `BoardPage`'s `<main>`,
 * which is where the code puts what Section 2.3 calls "the body" — and the pointer leaving, the
 * panel closing or the board changing all repaint the board's own. The preview is written to that
 * element directly rather than held in `uiStore`: it is transient, no other component reads it,
 * and a runtime-computed board background is the one inline style Section 5 allows. Focus
 * previews too, so the keyboard sees what the pointer does (Section 5.10).
 */
export function BoardBackgroundPicker({
  boardId,
}: BoardBackgroundPickerProps): ReactElement | null {
  const board = useBoardMeta(boardId).data;
  const gradients = useMeta().data?.board_gradients ?? NO_GRADIENTS;
  const library = useBackgrounds(boardId).data;
  const updateBoard = useUpdateBoard(boardId);
  const { upload, isUploading } = useUploadBackground(boardId);
  const [tab, setTab] = useState<Tab>('colors');
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const surface = useRef<HTMLElement | null>(null);
  const own = useRef<BackgroundStyle>({});

  const backgroundType = board?.background_type;
  const backgroundValue = board?.background_value;
  const backgroundThumb = board?.background_thumb_url ?? null;

  const ownStyle = useMemo<BackgroundStyle>(
    () =>
      backgroundType === undefined || backgroundValue === undefined
        ? {}
        : boardBackgroundStyle(
            {
              background_type: backgroundType,
              background_value: backgroundValue,
              background_thumb_url: backgroundThumb,
            },
            gradients,
          ),
    [backgroundType, backgroundValue, backgroundThumb, gradients],
  );

  useEffect(() => {
    own.current = ownStyle;
  }, [ownStyle]);

  // Resolved on the first preview rather than on mount: the panel renders nothing until the
  // board document lands, so at mount there is no node to walk up from.
  const preview = useCallback((style: BackgroundStyle) => {
    surface.current ??= root.current?.closest<HTMLElement>('main') ?? null;
    paint(surface.current, style);
  }, []);
  const clearPreview = useCallback(() => paint(surface.current, own.current), []);

  // Closing the panel, leaving the board or picking another row must undo an open preview.
  useEffect(() => {
    const painted = surface;
    const restore = own;
    return () => paint(painted.current, restore.current);
  }, []);

  if (board === undefined) return null;

  function swatch(
    key: string,
    label: string,
    style: BackgroundStyle,
    selected: boolean,
    className: string | undefined,
    choose: () => void,
  ): ReactElement {
    return (
      <button
        key={key}
        type="button"
        className={cx(styles.swatch, className)}
        style={style}
        aria-label={label}
        aria-pressed={selected}
        onClick={choose}
        onMouseEnter={() => preview(style)}
        onMouseLeave={clearPreview}
        onFocus={() => preview(style)}
        onBlur={clearPreview}
      >
        {selected ? <Check className={styles.icon} aria-hidden="true" /> : null}
      </button>
    );
  }

  return (
    <div className={styles.panel} ref={root}>
      <div className={styles.tabs} role="tablist" aria-label="Background source">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`background-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`background-panel-${name}`}
            className={cx(styles.tab, tab === name && styles.activeTab)}
            onClick={() => setTab(name)}
          >
            {TAB_LABEL[name]}
          </button>
        ))}
      </div>

      {tab === 'colors' ? (
        <div
          id="background-panel-colors"
          role="tabpanel"
          aria-labelledby="background-tab-colors"
          className={styles.tabPanel}
        >
          <div className={styles.gradients}>
            {(library?.gradients ?? []).map(({ key, css }) =>
              swatch(
                key,
                `${swatchName(key)} background`,
                { backgroundImage: css },
                backgroundType === 'gradient' && backgroundValue === key,
                styles.gradient,
                () => updateBoard.mutate({ background_type: 'gradient', background_value: key }),
              ),
            )}
          </div>
          <div className={styles.tiles}>
            {(library?.colors ?? []).map(({ key, hex }) =>
              swatch(
                key,
                `${swatchName(key)} background`,
                { backgroundColor: hex },
                backgroundType === 'color' && backgroundValue === hex,
                styles.tile,
                () => updateBoard.mutate({ background_type: 'color', background_value: hex }),
              ),
            )}
          </div>
        </div>
      ) : (
        <div
          id="background-panel-custom"
          role="tabpanel"
          aria-labelledby="background-tab-custom"
          className={styles.tabPanel}
        >
          <div className={styles.tiles}>
            <button
              type="button"
              className={cx(styles.swatch, styles.tile, styles.upload)}
              disabled={isUploading}
              onClick={() => fileInput.current?.click()}
            >
              {isUploading ? (
                <Spinner label="Uploading the background" />
              ) : (
                <>
                  <Upload className={styles.icon} aria-hidden="true" />
                  Upload
                </>
              )}
            </button>
            {/* `BoardSummary` carries no `background_image_id` (Section 4.3), and the thumbnail
                URL is that id written out, so it is what names the current tile. */}
            {(library?.custom ?? []).map((image, at) =>
              swatch(
                String(image.id),
                `Custom background ${String(at + 1)}`,
                imageStyle(image.thumb_url),
                backgroundType === 'image' && backgroundThumb === image.thumb_url,
                styles.tile,
                () => updateBoard.mutate({ background_image_id: image.id }),
              ),
            )}
          </div>
          {library !== undefined && library.custom.length === 0 ? (
            <p className={styles.empty}>
              Images you upload stay here, ready for any of your boards.
            </p>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_TYPES}
            className={styles.fileInput}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) upload(file);
              event.target.value = ''; // so picking the same file twice fires again
            }}
          />
        </div>
      )}
    </div>
  );
}
