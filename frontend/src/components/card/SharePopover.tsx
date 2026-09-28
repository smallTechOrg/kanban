import type { ReactElement } from 'react';
import { Button, Field, Popover, TextInput } from '@/components/ui';
import { useCard } from '@/hooks/useBoardData';
import { useToast } from '@/hooks/useToast';
import styles from './SharePopover.module.css';

export interface SharePopoverProps {
  boardId: number;
  cardId: number;
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Share" (Section 2.6.4): the absolute card link with a Copy button, the card number, and the
 * same link as Markdown.
 *
 * `cards.short_id` is the per-board number Section 2.6.2 keeps out of the header and shows here;
 * it comes off the board cache, which every opener of this panel already has. The clipboard is
 * the one browser API that can simply refuse (a denied permission, an insecure origin), so both
 * buttons report failure rather than pretending the copy happened.
 */
export function SharePopover({
  boardId,
  cardId,
  anchor,
  onClose,
}: SharePopoverProps): ReactElement {
  const card = useCard(boardId, cardId).data;
  const { show } = useToast();

  const url = `${window.location.origin}/b/${String(boardId)}/c/${String(cardId)}`;

  function copy(text: string): void {
    void navigator.clipboard
      .writeText(text)
      .then(() => show('Link copied'))
      .catch(() => show("Couldn't copy the link. Copy it from the box instead.", 'error'));
  }

  return (
    <Popover anchor={anchor} title="Share" onClose={onClose}>
      <div className={styles.body}>
        <Field label="Link to this card">
          {(control) => <TextInput {...control} value={url} readOnly />}
        </Field>
        <Button onClick={() => copy(url)}>Copy</Button>
        {card === undefined ? null : <p className={styles.number}>Card #{card.short_id}</p>}
        <Button onClick={() => copy(`[${card?.title ?? 'Card'}](${url})`)}>Copy as Markdown</Button>
      </div>
    </Popover>
  );
}
