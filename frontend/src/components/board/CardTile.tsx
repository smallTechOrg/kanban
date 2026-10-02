import { memo, useEffect, useRef, type ReactElement } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Pencil, Square, SquareCheckBig } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { IconButton, cx } from '@/components/ui';
import { LabelChip } from '@/components/ui/LabelChip';
import { useCard, useLabels } from '@/hooks/useBoardData';
import { useUpdateCardFields } from '@/hooks/useCardMutations';
import { SHORTCUT_ANCHOR_ATTR, cardAnchorName } from '@/hooks/useKeyboardShortcuts';
import { useMeta } from '@/hooks/useMeta';
import { cardDragId } from '@/lib/boardDnd';
import type { LabelRow } from '@/lib/boardState';
import type { LabelPalette } from '@/lib/colors';
import { useUiStore } from '@/store/uiStore';
import { CardBadges } from './CardBadges';
import { QuickCardEditor } from './QuickCardEditor';
import styles from './CardTile.module.css';

const NO_LABELS: readonly LabelRow[] = [];
const NO_PALETTE: LabelPalette = {};

export interface CardTileProps {
  boardId: number;
  cardId: number;
  /** The card's slot in its list's `cardOrder`, which is the `Draggable` index (Section 5.5). */
  index: number;
  /**
   * The board filter does not match this card (Section 2.3.3). The tile keeps its `Draggable`
   * and only stops painting, so the drop index stays an index over every active card.
   */
  hidden?: boolean;
}

/**
 * One card (Section 2.5): the white tile, its label chips, its title, its badge row and the
 * pencil that opens `QuickCardEditor`. It is the `<Draggable>` of the list's card droppable and
 * an `<a href="/b/:boardId/c/:cardId">`, so a middle click opens the card in a new tab.
 *
 * The tile subscribes to its own card through `useCard`, so a change to one card re-renders one
 * tile: the selector returns the same row object for every other card, and `React.memo` stops a
 * parent re-render (a sibling being added, the list's order changing elsewhere) from reaching
 * the ones whose props did not change (Section 5.11).
 *
 * Section 2.5.1 says "the tile is an `<a>`", but three things inside it are controls of their
 * own — a label chip toggles the global label-text mode, the due badge toggles `due_complete`
 * and the pencil opens the quick editor — and a button inside a link is invalid HTML and
 * unreachable by keyboard. The anchor therefore holds the title and stretches over the whole
 * tile through its `::after`, with those three painted above it: one tab stop per card, the
 * click target of the documented `<a>`, and Section 2.7's keyboard contract intact (Tab
 * focuses, Space lifts, Enter is the native link activation).
 *
 * The item list under the title is deliberately *not* a fourth control. Its ticks say what is
 * done and ticking happens in the card modal, so the rows sit under the anchor's stretched
 * layer: the card stays one tab stop and one drag handle, and a click on an item opens the card
 * exactly as a click anywhere else on the tile does.
 */
function CardTileView({
  boardId,
  cardId,
  index,
  hidden = false,
}: CardTileProps): ReactElement | null {
  const card = useCard(boardId, cardId).data;
  const labels = useLabels(boardId).data ?? NO_LABELS;
  const meta = useMeta().data;
  const palette: LabelPalette = meta?.label_colors ?? NO_PALETTE;
  const labelTextMode = useUiStore((state) => state.labelTextMode);
  const setLabelTextMode = useUiStore((state) => state.setLabelTextMode);
  const patterned = useUiStore((state) => state.colorBlindLabels);
  const isQuickEditing = useUiStore((state) => state.quickEditCardId === cardId);
  const setQuickEditCardId = useUiStore((state) => state.setQuickEditCardId);
  const isCurrent = useUiStore((state) => state.focusedCardId === cardId);
  const tileRef = useRef<HTMLDivElement | null>(null);
  const updateCard = useUpdateCardFields(boardId, cardId);

  // Section 5.9: a tile selected with J/K or the arrows is scrolled into view.
  useEffect(() => {
    if (!isCurrent) return;
    tileRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isCurrent]);

  /**
   * Section 2.8 resolves the current card as `openCardId ?? focusedCardId ?? hoveredCardId`, and
   * the ring has to equal that target, so pointing at another tile also drops the selection. Both
   * fields are written through `getState()`: a memoised tile must not subscribe to a value that
   * changes on every mouse move.
   */
  function onEnter(): void {
    const ui = useUiStore.getState();
    ui.setHoveredCardId(cardId);
    if (ui.focusedCardId !== null && ui.focusedCardId !== cardId) ui.setFocusedCardId(null);
  }

  function onLeave(): void {
    const ui = useUiStore.getState();
    if (ui.hoveredCardId === cardId) ui.setHoveredCardId(null);
  }

  if (card === undefined) return null;

  const chips = card.label_ids
    .map((labelId) => labels.find((label) => label.id === labelId))
    .filter((label): label is LabelRow => label !== undefined);

  return (
    <Draggable draggableId={cardDragId(card.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={(node) => {
            provided.innerRef(node);
            tileRef.current = node;
          }}
          className={cx(styles.tile, isCurrent && styles.current, hidden && styles.hidden)}
          data-is-dragging={snapshot.isDragging ? 'true' : undefined}
          // The anchor the `L` and `D` keys hang their panel off (Section 5.9).
          {...{ [SHORTCUT_ANCHOR_ATTR]: cardAnchorName(card.id) }}
          {...provided.draggableProps}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        >
          {chips.length === 0 ? null : (
            <div className={styles.labels}>
              {chips.map((label) => (
                <LabelChip
                  key={label.id}
                  className={styles.chip}
                  name={label.name}
                  color={label.color}
                  tone={label.tone}
                  palette={palette}
                  showText={labelTextMode}
                  patterned={patterned}
                  onClick={() => setLabelTextMode(!labelTextMode)}
                />
              ))}
            </div>
          )}

          <Link
            to={`/b/${boardId}/c/${card.id}`}
            className={styles.link}
            {...provided.dragHandleProps}
            // The library's handle props declare `role="button"`, which would hide the link
            // from assistive tech; the tile is a link and Enter must activate it (Section 2.7).
            // The keyboard sensor finds the handle by its data attribute, not by the role.
            role={undefined}
          >
            <span className={styles.title}>{card.title}</span>
          </Link>

          {card.items.length === 0 ? null : (
            <ul className={styles.items}>
              {card.items.map((item) => (
                <li
                  key={item.id}
                  className={cx(styles.item, item.is_checked && styles.checked)}
                  // The tick is painted, not announced, and a line through the name is not
                  // either, so the state is said in the row's own accessible name.
                  aria-label={item.is_checked ? `${item.name} (done)` : item.name}
                >
                  {item.is_checked ? (
                    <SquareCheckBig aria-hidden="true" />
                  ) : (
                    <Square aria-hidden="true" />
                  )}
                  <span>{item.name}</span>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.badges}>
            <CardBadges
              card={card}
              onToggleDueComplete={(due_complete) => updateCard.mutate({ due_complete })}
            />
          </div>

          <div className={styles.pencil}>
            <IconButton
              size="sm"
              label="Edit card"
              onClick={() => setQuickEditCardId(card.id)}
              className={styles.pencilButton}
            >
              <Pencil aria-hidden="true" />
            </IconButton>
          </div>

          {isQuickEditing && tileRef.current !== null
            ? createPortal(
                <QuickCardEditor
                  boardId={boardId}
                  card={card}
                  anchor={tileRef.current}
                  onClose={() => setQuickEditCardId(null)}
                />,
                document.body,
              )
            : null}
        </div>
      )}
    </Draggable>
  );
}

/** Section 5.11: `CardTile` is memoised so one card changing re-renders one tile. */
export const CardTile = memo(CardTileView);
