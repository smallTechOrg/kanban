import { useRef, type ReactElement } from 'react';
import { useUiStore } from '@/store/uiStore';
import { CreateBoardPopover } from './CreateBoardPopover';
import styles from './CreateBoardTile.module.css';

/**
 * The "Create new board" tile of Section 2.2, and the anchor of its popover.
 *
 * Which popover is open lives in `uiStore` (Section 5.13), so opening this one closes any
 * other. The anchor is part of the match because the TopNav Create menu opens the same
 * `createBoard` kind against its own trigger, and only one of the two should render it.
 */
export function CreateBoardTile(): ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openPopover = useUiStore((state) => state.openPopover);
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);
  const button = buttonRef.current;
  const isOpen =
    openPopover?.kind === 'createBoard' && button !== null && openPopover.anchor === button;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.tile}
        onClick={() => {
          if (buttonRef.current !== null) {
            setOpenPopover({ kind: 'createBoard', anchor: buttonRef.current });
          }
        }}
      >
        Create new board
      </button>
      {isOpen ? <CreateBoardPopover anchor={button} onClose={() => setOpenPopover(null)} /> : null}
    </>
  );
}
