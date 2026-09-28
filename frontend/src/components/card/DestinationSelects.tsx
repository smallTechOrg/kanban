import { useEffect, useState, type ReactElement } from 'react';
import { Field, Select } from '@/components/ui';
import { useDestinationBoardOptions, useDestinationLists } from '@/hooks/useMoveTargets';
import { defaultSlot, destinationSlots, slotIndex, slotLabel } from '@/lib/moveTargets';
import type { Id } from '@/lib/boardState';
import styles from './DestinationSelects.module.css';

/** What the three selects add up to: the body both `/move` and `/copy` take (Section 4.9). */
export interface Destination {
  boardId: Id;
  listId: Id;
  /** 0-based slot over the destination's active cards — the index form, never a position. */
  index: number;
}

export interface DestinationSelectsProps {
  /** The card's own board; the Board select preselects it (Section 2.6.5). */
  boardId: number;
  /** The list the card sits in now; the List select preselects it. */
  listId: Id;
  /**
   * The card's own 0-based slot in that list, for a move: the card is not one of the siblings
   * the server counts, so its own list offers one slot fewer and that slot reads "(current)".
   * A copy passes nothing — its new row takes a slot of its own.
   */
  currentIndex?: number | null;
  /** The chosen destination, or `null` while the chosen board has no list to receive the card. */
  onChange: (destination: Destination | null) => void;
}

/**
 * The "Board / List / Position" selects of Section 2.6.5, shared by `MoveCardPopover` and
 * `CopyCardPopover` because the plan gives both "the same three selects" with the same data
 * sources — the boards from `['boards']` `all[]`, the lists from the board cache for the open
 * board and from `['lists', boardId]` for any other.
 *
 * It reports its choice upwards instead of taking a value, so the parent holds one `Destination`
 * and neither popover repeats the default-resolution this component does: a board switched to
 * while its lists are still loading falls back to the first list that arrives, and a slot beyond
 * the new list's length falls back to the default slot rather than sending an index nobody chose.
 *
 * No position is computed here; `lib/moveTargets.ts` owns the slot arithmetic.
 */
export function DestinationSelects({
  boardId,
  listId,
  currentIndex = null,
  onChange,
}: DestinationSelectsProps): ReactElement {
  const [boardChoice, setBoardChoice] = useState<Id>(boardId);
  const [listChoice, setListChoice] = useState<Id | null>(listId);
  const [slotChoice, setSlotChoice] = useState<number | null>(null);

  const boardOptions = useDestinationBoardOptions(boardId);
  const { lists, isPending } = useDestinationLists(boardId, boardChoice);

  const list = lists.find((row) => row.id === listChoice) ?? lists[0];
  const chosenListId = list?.id ?? null;
  const isSourceList = chosenListId === listId && boardChoice === boardId;
  const slots = destinationSlots({
    cardCount: list?.card_count ?? 0,
    currentIndex: isSourceList ? currentIndex : null,
  });
  const slot =
    slotChoice !== null && slotChoice >= 1 && slotChoice <= slots.count
      ? slotChoice
      : defaultSlot(slots);

  useEffect(() => {
    onChange(
      chosenListId === null
        ? null
        : { boardId: boardChoice, listId: chosenListId, index: slotIndex(slot) },
    );
  }, [boardChoice, chosenListId, slot, onChange]);

  /** A different board invalidates both choices below it, which then re-derive their defaults. */
  function pickBoard(next: Id): void {
    setBoardChoice(next);
    setListChoice(null);
    setSlotChoice(null);
  }

  return (
    <div className={styles.selects}>
      <Field label="Board">
        {(control) => (
          <Select
            {...control}
            value={String(boardChoice)}
            onChange={(event) => pickBoard(Number(event.target.value))}
          >
            {boardOptions.map((board) => (
              <option key={board.id} value={String(board.id)}>
                {board.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="List">
        {(control) => (
          <Select
            {...control}
            value={chosenListId === null ? '' : String(chosenListId)}
            disabled={chosenListId === null}
            onChange={(event) => {
              setListChoice(Number(event.target.value));
              setSlotChoice(null);
            }}
          >
            {chosenListId === null ? (
              <option value="">{isPending ? 'Loading…' : 'This board has no lists'}</option>
            ) : (
              lists.map((row) => (
                <option key={row.id} value={String(row.id)}>
                  {row.name}
                </option>
              ))
            )}
          </Select>
        )}
      </Field>

      <Field label="Position">
        {(control) => (
          <Select
            {...control}
            value={String(slot)}
            disabled={chosenListId === null}
            onChange={(event) => setSlotChoice(Number(event.target.value))}
          >
            {Array.from({ length: slots.count }, (_, offset) => offset + 1).map((option) => (
              <option key={option} value={String(option)}>
                {slotLabel(option, slots.currentSlot)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
