import { useState, type ReactElement, type ReactNode } from 'react';
import { LayoutGrid, Lock, SquareCheckBig } from 'lucide-react';
import { BoardTile } from '@/components/home/BoardTile';
import { BoardsGrid } from '@/components/home/BoardsGrid';
import { ClosedBoardsModal } from '@/components/home/ClosedBoardsModal';
import { CreateBoardTile } from '@/components/home/CreateBoardTile';
import { Button, EmptyState, cx } from '@/components/ui';
import { useBoards } from '@/hooks/useBoards';
import { useMeta } from '@/hooks/useMeta';
import { formatLongDate, greeting } from '@/lib/dates';
import styles from './HomePage.module.css';

/** Section 2.10: six skeleton tiles while `GET /api/boards` is in flight. */
const SKELETON_TILES = 6;

/** Section 2.2: the tagline, which is the one place the product explains itself. */
const TAGLINE = "Everything you're on, in one place.";

const BLURB =
  'A board for the shopping, one for the bills, one for the week ahead. Drag the cards where ' +
  'they belong and tick things off as you go.';

/**
 * The three things worth knowing before the first click (Section 2.2). Short enough to read
 * without deciding to: a heading, a line, an icon that repeats what the line says.
 */
const POINTS: readonly { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <LayoutGrid aria-hidden="true" />,
    title: 'A board for each part of life',
    text: 'Shopping, money, chores, the week ahead — whatever you keep track of.',
  },
  {
    icon: <SquareCheckBig aria-hidden="true" />,
    title: 'Tick things off',
    text: 'Items sit on the card itself, so a column shows what is left at a glance.',
  },
  {
    icon: <Lock aria-hidden="true" />,
    title: 'Nothing to sign in to',
    text: 'It runs on your own machine and the boards are yours. No account, ever.',
  },
];

const EMPTY_BLURB =
  'Boards are where everything you are keeping track of lives. Create your first one to add ' +
  'lists and cards.';

/**
 * Section 2.10 words a failed *mutation* ("Couldn't save changes.") but leaves a failed read to
 * the surface that made it. The blurb below is the wrong answer for one — it invites a first
 * board to a user who may already have twelve — so the grid says what happened and offers the
 * retry, in the same voice.
 */
const LOAD_ERROR = "Couldn't load your boards.";

/** How far apart the tiles rise, and the tile after which they all arrive together. */
const STAGGER_MS = 40;
const STAGGER_LIMIT = 9;

/** The entrance delay of the nth tile, as the inline style Section 5 allows for computed values. */
function riseDelay(index: number): { animationDelay: string } {
  return { animationDelay: `${String(Math.min(index, STAGGER_LIMIT) * STAGGER_MS)}ms` };
}

/**
 * The home page (Section 2.2): who it is addressed to, what the app is for, then every board in
 * one flat grid.
 *
 * There is no Starred group, no Recently viewed and no "Your boards" heading. One person uses
 * this install and every board is theirs, so grouping a handful of boards by how recently they
 * were opened was Trello's answer to a problem this app does not have — and a heading over the
 * only list on the page names nothing. What is left is addressed to the reader instead: the
 * greeting and the date come from `lib/dates.ts`, the one module that turns a date into text,
 * and the tagline and the three points below it say in four lines what the app is, because an
 * install with no sign-up has no other moment to say it.
 *
 * Everything on the page rises into place once, staggered by `riseDelay`, and `global.css`
 * neutralises all of it under `prefers-reduced-motion`.
 */
export function HomePage(): ReactElement {
  const { data, isPending, isError, refetch } = useBoards();
  const { data: meta } = useMeta();
  const [closedOpen, setClosedOpen] = useState(false);
  // Read once per render rather than held in state: the page is not open long enough for the
  // greeting to go stale, and a timer would repaint every tile to change one word.
  const now = new Date();

  const gradients = meta?.board_gradients ?? {};
  const all = data?.all ?? [];

  return (
    <main className={styles.page}>
      <header className={cx(styles.intro, styles.rise)}>
        <h1 className={styles.greeting}>{greeting(now)}</h1>
        <p className={styles.date}>{formatLongDate(now)}</p>
        <p className={styles.tagline}>{TAGLINE}</p>
        <p className={styles.blurb}>{BLURB}</p>
      </header>

      <ul className={styles.points}>
        {POINTS.map((point, index) => (
          <li key={point.title} className={styles.point} style={riseDelay(index + 1)}>
            <span className={styles.pointIcon}>{point.icon}</span>
            <span className={styles.pointTitle}>{point.title}</span>
            <span className={styles.pointText}>{point.text}</span>
          </li>
        ))}
      </ul>

      <BoardsGrid>
        {isPending
          ? Array.from({ length: SKELETON_TILES }, (_, index) => (
              <div key={index} className={styles.skeleton} />
            ))
          : [
              ...all.map((board, index) => (
                <div key={board.id} className={styles.rise} style={riseDelay(index)}>
                  <BoardTile board={board} gradients={gradients} />
                </div>
              )),
              <div key="create" className={styles.rise} style={riseDelay(all.length)}>
                <CreateBoardTile />
              </div>,
            ]}
      </BoardsGrid>

      {isError ? (
        <EmptyState
          message={LOAD_ERROR}
          action={<Button onClick={() => void refetch()}>Try again</Button>}
        />
      ) : null}

      {!isPending && !isError && all.length === 0 ? <EmptyState message={EMPTY_BLURB} /> : null}

      <div className={styles.closed}>
        <Button onClick={() => setClosedOpen(true)}>View all closed boards</Button>
      </div>

      {closedOpen ? <ClosedBoardsModal onClose={() => setClosedOpen(false)} /> : null}
    </main>
  );
}
