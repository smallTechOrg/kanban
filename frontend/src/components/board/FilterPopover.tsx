import { useId, type ReactElement } from 'react';
import { Avatar, Checkbox, Field, Popover, Select, TextInput } from '@/components/ui';
import { LabelChip } from '@/components/ui/LabelChip';
import { useMe } from '@/hooks/useAuth';
import { useLabels, useMembers } from '@/hooks/useBoardData';
import { useMeta } from '@/hooks/useMeta';
import type { Id } from '@/lib/boardState';
import type { LabelPalette } from '@/lib/colors';
import type { ActivityFilter, DueFilter, StatusFilter } from '@/lib/filter';
import { useUiStore } from '@/store/uiStore';
import styles from './FilterPopover.module.css';

export interface FilterPopoverProps {
  boardId: number;
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/** Section 2.3.3's five "Due date" rows, in order. */
const DUE_ROWS: readonly { value: Exclude<DueFilter, 'any'>; label: string }[] = [
  { value: 'none', label: 'No dates' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'day', label: 'Due in the next day' },
  { value: 'week', label: 'Due in the next week' },
  { value: 'month', label: 'Due in the next month' },
];

/** The two "Card status" rows. */
const STATUS_ROWS: readonly { value: Exclude<StatusFilter, 'any'>; label: string }[] = [
  { value: 'complete', label: 'Marked as complete' },
  { value: 'incomplete', label: 'Not marked as complete' },
];

/** The Activity radio group, driven by `cards.updated_at`. */
const ACTIVITY_ROWS: readonly { value: Exclude<ActivityFilter, 'any'>; label: string }[] = [
  { value: 'week', label: 'Active in the last week' },
  { value: '2weeks', label: 'Active in the last two weeks' },
  { value: '4weeks', label: 'Active in the last four weeks' },
  { value: 'inactive', label: 'Without activity in the last four weeks' },
];

const NO_PALETTE: LabelPalette = {};

/** Adds or removes one id, keeping the order the reader ticked them in. */
function toggleId(ids: readonly Id[], id: Id): Id[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

/**
 * The "Filter" popover of Section 2.3.3: keyword, members, card status, due date, labels,
 * activity recency and the Match select, as 32px rows under 12px section labels.
 *
 * It writes `uiStore.filter` and nothing else. Which cards that hides is decided by
 * `lib/filter.ts` through `hooks/useBoardFilter.ts` (`CardList` sets `display: none` on a tile
 * that does not match, so the drop index stays an index over every active card), the header pill
 * counts the same state with `activeFilterCount`, and `BoardHeader` mirrors it to the URL query —
 * so this file holds no filter rule of its own.
 *
 * Card status, due date and activity are single-valued in the store, so ticking a second row in
 * one of those groups replaces the first and un-ticking the selected row clears the group. The
 * three groups the plan draws as checkbox rows keep checkboxes, and Activity keeps the radios it
 * names, whose selected row clears on a second click (a radio fires no change event then).
 */
export function FilterPopover({ boardId, anchor, onClose }: FilterPopoverProps): ReactElement {
  const filter = useUiStore((state) => state.filter);
  const setFilter = useUiStore((state) => state.setFilter);
  const labels = useLabels(boardId).data ?? [];
  const members = useMembers(boardId).data ?? [];
  const palette: LabelPalette = useMeta().data?.label_colors ?? NO_PALETTE;
  const meId = useMe().data?.id ?? null;
  const activityName = useId();

  return (
    <Popover anchor={anchor} title="Filter" onClose={onClose}>
      <div className={styles.body}>
        <Field label="Keyword" helper="Search cards, members, labels, and more.">
          {(control) => (
            <TextInput
              {...control}
              value={filter.q}
              placeholder="Enter a keyword…"
              onChange={(event) => setFilter({ q: event.target.value })}
            />
          )}
        </Field>

        <section className={styles.group}>
          <h4 className={styles.groupLabel}>Members</h4>
          <Checkbox
            className={styles.row}
            label="No members"
            checked={filter.noMembers}
            onChange={(event) => setFilter({ noMembers: event.target.checked })}
          />
          {meId === null ? null : (
            <Checkbox
              className={styles.row}
              label="Cards assigned to me"
              checked={filter.mine}
              onChange={(event) => setFilter({ mine: event.target.checked })}
            />
          )}
          {members.map((member) => (
            <Checkbox
              key={member.id}
              className={styles.row}
              label={
                <span className={styles.member}>
                  <Avatar name={member.full_name} color={member.avatar_color} />
                  {member.full_name}
                </span>
              }
              checked={filter.memberIds.includes(member.id)}
              onChange={() => setFilter({ memberIds: toggleId(filter.memberIds, member.id) })}
            />
          ))}
        </section>

        <section className={styles.group}>
          <h4 className={styles.groupLabel}>Card status</h4>
          {STATUS_ROWS.map((row) => (
            <Checkbox
              key={row.value}
              className={styles.row}
              label={row.label}
              checked={filter.status === row.value}
              onChange={(event) => setFilter({ status: event.target.checked ? row.value : 'any' })}
            />
          ))}
        </section>

        <section className={styles.group}>
          <h4 className={styles.groupLabel}>Due date</h4>
          {DUE_ROWS.map((row) => (
            <Checkbox
              key={row.value}
              className={styles.row}
              label={row.label}
              checked={filter.due === row.value}
              onChange={(event) => setFilter({ due: event.target.checked ? row.value : 'any' })}
            />
          ))}
        </section>

        <section className={styles.group}>
          <h4 className={styles.groupLabel}>Labels</h4>
          <Checkbox
            className={styles.row}
            label="No labels"
            checked={filter.noLabels}
            onChange={(event) => setFilter({ noLabels: event.target.checked })}
          />
          {labels.map((label) => (
            <Checkbox
              key={label.id}
              className={styles.row}
              label={
                <LabelChip
                  className={styles.chip}
                  size="large"
                  name={label.name}
                  color={label.color}
                  tone={label.tone}
                  palette={palette}
                />
              }
              checked={filter.labelIds.includes(label.id)}
              onChange={() => setFilter({ labelIds: toggleId(filter.labelIds, label.id) })}
            />
          ))}
        </section>

        <section className={styles.group}>
          <h4 className={styles.groupLabel}>Activity</h4>
          {ACTIVITY_ROWS.map((row) => (
            <label key={row.value} className={styles.row}>
              <input
                type="radio"
                className={styles.radio}
                name={activityName}
                checked={filter.activity === row.value}
                onChange={() => setFilter({ activity: row.value })}
                // A radio fires no change event when it is already selected, so the second
                // click that clears the group (Section 2.3.3) is handled here.
                onClick={() => {
                  if (filter.activity === row.value) setFilter({ activity: 'any' });
                }}
              />
              {row.label}
            </label>
          ))}
        </section>

        <Field label="Match">
          {(control) => (
            <Select
              {...control}
              value={filter.match}
              onChange={(event) =>
                setFilter({ match: event.target.value === 'all' ? 'all' : 'any' })
              }
            >
              <option value="any">Any match</option>
              <option value="all">Exact match</option>
            </Select>
          )}
        </Field>
      </div>
    </Popover>
  );
}
