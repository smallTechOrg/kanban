import { useEffect, useState, type ReactElement } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { CardDetail } from '@/api/types';
import { Button, cx } from '@/components/ui';
import { useMeta } from '@/hooks/useMeta';
import { coverStyle, type CoverPalette } from '@/lib/colors';
import { CoverPopover } from './CoverPopover';
import styles from './CardCoverStrip.module.css';

const NO_PALETTE: CoverPalette = {};

export interface CardCoverStripProps {
  boardId: number;
  card: CardDetail;
}

/**
 * The 160px cover band at the top of the card modal (Section 2.6.1), with the "Cover" button in
 * its bottom-right corner. Nothing renders while the card has no cover: the same button lives in
 * the sidebar, so an empty band would be a second control for a card with nothing to show.
 *
 * An image cover paints the **original** attachment here, as Trello does, and falls back to the
 * 512x256 thumbnail `cover.image_url` until that file has loaded — or for good, when the card's
 * `attachments` are not in the `['card', id]` cache, which is every open from a tile. Both are
 * `object-fit: contain` in the same box over the image's dominant colour, so the swap is
 * invisible; the tiles of Section 2.5.1 always use the thumbnail and never the original.
 */
export function CardCoverStrip({ boardId, card }: CardCoverStripProps): ReactElement | null {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [isOriginalLoaded, setIsOriginalLoaded] = useState(false);
  const palette: CoverPalette = useMeta().data?.cover_colors ?? NO_PALETTE;

  const cover = card.cover;
  const original =
    cover === null || cover.kind !== 'attachment'
      ? null
      : (card.attachments.find((attachment) => attachment.id === Number(cover.value))?.url ?? null);

  // A new cover is a new file, so the thumbnail leads again until that one has loaded.
  useEffect(() => {
    setIsOriginalLoaded(false);
  }, [original]);

  if (cover === null) return null;
  const { background, imageUrl } = coverStyle(cover, palette);

  return (
    <div className={styles.strip} style={{ background }}>
      {imageUrl === null ? null : (
        <img
          className={cx(styles.image, isOriginalLoaded && styles.hidden)}
          src={imageUrl}
          alt=""
        />
      )}
      {original === null ? null : (
        <img
          className={cx(styles.image, !isOriginalLoaded && styles.hidden)}
          src={original}
          alt=""
          onLoad={() => setIsOriginalLoaded(true)}
        />
      )}

      <Button
        className={styles.button}
        icon={<ImageIcon aria-hidden="true" />}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        Cover
      </Button>

      {anchor === null ? null : (
        <CoverPopover
          anchor={anchor}
          boardId={boardId}
          cardId={card.id}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}
