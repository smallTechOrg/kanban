import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, SquareKanban } from 'lucide-react';
import { Button, Field, MenuRow, Popover, Select, Textarea } from '@/components/ui';
import { useCreateCards } from '@/hooks/useBoardMutations';
import { useBoards } from '@/hooks/useBoards';
import { useBoardLists } from '@/hooks/useMoveTargets';
import type { Id } from '@/lib/boardState';
import { useUiStore } from '@/store/uiStore';
import styles from './CreateMenuPopover.module.css';

export interface CreateMenuPopoverProps {
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * The Create menu of Section 2.1.1: "Create space", which swaps `uiStore.openPopover` to
 * `createBoard` on the same anchor (`CreateBoardPopover` renders that kind, and the nav only
 * records which popover is open, which is what keeps exactly one of them open), and
 * "Create card", which pushes the mini form below onto this popover's own view stack.
 */
export function CreateMenuPopover({ anchor, onClose }: CreateMenuPopoverProps): ReactElement {
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);

  return (
    <Popover anchor={anchor} title="Create" onClose={onClose}>
      {(nav) => (
        <div className={styles.menu}>
          <MenuRow
            icon={<SquareKanban aria-hidden="true" />}
            helper="A space holds lists of cards."
            onClick={() => setOpenPopover({ kind: 'createBoard', anchor })}
          >
            Create space
          </MenuRow>
          <MenuRow
            icon={<CreditCard aria-hidden="true" />}
            helper="A card holds a task, wherever it belongs."
            onClick={() =>
              nav.push({ title: 'Create card', content: <CreateCardForm onClose={nav.close} /> })
            }
          >
            Create card
          </MenuRow>
        </div>
      )}
    </Popover>
  );
}

/**
 * The pushed "Create card" view: a title textarea, the Board select fed by `['boards']` `all[]`,
 * the List select fed by `['lists', boardId]` and one "Add card" button
 * (`POST /api/lists/{list_id}/cards`), after which the reader lands on the new card.
 *
 * It is a component rather than an element built from the menu's own state for the reason
 * `LabelForm` is one (CLAUDE.md section 8): `Popover` captures a view's content when `nav.push`
 * runs, so a form's draft has to live inside the pushed component to stay live. Both selects
 * derive their own defaults, so it takes nothing but the menu's `close`.
 *
 * The request is the composer's own multi-line create (`split_lines`, Section 4.4), so a pasted
 * block becomes one card per non-empty line exactly as it does in a list, and the reader lands on
 * the first of them.
 */
function CreateCardForm({ onClose }: { onClose: () => void }): ReactElement {
  const navigate = useNavigate();
  const { data: groups } = useBoards();
  const [title, setTitle] = useState('');
  const [boardChoice, setBoardChoice] = useState<Id | null>(null);
  const [listChoice, setListChoice] = useState<Id | null>(null);

  const boards = groups?.all ?? [];
  const boardId = boardChoice ?? boards[0]?.id ?? null;
  const { data: lists } = useBoardLists(boardId ?? 0, boardId !== null);
  const rows = lists ?? [];
  // A board switched to while its lists are on their way falls back to the first that arrives,
  // the same resolution `DestinationSelects` makes for the Move and Copy popovers.
  const list = rows.find((row) => row.id === listChoice) ?? rows[0];
  const { mutate, isPending } = useCreateCards(boardId ?? 0);

  const text = title.trim();
  const canSubmit = text !== '' && boardId !== null && list !== undefined;

  function submit(): void {
    if (!canSubmit || list === undefined || boardId === null) return;
    mutate(
      { listId: list.id, title: text },
      {
        onSuccess: ({ items }) => {
          const card = items[0];
          onClose();
          if (card !== undefined) navigate(`/b/${String(boardId)}/c/${String(card.id)}`);
        },
      },
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label="Title">
        {(control) => (
          <Textarea
            {...control}
            value={title}
            minRows={2}
            placeholder="Enter a title for this card…"
            onChange={(event) => setTitle(event.target.value)}
            onSubmit={submit}
          />
        )}
      </Field>

      {boards.length === 0 ? (
        <p className={styles.empty}>Create a space before you add a card.</p>
      ) : (
        <>
          <Field label="Space">
            {(control) => (
              <Select
                {...control}
                value={boardId === null ? '' : String(boardId)}
                onChange={(event) => {
                  setBoardChoice(Number(event.target.value));
                  setListChoice(null);
                }}
              >
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="List"
            helper={rows.length === 0 ? 'That space has no lists yet.' : undefined}
          >
            {(control) => (
              <Select
                {...control}
                value={list === undefined ? '' : String(list.id)}
                disabled={rows.length === 0}
                onChange={(event) => setListChoice(Number(event.target.value))}
              >
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      )}

      <Button type="submit" variant="primary" fullWidth disabled={!canSubmit} loading={isPending}>
        Add card
      </Button>
    </form>
  );
}
