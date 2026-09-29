/**
 * UI-only state (Section 5.13). Never server data — that lives in the react-query cache.
 *
 * Six fields survive a reload. zustand's `persist` middleware is deliberately NOT used:
 * it writes one JSON blob under a single name, and the plan pins one localStorage key per
 * field so `main.tsx` can read `kb_theme` before first paint and `lib/colors.ts` can read
 * `kb_labelPalette` without loading the store.
 */
import { create } from 'zustand';
import type { RealtimeStatus } from '@/api/events';
import type { BoardEvent } from '@/api/types';
import { EMPTY_FILTER, type BoardFilter } from '@/lib/filter';

/**
 * Three of this store's fields are shaped elsewhere, and the type belongs with the rule rather
 * than with the state: the filter and its predicate are `lib/filter.ts` (which `lib/` may not
 * import a store from anyway), the event payload is the wire shape of `api/types.ts`, and the
 * connection state is decided by `api/events.ts`. All of them stay importable from here, the home
 * Section 5.13 gives them, so no caller has to know where each one is declared.
 */
export type { ActivityFilter, BoardFilter, DueFilter, MatchMode, StatusFilter } from '@/lib/filter';
export { EMPTY_FILTER } from '@/lib/filter';
export type { RealtimeStatus } from '@/api/events';
export type { BoardEvent, EventEntity } from '@/api/types';

export type PopoverKind =
  | 'attachment'
  | 'boardBackground'
  | 'boards'
  | 'checklist'
  | 'confirm'
  | 'copyCard'
  | 'cover'
  | 'createBoard'
  | 'createFromTemplate'
  | 'createMenu'
  | 'dates'
  | 'emoji'
  | 'filter'
  | 'itemDue'
  | 'labels'
  | 'listMenu'
  | 'moveCard'
  | 'search'
  | 'switchTo';

export interface OpenPopover {
  kind: PopoverKind;
  anchor: HTMLElement | DOMRect;
  props?: Record<string, unknown>;
}

export type ComposerState =
  { kind: 'card'; listId: number; index?: number | 'top' | 'bottom' } | { kind: 'list' };

export type Theme = 'light' | 'dark' | 'classic';
export type LabelPaletteName = 'tritone' | 'classic';

export interface UiState {
  openPopover: OpenPopover | null;
  hoveredCardId: number | null;
  focusedCardId: number | null;
  openCardId: number | null;
  composer: ComposerState | null;
  quickEditCardId: number | null;
  /**
   * Whether the quick editor should open with the whole title selected: the `T` shortcut of
   * Section 2.8, which is `E` plus that one difference, so it is a flag beside the card rather
   * than a second field for the same overlay.
   */
  quickEditSelectsTitle: boolean;
  filter: BoardFilter;
  boardMenuOpen: boolean;
  shortcutsOpen: boolean;
  realtimeStatus: RealtimeStatus;
  labelTextMode: boolean;
  theme: Theme;
  colorBlindLabels: boolean;
  labelPalette: LabelPaletteName;
  cardCoversEnabled: boolean;
  collapsedListIds: number[];
  isDragging: boolean;
  queuedEvents: BoardEvent[];
  pendingByClientId: Record<string, Array<() => void>>;
}

export interface UiActions {
  setOpenPopover: (popover: OpenPopover | null) => void;
  setHoveredCardId: (cardId: number | null) => void;
  setFocusedCardId: (cardId: number | null) => void;
  setOpenCardId: (cardId: number | null) => void;
  setComposer: (composer: ComposerState | null) => void;
  setQuickEditCardId: (cardId: number | null, selectsTitle?: boolean) => void;
  setFilter: (patch: Partial<BoardFilter>) => void;
  resetFilter: () => void;
  setBoardMenuOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setRealtimeStatus: (status: RealtimeStatus) => void;
  setLabelTextMode: (enabled: boolean) => void;
  setTheme: (theme: Theme) => void;
  setColorBlindLabels: (enabled: boolean) => void;
  setLabelPalette: (palette: LabelPaletteName) => void;
  setCardCoversEnabled: (enabled: boolean) => void;
  toggleListCollapsed: (listId: number) => void;
  setDragging: (dragging: boolean) => void;
  queueEvent: (event: BoardEvent) => void;
  takeQueuedEvents: () => BoardEvent[];
  addPending: (clientId: string, resolve: () => void) => void;
  takePending: (clientId: string) => Array<() => void>;
}

/** One localStorage key per persisted field (Section 5.13). */
type PersistedField =
  | 'labelTextMode'
  | 'theme'
  | 'colorBlindLabels'
  | 'labelPalette'
  | 'cardCoversEnabled'
  | 'collapsedListIds';

export const PERSISTED: Record<PersistedField, string> = {
  labelTextMode: 'kb_labelText',
  theme: 'kb_theme',
  colorBlindLabels: 'kb_colorBlindLabels',
  labelPalette: 'kb_labelPalette',
  cardCoversEnabled: 'kb_cardCovers',
  collapsedListIds: 'kb_collapsedLists',
};

const THEMES: readonly string[] = ['light', 'dark', 'classic'];
const LABEL_PALETTES: readonly string[] = ['tritone', 'classic'];

function isBoolean(value: unknown): boolean {
  return typeof value === 'boolean';
}

function isNumberArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}

function isOneOf(allowed: readonly string[]): (value: unknown) => boolean {
  return (value) => typeof value === 'string' && allowed.includes(value);
}

/** Reads a persisted value. A blocked, full or corrupted storage falls back to the default. */
function readKey<T>(key: string, fallback: T, isValid: (value: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeKey(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or an exhausted quota: the value still applies for this session.
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

/** Reads the persisted theme and applies it to <html> before the first paint (Section 5.6). */
export function initTheme(): Theme {
  const theme = readKey<Theme>(PERSISTED.theme, 'light', isOneOf(THEMES));
  applyTheme(theme);
  return theme;
}

export const useUiStore = create<UiState & UiActions>()((set, get) => ({
  openPopover: null,
  hoveredCardId: null,
  focusedCardId: null,
  openCardId: null,
  composer: null,
  quickEditCardId: null,
  quickEditSelectsTitle: false,
  filter: EMPTY_FILTER,
  boardMenuOpen: false,
  shortcutsOpen: false,
  realtimeStatus: 'live',
  labelTextMode: readKey(PERSISTED.labelTextMode, false, isBoolean),
  theme: readKey<Theme>(PERSISTED.theme, 'light', isOneOf(THEMES)),
  colorBlindLabels: readKey(PERSISTED.colorBlindLabels, false, isBoolean),
  labelPalette: readKey<LabelPaletteName>(
    PERSISTED.labelPalette,
    'tritone',
    isOneOf(LABEL_PALETTES),
  ),
  cardCoversEnabled: readKey(PERSISTED.cardCoversEnabled, true, isBoolean),
  collapsedListIds: readKey<number[]>(PERSISTED.collapsedListIds, [], isNumberArray),
  isDragging: false,
  queuedEvents: [],
  pendingByClientId: {},

  setOpenPopover: (openPopover) => set({ openPopover }),
  setHoveredCardId: (hoveredCardId) => set({ hoveredCardId }),
  setFocusedCardId: (focusedCardId) => set({ focusedCardId }),
  setOpenCardId: (openCardId) => set({ openCardId }),
  setComposer: (composer) => set({ composer }),
  setQuickEditCardId: (quickEditCardId, selectsTitle = false) =>
    set({ quickEditCardId, quickEditSelectsTitle: selectsTitle }),
  setFilter: (patch) => set((state) => ({ filter: { ...state.filter, ...patch } })),
  resetFilter: () => set({ filter: EMPTY_FILTER }),
  setBoardMenuOpen: (boardMenuOpen) => set({ boardMenuOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setRealtimeStatus: (realtimeStatus) => set({ realtimeStatus }),

  setLabelTextMode: (labelTextMode) => {
    set({ labelTextMode });
    writeKey(PERSISTED.labelTextMode, labelTextMode);
  },
  setTheme: (theme) => {
    set({ theme });
    writeKey(PERSISTED.theme, theme);
    applyTheme(theme);
  },
  setColorBlindLabels: (colorBlindLabels) => {
    set({ colorBlindLabels });
    writeKey(PERSISTED.colorBlindLabels, colorBlindLabels);
  },
  setLabelPalette: (labelPalette) => {
    set({ labelPalette });
    writeKey(PERSISTED.labelPalette, labelPalette);
  },
  setCardCoversEnabled: (cardCoversEnabled) => {
    set({ cardCoversEnabled });
    writeKey(PERSISTED.cardCoversEnabled, cardCoversEnabled);
  },
  toggleListCollapsed: (listId) => {
    const current = get().collapsedListIds;
    const collapsedListIds = current.includes(listId)
      ? current.filter((id) => id !== listId)
      : [...current, listId];
    set({ collapsedListIds });
    writeKey(PERSISTED.collapsedListIds, collapsedListIds);
  },
  setDragging: (isDragging) => set({ isDragging }),
  queueEvent: (event) => set((state) => ({ queuedEvents: [...state.queuedEvents, event] })),
  takeQueuedEvents: () => {
    const { queuedEvents } = get();
    set({ queuedEvents: [] });
    return queuedEvents;
  },
  addPending: (clientId, resolve) =>
    set((state) => ({
      pendingByClientId: {
        ...state.pendingByClientId,
        [clientId]: [...(state.pendingByClientId[clientId] ?? []), resolve],
      },
    })),
  takePending: (clientId) => {
    const { [clientId]: pending, ...rest } = get().pendingByClientId;
    set({ pendingByClientId: rest });
    return pending ?? [];
  },
}));
