import { useState, type ReactElement } from 'react';
import type { DateRange } from 'react-day-picker';
import type { CardDetail, DueReminderMinutes } from '@/api/types';
import type { UpdateCardInput } from '@/api/cards';
import {
  Button,
  Checkbox,
  DatePicker,
  Field,
  Popover,
  Select,
  Spinner,
  TextInput,
} from '@/components/ui';
import { useCardDetail } from '@/hooks/useCard';
import { useUpdateCardFields } from '@/hooks/useCardMutations';
import { dateInputValue, timeInputValue, toUtcIso, tomorrowNoon } from '@/lib/dates';
import styles from './DatesPopover.module.css';

/**
 * A start date has a date but no time input (Section 2.6.5), so it is stored at local midnight;
 * `lib/dates.ts` converts the pair to the UTC instant the API keeps.
 */
const START_TIME = '00:00';

/** The nine reminder offsets of Section 2.6.5, in the order the select lists them. */
const REMINDERS: readonly { value: DueReminderMinutes; label: string }[] = [
  { value: 0, label: 'At time of due date' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
];

/** The select's "None": no reminder is stored (`due_reminder_minutes: null`). */
const NO_REMINDER = '';

interface DatesFormProps {
  card: CardDetail;
  onSave: (patch: UpdateCardInput) => void;
  onRemove: () => void;
}

/**
 * The body of the "Dates" panel: the month view, the two date rows and the reminder select
 * (Section 2.6.5).
 *
 * It is its own component so the draft can be seeded from the card exactly once — a `useState`
 * in the parent would either re-seed on every render of the popover or need an effect to catch
 * the card arriving from the network.
 */
function DatesForm({ card, onSave, onRemove }: DatesFormProps): ReactElement {
  const [startOn, setStartOn] = useState(card.start_at !== null);
  const [startDate, setStartDate] = useState(
    card.start_at === null ? '' : dateInputValue(card.start_at),
  );
  const [dueOn, setDueOn] = useState(card.due_at !== null);
  const [dueDate, setDueDate] = useState(card.due_at === null ? '' : dateInputValue(card.due_at));
  const [dueTime, setDueTime] = useState(card.due_at === null ? '' : timeInputValue(card.due_at));
  const [reminder, setReminder] = useState<DueReminderMinutes | null>(
    // Only the eight documented offsets can be stored, so the column is one of them or null.
    card.due_reminder_minutes as DueReminderMinutes | null,
  );

  const start = startOn && startDate !== '' ? new Date(`${startDate}T${START_TIME}`) : undefined;
  const due = dueOn && dueDate !== '' ? new Date(`${dueDate}T${START_TIME}`) : undefined;

  /** The first tick of "Due date" offers tomorrow at 12:00 PM local (Section 2.6.5). */
  function toggleDue(checked: boolean): void {
    setDueOn(checked);
    if (!checked || dueDate !== '') return;
    const suggestion = tomorrowNoon();
    setDueDate(dateInputValue(suggestion));
    setDueTime(timeInputValue(suggestion));
  }

  function toggleStart(checked: boolean): void {
    setStartOn(checked);
    if (checked && startDate === '') setStartDate(dateInputValue(new Date()));
  }

  /** A click in the calendar fills the row the checkboxes say it belongs to. */
  function pickDay(day: Date | undefined): void {
    if (day === undefined) return;
    if (startOn && !dueOn) {
      setStartDate(dateInputValue(day));
      return;
    }
    setDueDate(dateInputValue(day));
    if (!dueOn) toggleDue(true);
    if (dueTime === '') setDueTime(timeInputValue(tomorrowNoon()));
  }

  function pickRange(range: DateRange | undefined): void {
    if (range?.from !== undefined) setStartDate(dateInputValue(range.from));
    if (range?.to !== undefined) setDueDate(dateInputValue(range.to));
  }

  function save(): void {
    onSave({
      start_at: startOn ? toUtcIso(startDate, START_TIME) : null,
      due_at: dueOn ? toUtcIso(dueDate, dueTime) : null,
      due_reminder_minutes: dueOn ? reminder : null,
    });
  }

  return (
    <div className={styles.form}>
      {startOn && dueOn ? (
        <DatePicker
          mode="range"
          selected={{ from: start, to: due }}
          onSelect={pickRange}
          defaultMonth={start ?? due}
        />
      ) : (
        <DatePicker
          mode="single"
          selected={due ?? start}
          onSelect={pickDay}
          defaultMonth={due ?? start}
        />
      )}

      <div className={styles.row}>
        <Checkbox
          label="Start date"
          checked={startOn}
          onChange={(event) => toggleStart(event.target.checked)}
        />
        <TextInput
          type="date"
          aria-label="Start date"
          disabled={!startOn}
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
      </div>

      <div className={styles.row}>
        <Checkbox
          label="Due date"
          checked={dueOn}
          onChange={(event) => toggleDue(event.target.checked)}
        />
        <div className={styles.pair}>
          <TextInput
            type="date"
            aria-label="Due date"
            disabled={!dueOn}
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <TextInput
            type="time"
            aria-label="Due time"
            disabled={!dueOn}
            value={dueTime}
            onChange={(event) => setDueTime(event.target.value)}
          />
        </div>
      </div>

      <Field label="Set due date reminder">
        {(control) => (
          <Select
            {...control}
            value={reminder === null ? NO_REMINDER : String(reminder)}
            onChange={(event) =>
              setReminder(
                REMINDERS.find((option) => String(option.value) === event.target.value)?.value ??
                  null,
              )
            }
          >
            <option value={NO_REMINDER}>None</option>
            {REMINDERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Button variant="primary" fullWidth onClick={save}>
        Save
      </Button>
      <Button fullWidth onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

export interface DatesPopoverProps {
  boardId: number;
  cardId: number;
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Dates" (Section 2.6.5): the `react-day-picker` month view, the start and due rows, the time
 * input and the reminder select, saved as one `PATCH /api/cards/{card_id}`.
 *
 * Both fields are read as browser-local wall time and converted to the UTC instant the API
 * stores by `lib/dates.ts`, the one place that conversion lives. "Remove" sends the three nulls
 * the endpoint allows (`start_at`, `due_at`, `due_reminder_minutes`, Section 4.5) — clearing a
 * date leaves one `card.due_removed` row in the feed, not one per field.
 *
 * The panel reads `['card', cardId]`, which the modal has already loaded: the reminder offset is
 * a detail-only field, so the board payload alone cannot seed this form.
 */
export function DatesPopover({
  boardId,
  cardId,
  anchor,
  onClose,
}: DatesPopoverProps): ReactElement {
  const { data: card } = useCardDetail(cardId);
  const updateCard = useUpdateCardFields(boardId, cardId);

  function save(patch: UpdateCardInput): void {
    updateCard.mutate(patch);
    onClose();
  }

  function remove(): void {
    updateCard.mutate({ start_at: null, due_at: null, due_reminder_minutes: null });
    onClose();
  }

  return (
    <Popover anchor={anchor} title="Dates" onClose={onClose}>
      {card === undefined ? (
        <Spinner size={24} label="Loading dates" />
      ) : (
        <DatesForm card={card} onSave={save} onRemove={remove} />
      )}
    </Popover>
  );
}
