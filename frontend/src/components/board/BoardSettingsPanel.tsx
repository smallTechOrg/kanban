import type { ReactElement } from 'react';
import type { Visibility } from '@/api/types';
import { Checkbox, Field, Select } from '@/components/ui';
import { useBoardMeta } from '@/hooks/useBoardData';
import { useUpdateBoard } from '@/hooks/useBoards';
import { useUiStore } from '@/store/uiStore';
import styles from './BoardSettingsPanel.module.css';

/** The three values of `boards.visibility`, in the order Section 2.3.1 lists them. */
const VISIBILITIES: Record<Visibility, string> = {
  private: 'Private',
  workspace: 'Workspace',
  public: 'Public',
};

const VISIBILITY_ORDER: readonly Visibility[] = ['private', 'workspace', 'public'];

/**
 * Section 2.3.4's "Allow comments from": one fixed value, disabled in v1. The API lets observers
 * comment (Section 4.6) and there is no setting behind it to change.
 */
const COMMENTS_FROM = 'Members and observers';

export interface BoardSettingsPanelProps {
  boardId: number;
}

/**
 * The board menu's "Settings" sub-panel (Section 2.3.4): the visibility select, the fixed
 * "Allow comments from" select and the "Card covers enabled" toggle.
 *
 * Visibility is the same `PATCH /api/boards/{board_id}` the header's popover sends, through the
 * same hook; the covers toggle is `uiStore.cardCoversEnabled`, which `CardTile` already reads and
 * which persists as `localStorage.kb_cardCovers` (Section 5.13). Observers cannot write to a
 * board, so the select is inert for them rather than failing after the change.
 */
export function BoardSettingsPanel({ boardId }: BoardSettingsPanelProps): ReactElement | null {
  const board = useBoardMeta(boardId).data;
  const updateBoard = useUpdateBoard(boardId);
  const coversEnabled = useUiStore((state) => state.cardCoversEnabled);
  const setCardCoversEnabled = useUiStore((state) => state.setCardCoversEnabled);

  if (board === undefined) return null;

  return (
    <div className={styles.panel}>
      <Field label="Visibility">
        {(control) => (
          <Select
            {...control}
            value={board.visibility}
            disabled={board.my_role === 'observer'}
            onChange={(event) =>
              updateBoard.mutate({ visibility: event.target.value as Visibility })
            }
          >
            {VISIBILITY_ORDER.map((value) => (
              <option key={value} value={value}>
                {VISIBILITIES[value]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Allow comments from">
        {(control) => (
          <Select {...control} value={COMMENTS_FROM} disabled>
            <option value={COMMENTS_FROM}>{COMMENTS_FROM}</option>
          </Select>
        )}
      </Field>

      <Checkbox
        label="Card covers enabled"
        checked={coversEnabled}
        onChange={(event) => setCardCoversEnabled(event.target.checked)}
      />
    </div>
  );
}
