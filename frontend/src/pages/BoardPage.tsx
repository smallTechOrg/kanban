import { useEffect, type ReactElement } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { BoardCanvas } from '@/components/board/BoardCanvas';
import { BoardHeader } from '@/components/board/BoardHeader';
import { CardShortcutPopovers } from '@/components/board/CardShortcutPopovers';
import { ClosedBoardPage } from '@/components/board/ClosedBoardPage';
import { ReconnectingBanner } from '@/components/board/ReconnectingBanner';
import { useBoardMeta } from '@/hooks/useBoardData';
import { useBoardEvents } from '@/hooks/useBoardEvents';
import { useBoards } from '@/hooks/useBoards';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMeta } from '@/hooks/useMeta';
import { isId } from '@/lib/boardState';
import { boardBackgroundStyle, boardNameFromGroups } from '@/lib/boardGroups';
import { NotFoundPage } from './NotFoundPage';
import styles from './BoardPage.module.css';

/** Section 2.10: three skeleton columns of three cards while the payload is in flight. */
const SKELETON_LISTS = 3;
const SKELETON_CARDS = 3;

/** The document title outside a board, as index.html ships it. */
const APP_TITLE = 'My Day';

/**
 * `/b/:boardId` (Section 5.2). It reads the normalised board document through
 * `useBoardData`, paints the board background, keeps the document title in step and chooses
 * the screen: `ClosedBoardPage` while `board.is_closed` (Section 2.3.5), otherwise the header
 * over the canvas.
 *
 * While the payload loads, the header band shows the name from the `['boards']` cache when the
 * user arrived from the home page and the canvas shows skeleton columns (Section 2.10). Any
 * failure lands on the 404 copy that section prescribes: a board the caller cannot see is
 * indistinguishable from one that does not exist (403 and 404, Section 4.3), and a transient
 * failure has already raised the client's global error toast.
 *
 * The `<Outlet>` at the end is where `/b/:boardId/c/:cardId` renders `CardDetailModal` over the
 * board (Section 5.2); it is outside the closed-board branch because a closed board has no cards
 * to open.
 *
 * Two things are mounted here for as long as a board is open: `useBoardEvents`, the realtime
 * subscription of Section 4.8 — kept outside the closed branch, because a `board.reopened` event
 * is what swaps the board back in (Section 2.3.5) — and the `'board'` keyboard scope of
 * Section 2.8, which a closed board does not get, since every key it holds writes to the board.
 */
export function BoardPage(): ReactElement {
  const params = useParams();
  const boardId = Number(params['boardId']);
  const { data: board, isPending, isError } = useBoardMeta(boardId);
  const { data: groups } = useBoards();
  const { data: meta } = useMeta();
  useBoardEvents(boardId);
  useKeyboardShortcuts('board', board?.is_closed === true ? undefined : boardId);

  const cachedName = boardNameFromGroups(groups, boardId);
  const name = board?.name ?? cachedName;

  useEffect(() => {
    if (name === undefined) return undefined;
    document.title = `${name} | ${APP_TITLE}`;
    // Leaving the board must not leave its name in the tab.
    return () => {
      document.title = APP_TITLE;
    };
  }, [name]);

  if (!isId(boardId) || isError) {
    return (
      <NotFoundPage title="Board not found" body="This board may be private or may not exist." />
    );
  }

  if (isPending || board === undefined) {
    return (
      <main className={styles.page}>
        <div className={styles.loadingHeader}>{cachedName ?? ''}</div>
        <div className={styles.loadingCanvas}>
          {Array.from({ length: SKELETON_LISTS }, (_, list) => (
            <div key={list} className={styles.skeletonList}>
              {Array.from({ length: SKELETON_CARDS }, (_, card) => (
                <div key={card} className={styles.skeletonCard} />
              ))}
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page} style={boardBackgroundStyle(board, meta?.board_gradients ?? {})}>
      {board.is_closed ? (
        <ClosedBoardPage board={board} />
      ) : (
        <>
          <ReconnectingBanner />
          <BoardHeader boardId={boardId} />
          <BoardCanvas boardId={boardId} />
          <CardShortcutPopovers boardId={boardId} />
          <Outlet />
        </>
      )}
    </main>
  );
}
