import { useEffect, useRef, useState, type ReactElement } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { IconButton, Modal } from '@/components/ui';
import { useCard } from '@/hooks/useBoardData';
import { useCardDetail } from '@/hooks/useCard';
import { useMoveChecklist, useMoveChecklistItem } from '@/hooks/useCardMutations';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { isId } from '@/lib/boardState';
import { cardMoveFromDrop, itemOrder, type ItemOrder } from '@/lib/cardDnd';
import { useUiStore } from '@/store/uiStore';
import { ArchivedBanner } from './ArchivedBanner';
import { CardCoverStrip } from './CardCoverStrip';
import { CardModalHeader } from './CardModalHeader';
import { CardModalMain } from './CardModalMain';
import { CardModalSidebar } from './CardModalSidebar';
import styles from './CardDetailModal.module.css';

const NO_ORDER: ItemOrder = {};

/** Section 2.7, the keyboard instructions the library reads out when a handle takes focus. */
const DRAG_INSTRUCTIONS =
  'Press space bar to lift. Use the arrow keys to move, space bar to drop and escape to cancel.';

/**
 * Whether a layer sits above this dialog — a popover, a confirm popover, an anchored menu.
 *
 * Every one of them is a `[role="dialog"]` portalled to `document.body` after the modal's own
 * portal, so counting them is enough and no component has to tell any other that it is open.
 * That is what makes Section 2.6.1's "Esc closes the topmost popover or editor first, then the
 * modal" true: Floating UI dispatches the Escape to the modal's dismiss hook first (its listener
 * was registered first), this returns and the popover then closes itself. An open *editor* never
 * gets this far — `Textarea` stops the Escape it consumes, so the event never reaches the
 * document at all.
 */
function hasLayerAbove(): boolean {
  return document.querySelectorAll('[role="dialog"]').length > 1;
}

/**
 * The card detail modal (Section 2.6), rendered by the nested route `/b/:boardId/c/:cardId` as
 * an `<Outlet>` over `BoardPage`, so a direct load paints the board underneath and the browser
 * Back button closes it.
 *
 * It opens on the board cache — the title is on screen before `GET /api/cards/{card_id}`
 * answers, with the 2px indeterminate bar of Section 2.10 at the dialog top — and its own
 * `DragDropContext` holds the two nested droppables of the checklists (`lib/cardDnd.ts`), quite
 * separate from the board's.
 *
 * The two bands above the header are conditional: `ArchivedBanner` while the card is archived
 * (Section 2.6.1) and `CardCoverStrip` whenever a cover is set — which that component decides
 * itself from `card.cover`, so the modal does not decide it twice.
 *
 * A card that has been moved to another board answers with a different `board_id`, and the URL
 * replaces itself with the card's real board rather than rendering a card that is not on the
 * board behind it (Section 2.6.1). A card that does not exist, or one whose board the caller
 * cannot see, is the 404 page of Section 2.10 — the two are indistinguishable by design.
 */
export function CardDetailModal(): ReactElement | null {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const boardId = Number(params['boardId']);
  const cardId = Number(params['cardId']);

  const { data: card, isPending, isError } = useCardDetail(cardId);
  const cachedRow = useCard(boardId, cardId).data;

  const setOpenCardId = useUiStore((state) => state.setOpenCardId);
  const setDragging = useUiStore((state) => state.setDragging);
  const moveChecklist = useMoveChecklist(boardId, cardId);
  const moveItem = useMoveChecklistItem(boardId, cardId);

  const [hiddenChecklistIds, setHiddenChecklistIds] = useState<readonly number[]>([]);

  /**
   * Section 2.6.1: focus goes back to the tile the card was opened from. The dialog unmounts with
   * the route instead of being toggled shut, and Floating UI only returns focus on an
   * open -> closed transition, so the element that had it is captured in the first render — before
   * the focus trap moves it — and focused again on the way out. A deep link has no opener.
   */
  const [opener] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  );
  useEffect(
    () => () => {
      if (opener !== null && opener.isConnected) opener.focus();
    },
    [opener],
  );

  // The drop is handled after a commit and the card can re-render between the lift and the
  // drop, so the two orders are read through a ref rather than a stale closure (`BoardDndContext`).
  const renderedRef = useRef<ItemOrder>(NO_ORDER);
  const fullRef = useRef<ItemOrder>(NO_ORDER);
  renderedRef.current =
    card === undefined ? NO_ORDER : itemOrder(card.checklists, hiddenChecklistIds);
  fullRef.current = card === undefined ? NO_ORDER : itemOrder(card.checklists);

  // Section 5.13: the store mirrors the route param so M4b's shortcuts know which card is open.
  useEffect(() => {
    setOpenCardId(cardId);
    return () => setOpenCardId(null);
  }, [cardId, setOpenCardId]);

  const movedTo = card !== undefined && card.board_id !== boardId ? card.board_id : null;
  useEffect(() => {
    if (movedTo === null) return;
    navigate(`/b/${String(movedTo)}/c/${String(cardId)}`, { replace: true });
  }, [movedTo, cardId, navigate]);

  if (!isId(cardId) || isError) {
    return (
      <NotFoundPage title="Card not found" body="This card may be private or may not exist." />
    );
  }

  function close(): void {
    if (hasLayerAbove()) return;
    // A deep link has no board entry behind it, so closing replaces the card URL rather than
    // leaving one the Back button would return to (Section 5.2). Every other open was a push
    // from the board, and closing undoes that push: pushing the board URL on top instead would
    // leave the card as the entry Back returns to, so Back would reopen the modal the Escape
    // just dismissed — Section 7.2's demo script ends "browser back reopens nothing".
    if (location.key === 'default') navigate(`/b/${String(boardId)}`, { replace: true });
    else navigate(-1);
  }

  function onDragEnd(result: DropResult): void {
    setDragging(false);
    const outcome = cardMoveFromDrop(result, renderedRef.current, fullRef.current);
    if (outcome.kind === 'item') moveItem.mutate(outcome.item);
    else if (outcome.kind === 'checklist') moveChecklist.mutate(outcome.checklist);
  }

  function toggleHideChecked(checklistId: number): void {
    setHiddenChecklistIds((current) =>
      current.includes(checklistId)
        ? current.filter((id) => id !== checklistId)
        : [...current, checklistId],
    );
  }

  const title = card?.title ?? cachedRow?.title ?? '';

  return (
    <Modal title={title === '' ? 'Card' : title} onClose={close} chrome={false} flush>
      {isPending ? (
        <div className={styles.loading} role="progressbar" aria-label="Loading card" />
      ) : null}

      <div className={styles.close}>
        <IconButton label="Close card" onClick={close}>
          <X aria-hidden="true" />
        </IconButton>
      </div>

      {card?.is_archived === true ? <ArchivedBanner /> : null}

      {card === undefined ? null : <CardCoverStrip boardId={boardId} card={card} />}

      <CardModalHeader
        boardId={boardId}
        cardId={cardId}
        title={title}
        listName={card?.list_name ?? ''}
      />

      <div className={styles.columns}>
        {card === undefined ? (
          <div className={styles.mainPlaceholder} />
        ) : (
          <>
            <DragDropContext
              onDragStart={() => setDragging(true)}
              onDragEnd={onDragEnd}
              dragHandleUsageInstructions={DRAG_INSTRUCTIONS}
            >
              <CardModalMain
                boardId={boardId}
                card={card}
                hiddenChecklistIds={hiddenChecklistIds}
                onToggleHideChecked={toggleHideChecked}
              />
            </DragDropContext>
            <CardModalSidebar card={card} />
          </>
        )}
      </div>
    </Modal>
  );
}
