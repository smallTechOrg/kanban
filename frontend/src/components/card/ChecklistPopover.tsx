import { useState, type ReactElement } from 'react';
import { Button, Field, Popover, Select, TextInput } from '@/components/ui';
import { useBoardChecklists } from '@/hooks/useCard';
import { useCreateChecklist } from '@/hooks/useCardMutations';
import styles from './ChecklistPopover.module.css';

/** The name the server also defaults to when the field is left empty (Section 4.6). */
const DEFAULT_NAME = 'Checklist';

/** The "Copy items from…" value that copies nothing. */
const NONE = '';

export interface ChecklistPopoverProps {
  boardId: number;
  cardId: number;
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Add checklist" (Section 2.6.5): the title, defaulting to "Checklist" with its text selected,
 * and the "Copy items from…" select listing every checklist on the board as
 * "Card title / Checklist name".
 *
 * The rows come from `['checklists', boardId]`, which is fetched when this popover mounts and
 * refetched by every checklist write (Section 4.6); the copied items always arrive unchecked, so
 * nothing is derived from them here.
 */
export function ChecklistPopover({
  boardId,
  cardId,
  anchor,
  onClose,
}: ChecklistPopoverProps): ReactElement {
  const [name, setName] = useState(DEFAULT_NAME);
  const [source, setSource] = useState(NONE);
  const { data: sources } = useBoardChecklists(boardId);
  const createChecklist = useCreateChecklist(boardId, cardId);

  function add(): void {
    const title = name.trim();
    if (title === '') return;
    createChecklist.mutate({
      name: title,
      ...(source === NONE ? {} : { copy_from_checklist_id: Number(source) }),
    });
    onClose();
  }

  return (
    <Popover anchor={anchor} title="Add checklist" onClose={onClose}>
      <div className={styles.form}>
        <Field label="Title">
          {(control) => (
            <TextInput
              {...control}
              value={name}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') add();
              }}
            />
          )}
        </Field>

        <Field label="Copy items from…">
          {(control) => (
            <Select {...control} value={source} onChange={(event) => setSource(event.target.value)}>
              {/* The rows arrive a moment after the panel opens; until then "(none)" is the
                  only choice, which is also the answer for a board with no checklist yet. */}
              <option value={NONE}>(none)</option>
              {(sources ?? []).map((checklist) => (
                <option key={checklist.id} value={checklist.id}>
                  {`${checklist.card_title} / ${checklist.name}`}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Button variant="primary" onClick={add}>
          Add
        </Button>
      </div>
    </Popover>
  );
}
