import { describe, expect, it } from 'vitest';
import {
  boardBackgroundStyle,
  boardNameFromGroups,
  initialsFromName,
  setBoardStarred,
  sortBoardsByName,
  type BoardBackgroundFields,
  type BoardGrouping,
  type GroupableBoard,
} from './boardGroups';

function board(id: number, name: string, isStarred = false): GroupableBoard {
  return { id, name, is_starred: isStarred };
}

const ROADMAP = board(1, 'Roadmap', true);
const WEBSITE = board(2, 'Website');
const GARDEN = board(3, 'garden');

const GROUPS: BoardGrouping<GroupableBoard> = {
  starred: [ROADMAP],
  recent: [WEBSITE, ROADMAP],
  all: [GARDEN, ROADMAP, WEBSITE],
};

describe('sortBoardsByName', () => {
  it('sorts case-insensitively without mutating the input', () => {
    const input = [WEBSITE, GARDEN, ROADMAP];
    expect(sortBoardsByName(input).map((entry) => entry.id)).toEqual([3, 1, 2]);
    expect(input.map((entry) => entry.id)).toEqual([2, 3, 1]);
  });

  it('breaks ties on id', () => {
    const duplicates = [board(9, 'Sprint 42'), board(4, 'sprint 42')];
    expect(sortBoardsByName(duplicates).map((entry) => entry.id)).toEqual([4, 9]);
  });
});

describe('setBoardStarred', () => {
  it('appends a newly starred board to the starred group and flips the flag everywhere', () => {
    const next = setBoardStarred(GROUPS, 2, true);
    expect(next.starred.map((entry) => entry.id)).toEqual([1, 2]);
    expect(next.starred.every((entry) => entry.is_starred)).toBe(true);
    expect(next.recent.map((entry) => entry.is_starred)).toEqual([true, true]);
    expect(next.all.map((entry) => entry.is_starred)).toEqual([false, true, true]);
  });

  it('removes an unstarred board from the starred group and keeps it in the others', () => {
    const next = setBoardStarred(GROUPS, 1, false);
    expect(next.starred).toEqual([]);
    expect(next.recent.map((entry) => entry.is_starred)).toEqual([false, false]);
    expect(next.all.map((entry) => entry.id)).toEqual([3, 1, 2]);
  });

  it('leaves an already starred board in place', () => {
    const next = setBoardStarred(GROUPS, 1, true);
    expect(next.starred.map((entry) => entry.id)).toEqual([1]);
  });

  it('ignores a board no group holds', () => {
    const next = setBoardStarred(GROUPS, 99, true);
    expect(next.starred.map((entry) => entry.id)).toEqual([1]);
  });
});

describe('boardBackgroundStyle', () => {
  const gradients = { 'gradient-ocean': 'linear-gradient(135deg, var(--primary) 0%, blue 100%)' };

  function background(overrides: Partial<BoardBackgroundFields>): BoardBackgroundFields {
    return {
      background_type: 'color',
      background_value: 'var(--primary)',
      background_thumb_url: null,
      ...overrides,
    };
  }

  it('paints a colour background with the stored value', () => {
    expect(boardBackgroundStyle(background({ background_value: 'teal' }), gradients)).toEqual({
      backgroundColor: 'teal',
    });
  });

  it('resolves a gradient key through the server palette', () => {
    const style = boardBackgroundStyle(
      background({ background_type: 'gradient', background_value: 'gradient-ocean' }),
      gradients,
    );
    expect(style).toEqual({ backgroundImage: gradients['gradient-ocean'] });
  });

  it('falls back to the default board colour for an unknown gradient key', () => {
    const style = boardBackgroundStyle(
      background({ background_type: 'gradient', background_value: 'gradient-none' }),
      gradients,
    );
    expect(style).toEqual({ backgroundColor: 'var(--primary)' });
  });

  it('uses the 400x240 thumbnail for an image background', () => {
    const style = boardBackgroundStyle(
      background({
        background_type: 'image',
        background_value: '/uploads/backgrounds/4.jpg',
        background_thumb_url: '/uploads/backgrounds/4.thumb.jpg',
      }),
      gradients,
    );
    expect(style).toEqual({
      backgroundImage: 'url("/uploads/backgrounds/4.thumb.jpg")',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    });
  });

  it('falls back to the full-size image when no thumbnail was stored', () => {
    const style = boardBackgroundStyle(
      background({ background_type: 'image', background_value: '/uploads/backgrounds/4.jpg' }),
      gradients,
    );
    expect(style.backgroundImage).toBe('url("/uploads/backgrounds/4.jpg")');
  });
});

describe('initialsFromName', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFromName('Vivek Sharma')).toBe('VS');
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(initialsFromName('  asha   rao  kumar ')).toBe('AR');
  });

  it('honours a one-letter request for the workspace badge', () => {
    expect(initialsFromName('Kan Ban Workspace', 1)).toBe('K');
  });

  it('returns an empty string for a blank name', () => {
    expect(initialsFromName('   ')).toBe('');
  });
});

describe('boardNameFromGroups', () => {
  it('finds the board in any of the three groups', () => {
    expect(boardNameFromGroups(GROUPS, 3)).toBe('garden');
  });

  it('is undefined for a board the cache does not hold', () => {
    expect(boardNameFromGroups(GROUPS, 99)).toBeUndefined();
  });

  it('is undefined before the boards have ever been fetched', () => {
    expect(boardNameFromGroups(undefined, 1)).toBeUndefined();
  });
});
