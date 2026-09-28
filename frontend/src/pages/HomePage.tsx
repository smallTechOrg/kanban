import { useState, type ReactElement } from 'react';
import { Clock, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { BoardSummary } from '@/api/types';
import { BoardTile } from '@/components/home/BoardTile';
import { BoardsGrid } from '@/components/home/BoardsGrid';
import { BoardsSection } from '@/components/home/BoardsSection';
import { ClosedBoardsModal } from '@/components/home/ClosedBoardsModal';
import { CreateBoardTile } from '@/components/home/CreateBoardTile';
import { HomeSidebar } from '@/components/home/HomeSidebar';
import { Button, EmptyState } from '@/components/ui';
import { useBoards } from '@/hooks/useBoards';
import { useMeta } from '@/hooks/useMeta';
import { initialsFromName } from '@/lib/boardGroups';
import styles from './HomePage.module.css';

/**
 * v1 has exactly one workspace (Section 1.3). The name is copy, not server data, so it
 * lives here and is handed to the sidebar rather than duplicated in both.
 */
const WORKSPACE_NAME = 'Kan Ban Workspace';

/** Section 2.2: "Recently viewed" shows up to four tiles. */
const RECENT_LIMIT = 4;

/** Section 2.10: six skeleton tiles while `GET /api/boards` is in flight. */
const SKELETON_TILES = 6;

const EMPTY_BLURB =
  'Boards are where work gets done in Kan Ban. Create your first board to add lists and cards.';

/**
 * Section 2.10 words a failed *mutation* ("Couldn't save changes.") but leaves a failed read to
 * the surface that made it. The blurb below is the wrong answer for one — it invites a first
 * board to a user who may already have twelve — so the grid says what happened and offers the
 * retry, in the same voice.
 */
const LOAD_ERROR = "Couldn't load your boards.";

/**
 * The home page of Section 2.2: the sticky sidebar and, in order, Starred boards, Recently
 * viewed and YOUR WORKSPACES, which owns the create tile and the closed-boards link.
 */
export function HomePage(): ReactElement {
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useBoards();
  const { data: meta } = useMeta();
  const [closedOpen, setClosedOpen] = useState(false);

  const gradients = meta?.board_gradients ?? {};
  const starred = data?.starred ?? [];
  const recent = (data?.recent ?? []).slice(0, RECENT_LIMIT);
  const all = data?.all ?? [];

  const tiles = (boards: BoardSummary[]): ReactElement[] =>
    boards.map((board) => <BoardTile key={board.id} board={board} gradients={gradients} />);

  return (
    <main className={styles.page}>
      <HomeSidebar workspaceName={WORKSPACE_NAME} />

      <div className={styles.content}>
        {starred.length > 0 ? (
          <BoardsSection title="Starred boards" icon={<Star aria-hidden="true" />}>
            <BoardsGrid>{tiles(starred)}</BoardsGrid>
          </BoardsSection>
        ) : null}

        {recent.length > 0 ? (
          <BoardsSection title="Recently viewed" icon={<Clock aria-hidden="true" />}>
            <BoardsGrid>{tiles(recent)}</BoardsGrid>
          </BoardsSection>
        ) : null}

        <BoardsSection
          title="Your workspaces"
          variant="eyebrow"
          header={
            <div className={styles.workspace}>
              <span className={styles.badge} aria-hidden="true">
                {initialsFromName(WORKSPACE_NAME, 1)}
              </span>
              <h4 className={styles.workspaceName}>{WORKSPACE_NAME}</h4>
              <Button onClick={() => navigate('/')}>Boards</Button>
              <Button onClick={() => navigate('/w/members')}>Members</Button>
              <Button onClick={() => navigate('/w/settings')}>Settings</Button>
            </div>
          }
        >
          <BoardsGrid>
            {isPending
              ? Array.from({ length: SKELETON_TILES }, (_, index) => (
                  <div key={index} className={styles.skeleton} />
                ))
              : [...tiles(all), <CreateBoardTile key="create" />]}
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
        </BoardsSection>
      </div>

      {closedOpen ? <ClosedBoardsModal onClose={() => setClosedOpen(false)} /> : null}
    </main>
  );
}
