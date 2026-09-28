import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CreateBoardInput } from '@/api/boards';
import type { Visibility } from '@/api/types';
import { Button, Checkbox, Field, Popover, Select, TextInput } from '@/components/ui';
import { useCreateBoard } from '@/hooks/useBoards';
import { useMeta } from '@/hooks/useMeta';
import { boardBackgroundStyle, type BackgroundStyle } from '@/lib/boardGroups';
import { BackgroundPicker, type BackgroundChoice } from './BackgroundPicker';
import styles from './CreateBoardPopover.module.css';

/** Section 2.2.1 item 3, shown under the input once it has been left empty. */
const TITLE_HINT = '\u{1F44B} Board title is required';

const VISIBILITIES: readonly Visibility[] = ['private', 'workspace', 'public'];

export interface CreateBoardPopoverProps {
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/** The server's own default background is the first colour `GET /api/meta` lists (2.9.3). */
function firstColor(colors: Readonly<Record<string, string>>): BackgroundChoice | null {
  const first = Object.entries(colors)[0];
  return first === undefined ? null : { type: 'color', value: first[1] };
}

function previewStyle(
  choice: BackgroundChoice | null,
  gradients: Readonly<Record<string, string>>,
): BackgroundStyle {
  if (choice === null) return {};
  return boardBackgroundStyle(
    { background_type: choice.type, background_value: choice.value, background_thumb_url: null },
    gradients,
  );
}

/** A `<select>` hands back a string; this keeps the state honest without a cast. */
function toVisibility(value: string): Visibility {
  return VISIBILITIES.find((option) => option === value) ?? 'private';
}

/**
 * "Create board" (Section 2.2.1): a live 200x120 preview, the preset background picker, the
 * required title, visibility, the default-lists checkbox, and a Create button that stays
 * disabled until the title holds a non-space character. On success it navigates to the board.
 */
export function CreateBoardPopover({ anchor, onClose }: CreateBoardPopoverProps): ReactElement {
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const { mutate, isPending } = useCreateBoard();
  const [chosen, setChosen] = useState<BackgroundChoice | null>(null);
  const [hovered, setHovered] = useState<BackgroundChoice | null>(null);
  const [name, setName] = useState('');
  const [blurred, setBlurred] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [defaultLists, setDefaultLists] = useState(true);

  const colors = meta?.board_colors ?? {};
  const gradients = meta?.board_gradients ?? {};
  const selected = chosen ?? firstColor(colors);
  const title = name.trim();
  const error = blurred && title === '' ? TITLE_HINT : undefined;

  function submit(): void {
    const input: CreateBoardInput = { name: title, visibility, default_lists: defaultLists };
    if (selected !== null) {
      input.background_type = selected.type;
      input.background_value = selected.value;
    }
    mutate(input, {
      onSuccess: (board) => {
        onClose();
        navigate(`/b/${board.id}`);
      },
    });
  }

  return (
    <Popover anchor={anchor} title="Create board" onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (title !== '') submit();
        }}
      >
        <div
          className={styles.preview}
          style={previewStyle(hovered ?? selected, gradients)}
          role="img"
          aria-label="Board preview"
        >
          <span className={styles.barShort} />
          <span className={styles.barMedium} />
          <span className={styles.barTall} />
        </div>

        <BackgroundPicker
          colors={colors}
          gradients={gradients}
          value={selected}
          onChange={setChosen}
          onPreview={setHovered}
        />

        <Field label="Board title *" error={error}>
          {(control) => (
            <TextInput
              {...control}
              value={name}
              invalid={error !== undefined}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setBlurred(true)}
            />
          )}
        </Field>

        <Field label="Visibility">
          {(control) => (
            <Select
              {...control}
              value={visibility}
              onChange={(event) => setVisibility(toVisibility(event.target.value))}
            >
              <option value="private">Private</option>
              <option value="workspace">Workspace</option>
              <option value="public">Public</option>
            </Select>
          )}
        </Field>

        <Checkbox
          label="Start with default lists"
          checked={defaultLists}
          onChange={(event) => setDefaultLists(event.target.checked)}
        />

        <Button
          type="submit"
          variant="primary"
          fullWidth
          disabled={title === ''}
          loading={isPending}
        >
          Create
        </Button>
      </form>
    </Popover>
  );
}
