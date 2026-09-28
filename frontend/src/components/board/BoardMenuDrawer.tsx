import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Activity as ActivityIcon,
  Archive,
  ChevronLeft,
  Image,
  Info,
  Search,
  Settings,
  Tag,
  X,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  ConfirmPopover,
  IconButton,
  MarkdownEditor,
  MarkdownView,
  MenuRow,
  cx,
} from '@/components/ui';
import { useBoardMeta, useMembers } from '@/hooks/useBoardData';
import { useCloseBoard, useUpdateBoard } from '@/hooks/useBoards';
import { ArchivedItemsPanel } from './ArchivedItemsPanel';
import { BoardActivityFeed } from './BoardActivityFeed';
import { BoardBackgroundPicker } from './BoardBackgroundPicker';
import { BoardLabelsPanel } from './BoardLabelsPanel';
import { BoardSettingsPanel } from './BoardSettingsPanel';
import styles from './BoardMenuDrawer.module.css';

/** Section 2.3.4's confirm copy for "Close board…". */
const CLOSE_BODY = 'You can find and reopen closed boards at the bottom of your boards page.';

/** Section 2.6.3's prompt, reused for the board's own description (Section 2.3.4). */
const EMPTY_DESCRIPTION = 'Add a more detailed description…';

/** The drawer's view stack: the root menu and the six panels it pushes. */
type DrawerView = 'menu' | 'about' | 'background' | 'labels' | 'archived' | 'settings' | 'activity';

const VIEW_TITLE: Record<DrawerView, string> = {
  menu: 'Menu',
  about: 'About this board',
  background: 'Change background',
  labels: 'Labels',
  archived: 'Archived items',
  settings: 'Settings',
  activity: 'Activity',
};

export interface BoardMenuDrawerProps {
  boardId: number;
  onClose: () => void;
  /** "Search cards" opens `FilterPopover` on its keyword field, which `BoardHeader` anchors. */
  onSearchCards: () => void;
}

interface AboutPanelProps {
  boardId: number;
}

/**
 * "About this board": the owner's avatar under "Made by", and the board description in the same
 * Markdown editor the card description uses, saved with `PATCH /api/boards/{board_id}`.
 *
 * The owner is read from the board's own member list (Section 5.4.2); an owner who has left the
 * board leaves the documented "?" initials behind rather than an empty row.
 */
function AboutPanel({ boardId }: AboutPanelProps): ReactElement | null {
  const board = useBoardMeta(boardId).data;
  const members = useMembers(boardId).data ?? [];
  const update = useUpdateBoard(boardId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (board === undefined) return null;

  const owner = members.find((member) => member.id === board.owner_id);
  const canEdit = board.my_role !== 'observer';
  const hasText = board.description !== '';

  function startEditing(): void {
    setDraft(board?.description ?? '');
    setEditing(true);
  }

  function save(): void {
    setEditing(false);
    if (board === undefined || draft === board.description) return;
    update.mutate({ description: draft });
  }

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Made by</h3>
        <div className={styles.madeBy}>
          <Avatar
            name={owner?.full_name ?? '?'}
            color={owner?.avatar_color ?? 'var(--hover)'}
            size={40}
          />
          <span className={styles.ownerName}>{owner?.full_name ?? 'Unknown member'}</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Description</h3>
          {hasText && !editing && canEdit ? <Button onClick={startEditing}>Edit</Button> : null}
        </div>
        {editing ? (
          <MarkdownEditor
            value={draft}
            label="Board description"
            placeholder={EMPTY_DESCRIPTION}
            onChange={setDraft}
            onSave={save}
            onCancel={() => setEditing(false)}
          />
        ) : hasText ? (
          <MarkdownView>{board.description}</MarkdownView>
        ) : canEdit ? (
          <button type="button" className={styles.emptyBox} onClick={startEditing}>
            {EMPTY_DESCRIPTION}
          </button>
        ) : (
          <p className={styles.none}>No description</p>
        )}
      </section>
    </div>
  );
}

/**
 * The 339px right-hand drawer of Section 2.3.4: a 40px header with a back chevron and a close X
 * over a scrolling body, holding the root menu and the About, Change background, Labels,
 * Archived items, Settings and Activity panels.
 *
 * It is a `position: fixed` panel rather than the `position: absolute` one the plan draws: the
 * board page is not a positioned ancestor, and the drawer has to sit under the 44px nav and over
 * the canvas whatever the canvas has scrolled to. `BoardCanvas` pads itself by `--drawer-w` while
 * the drawer is open above 1024px, which is the rule the plan states.
 *
 * Escape is not handled here: `uiStore.boardMenuOpen` is one of the things the `Esc` shortcut of
 * Section 2.8 closes, and that order ("the topmost popover, editor, quick edit, modal or drawer")
 * is decided in one place, `hooks/useKeyboardShortcuts.ts`, rather than by each layer.
 *
 * Every row now opens a panel: "Change background" was the last scope guard, and M5's
 * `BoardBackgroundPicker` replaced its "Coming later" tooltip. Whether the reader may close the
 * board is decided by the endpoint's own rule (admin only, Section 4.3), so that row — and only
 * that row — is absent otherwise.
 */
export function BoardMenuDrawer({
  boardId,
  onClose,
  onSearchCards,
}: BoardMenuDrawerProps): ReactElement | null {
  const board = useBoardMeta(boardId).data;
  const closeBoard = useCloseBoard(boardId);
  const navigate = useNavigate();
  const [view, setView] = useState<DrawerView>('menu');
  const [confirmAnchor, setConfirmAnchor] = useState<HTMLElement | null>(null);
  const closeRow = useRef<HTMLDivElement | null>(null);
  const [entered, setEntered] = useState(false);

  // The 0.2s slide of Section 2.3.4 only runs if the panel is painted off-screen once first.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (board === undefined) return null;

  const isAdmin = board.my_role === 'admin';

  return (
    <aside className={cx(styles.drawer, entered && styles.open)} aria-label="Menu">
      <div className={styles.header}>
        <div className={styles.headerSide}>
          {view === 'menu' ? null : (
            <IconButton label="Back" size="sm" onClick={() => setView('menu')}>
              <ChevronLeft aria-hidden="true" />
            </IconButton>
          )}
        </div>
        <h2 className={styles.title}>{VIEW_TITLE[view]}</h2>
        <div className={styles.headerSide}>
          <IconButton label="Close menu" size="sm" onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div className={styles.body}>
        {view === 'about' ? <AboutPanel boardId={boardId} /> : null}
        {view === 'background' ? <BoardBackgroundPicker boardId={boardId} /> : null}
        {view === 'labels' ? <BoardLabelsPanel boardId={boardId} /> : null}
        {view === 'archived' ? <ArchivedItemsPanel boardId={boardId} /> : null}
        {view === 'settings' ? <BoardSettingsPanel boardId={boardId} /> : null}
        {view === 'activity' ? <BoardActivityFeed boardId={boardId} /> : null}

        {view !== 'menu' ? null : (
          <>
            <MenuRow icon={<Info aria-hidden="true" />} onClick={() => setView('about')}>
              About this board
            </MenuRow>
            <MenuRow icon={<Image aria-hidden="true" />} onClick={() => setView('background')}>
              Change background
            </MenuRow>
            <MenuRow icon={<Search aria-hidden="true" />} onClick={onSearchCards}>
              Search cards
            </MenuRow>
            <MenuRow icon={<Tag aria-hidden="true" />} onClick={() => setView('labels')}>
              Labels
            </MenuRow>
            <MenuRow icon={<Archive aria-hidden="true" />} onClick={() => setView('archived')}>
              Archived items
            </MenuRow>
            <MenuRow icon={<Settings aria-hidden="true" />} onClick={() => setView('settings')}>
              Settings
            </MenuRow>
            {isAdmin ? (
              <div ref={closeRow}>
                <MenuRow
                  icon={<XCircle aria-hidden="true" />}
                  onClick={() => setConfirmAnchor(closeRow.current)}
                >
                  Close board…
                </MenuRow>
              </div>
            ) : null}

            <hr className={styles.divider} />

            <MenuRow icon={<ActivityIcon aria-hidden="true" />} onClick={() => setView('activity')}>
              Activity
            </MenuRow>
          </>
        )}
      </div>

      {confirmAnchor === null ? null : (
        <ConfirmPopover
          anchor={confirmAnchor}
          title="Close board?"
          body={CLOSE_BODY}
          confirmLabel="Close"
          loading={closeBoard.isPending}
          onClose={() => setConfirmAnchor(null)}
          onConfirm={() =>
            closeBoard.mutate(undefined, {
              onSuccess: () => {
                setConfirmAnchor(null);
                onClose();
                navigate('/');
              },
            })
          }
        />
      )}
    </aside>
  );
}
