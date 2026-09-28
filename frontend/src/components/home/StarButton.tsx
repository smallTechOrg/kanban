import { useState, type ReactElement } from 'react';
import { Star } from 'lucide-react';
import { IconButton, cx } from '@/components/ui';
import { useStarBoard } from '@/hooks/useBoards';
import styles from './StarButton.module.css';

export interface StarButtonProps {
  boardId: number;
  isStarred: boolean;
  /**
   * The container positions the star and drives its reveal, so it owns those rules: a board
   * tile fades it in on hover (Section 2.2), a board header shows it always (Section 2.3.1).
   */
  className?: string;
}

/**
 * The per-user star of Section 2.2: filled `--star` when starred, and a 0.2s
 * `scale(1) -> 1.2 -> 1` pop on every click. The write is optimistic inside `useStarBoard`,
 * which is why the label flips before the request resolves.
 */
export function StarButton({ boardId, isStarred, className }: StarButtonProps): ReactElement {
  const { mutate } = useStarBoard();
  const [popping, setPopping] = useState(false);

  return (
    <IconButton
      label={isStarred ? 'Unstar board' : 'Star board'}
      size="sm"
      tone="white"
      className={cx(styles.star, isStarred && styles.starred, popping && styles.pop, className)}
      onClick={(event) => {
        // The whole tile is a link: starring must not navigate to the board.
        event.preventDefault();
        event.stopPropagation();
        setPopping(true);
        mutate({ boardId, isStarred: !isStarred });
      }}
      onAnimationEnd={() => setPopping(false)}
    >
      <Star aria-hidden="true" fill={isStarred ? 'currentColor' : 'none'} />
    </IconButton>
  );
}
