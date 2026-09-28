import { useState, type ReactElement } from 'react';
import type { ChecklistItem } from '@/api/types';
import { Button, DatePicker, Popover, TextInput } from '@/components/ui';
import { useUpdateChecklistItem } from '@/hooks/useCardMutations';
import { dateInputValue, timeInputValue, toUtcIso, tomorrowNoon } from '@/lib/dates';
import styles from './ItemDuePopover.module.css';

/**
 * Section 2.6.5: an item with no due date yet offers 12:00 PM local, the same noon the card's
 * first "Due date" tick offers. `lib/dates.ts` owns which hour that is.
 */
function defaultTime(): string {
  return timeInputValue(tomorrowNoon());
}

export interface ItemDuePopoverProps {
  boardId: number;
  cardId: number;
  item: ChecklistItem;
  /** The row's calendar `IconButton`. */
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Change due date" (Section 2.6.5): the single-day calendar, a time input, "Save" and "Remove",
 * saved as one `PATCH /api/checklist-items/{item_id}` `{due_at}`.
 *
 * The pair is read as browser-local wall time and converted to the UTC instant the API stores by
 * `lib/dates.ts`, the one place that conversion lives; "Remove" sends `null`. The form seeds
 * itself from the item it was opened on, so it needs no request of its own — the card detail the
 * modal already holds is where that row comes from.
 */
export function ItemDuePopover({
  boardId,
  cardId,
  item,
  anchor,
  onClose,
}: ItemDuePopoverProps): ReactElement {
  const [date, setDate] = useState(
    item.due_at === null ? dateInputValue(new Date()) : dateInputValue(item.due_at),
  );
  const [time, setTime] = useState(
    item.due_at === null ? defaultTime() : timeInputValue(item.due_at),
  );
  const update = useUpdateChecklistItem(boardId, cardId);

  const selected = date === '' ? undefined : new Date(`${date}T00:00`);

  function save(): void {
    update.mutate({ itemId: item.id, due_at: toUtcIso(date, time) });
    onClose();
  }

  function remove(): void {
    update.mutate({ itemId: item.id, due_at: null });
    onClose();
  }

  return (
    <Popover anchor={anchor} title="Change due date" onClose={onClose}>
      <div className={styles.form}>
        <DatePicker
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(day) => {
            if (day !== undefined) setDate(dateInputValue(day));
          }}
        />

        <div className={styles.pair}>
          <TextInput
            type="date"
            aria-label="Due date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <TextInput
            type="time"
            aria-label="Due time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </div>

        <Button variant="primary" fullWidth onClick={save}>
          Save
        </Button>
        <Button fullWidth onClick={remove}>
          Remove
        </Button>
      </div>
    </Popover>
  );
}
