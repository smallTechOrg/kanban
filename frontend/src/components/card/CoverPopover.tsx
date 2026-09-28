import { useId, useRef, type ReactElement } from 'react';
import { Button, Popover, cx } from '@/components/ui';
import { useCard } from '@/hooks/useBoardData';
import { useCardDetail } from '@/hooks/useCard';
import { useClearCover, useSetCover, useUploadAttachments } from '@/hooks/useCardMutations';
import { useMeta } from '@/hooks/useMeta';
import type { CoverSize } from '@/api/types';
import { coverStyle, type CoverPalette } from '@/lib/colors';
import { UploadProgress } from './UploadProgress';
import styles from './CoverPopover.module.css';

const NO_PALETTE: CoverPalette = {};

/** The two preview tiles of Section 2.6.5, in the order they are shown. */
const SIZES: readonly CoverSize[] = ['normal', 'full'];

const SIZE_LABEL: Record<CoverSize, string> = { normal: 'Normal cover', full: 'Full cover' };

export interface CoverPopoverProps {
  boardId: number;
  cardId: number;
  /** The control the panel hangs off: the strip's "Cover" button, a sidebar row, the quick editor. */
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Cover" (Section 2.6.5): the two size tiles, "Remove cover", the ten colour swatches, the
 * card's own image attachments as 88x44 thumbnails, and "Upload a cover image".
 *
 * Every one of them is the same `PUT /api/cards/{card_id}/cover` with a different `{kind, value,
 * size}` — which is why the size tiles rewrite the cover the card already has rather than holding
 * a draft, and are inert until there is one to resize. The ten colours are `meta.cover_colors`,
 * never a second list (CLAUDE.md section 3), and the thumbnails are the card's `attachments` rows
 * the server will accept as a cover: an image with a thumbnail, which is exactly what it validates.
 *
 * "Upload a cover image" is the documented two-step (Section 5.8): the same multipart upload as
 * `AttachmentPopover`, then the cover set on the row it returns, which is why this panel owns an
 * upload hook of its own and shows its progress while the bytes are on the wire.
 */
export function CoverPopover({
  boardId,
  cardId,
  anchor,
  onClose,
}: CoverPopoverProps): ReactElement {
  const [colorsId, sizesId] = [useId(), useId()];
  const fileRef = useRef<HTMLInputElement>(null);

  const palette: CoverPalette = useMeta().data?.cover_colors ?? NO_PALETTE;
  const detail = useCardDetail(cardId).data;
  const row = useCard(boardId, cardId).data;
  const cover = detail?.cover ?? row?.cover ?? null;

  const setCover = useSetCover(boardId, cardId);
  const clearCover = useClearCover(boardId, cardId);
  const { upload, pending } = useUploadAttachments(boardId, cardId);

  const size: CoverSize = cover?.size ?? 'normal';
  const images = (detail?.attachments ?? []).filter(
    (attachment) => attachment.is_image && attachment.thumb_url !== null,
  );
  const fill = cover === null ? 'var(--pressed)' : coverStyle(cover, palette).background;

  function chooseSize(next: CoverSize): void {
    if (cover === null) return;
    setCover.mutate({ kind: cover.kind, value: cover.value, size: next });
  }

  return (
    <Popover anchor={anchor} title="Cover" onClose={onClose}>
      <div className={styles.panel}>
        <p className={styles.subheading} id={sizesId}>
          Size
        </p>
        <div className={styles.sizes} role="group" aria-labelledby={sizesId}>
          {SIZES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={cx(styles.preview, size === candidate && styles.selected)}
              aria-label={SIZE_LABEL[candidate]}
              aria-pressed={size === candidate}
              disabled={cover === null}
              onClick={() => chooseSize(candidate)}
            >
              {candidate === 'full' ? (
                // A runtime colour, which is the one inline-style exception (CLAUDE.md 5).
                <span className={styles.previewFull} style={{ background: fill }} />
              ) : (
                <>
                  <span className={styles.previewBand} style={{ background: fill }} />
                  <span className={styles.previewLines} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </>
              )}
            </button>
          ))}
        </div>

        <Button fullWidth disabled={cover === null} onClick={() => clearCover.mutate()}>
          Remove cover
        </Button>

        <p className={styles.subheading} id={colorsId}>
          Colors
        </p>
        <div className={styles.colors} role="group" aria-labelledby={colorsId}>
          {Object.entries(palette).map(([key, hex]) => {
            const isOn = cover?.kind === 'color' && cover.value === key;
            return (
              <button
                key={key}
                type="button"
                className={cx(styles.swatch, isOn && styles.selected)}
                style={{ background: hex }}
                aria-label={key}
                aria-pressed={isOn}
                onClick={() => setCover.mutate({ kind: 'color', value: key, size })}
              />
            );
          })}
        </div>

        {images.length === 0 ? null : (
          <>
            <p className={styles.subheading}>Attachments</p>
            <div className={styles.thumbs}>
              {images.map((attachment) => {
                const isOn = cover?.kind === 'attachment' && cover.value === String(attachment.id);
                return (
                  <button
                    key={attachment.id}
                    type="button"
                    className={cx(styles.thumb, isOn && styles.selected)}
                    aria-label={`Cover from ${attachment.name}`}
                    aria-pressed={isOn}
                    onClick={() =>
                      setCover.mutate({
                        kind: 'attachment',
                        value: String(attachment.id),
                        size,
                      })
                    }
                  >
                    {attachment.thumb_url === null ? null : (
                      <img className={styles.thumbImage} src={attachment.thumb_url} alt="" />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <Button fullWidth onClick={() => fileRef.current?.click()}>
          Upload a cover image
        </Button>
        <input
          ref={fileRef}
          className={styles.file}
          type="file"
          accept="image/*"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file === undefined) return;
            upload([file], (attachment) => {
              setCover.mutate({ kind: 'attachment', value: String(attachment.id), size });
            });
          }}
        />

        {pending.map((file) => (
          <UploadProgress key={file.key} name={file.name} progress={file.progress} />
        ))}
      </div>
    </Popover>
  );
}
