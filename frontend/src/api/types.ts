/**
 * API response types.
 *
 * FROM M1 THIS FILE IS GENERATED — `npm run gen:types` runs
 * `openapi-typescript http://127.0.0.1:8000/api/openapi.json -o frontend/src/api/types.ts`
 * and overwrites everything below. Do not hand-edit it once the generator runs; CI fails
 * when the committed file differs from a fresh generation (Sections 4.11 and 5.14).
 *
 * Until the M1 backend serves that document these shapes are written out by hand from
 * Sections 4.2, 4.3, 4.7 and 4.10.1, with the server's own `snake_case` field names.
 * Request bodies live beside the call that sends them (`api/boards.ts`, `api/cards.ts`).
 */

/** `GET /api/health` — used by reverse proxies and the home page's status line. */
export interface Health {
  status: 'ok';
  db: 'ok';
  version: string;
  frontend_build: boolean;
}

/** Label tone stored on `labels.tone` (Section 2.9.2). */
export type LabelTone = 'subtle' | 'normal' | 'bold';

/** One row of the label palette served by `GET /api/meta`. */
export interface LabelColor {
  subtle: string;
  normal: string;
  bold: string;
  text: string;
  text_bold: string;
}

/** `GET /api/meta` — public; the single source of every palette the client renders. */
export interface Meta {
  version: string;
  label_colors: Record<string, LabelColor>;
  cover_colors: Record<string, string>;
  board_colors: Record<string, string>;
  board_gradients: Record<string, string>;
  list_colors: Record<string, string>;
  max_upload_mb: number;
}

export type BackgroundType = 'color' | 'gradient' | 'image';

/** A board tile / header row. `background_value` is a hex for `color`, a `/api/meta` key for `gradient`. */
export interface BoardSummary {
  id: number;
  name: string;
  description: string;
  background_type: BackgroundType;
  background_value: string;
  /** The 400x240 `/uploads/backgrounds/{id}.thumb.jpg` for image backgrounds, else null. */
  background_thumb_url: string | null;
  is_closed: boolean;
  version: number;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
}

/** `GET /api/boards` — `starred` by star position, `recent` the last 4 viewed, `all` alphabetical. */
export interface BoardGroups {
  starred: BoardSummary[];
  recent: BoardSummary[];
  all: BoardSummary[];
}

/** `GET /api/boards?closed=1`, the rows of `ClosedBoardsModal`. */
export interface ClosedBoards {
  closed: BoardSummary[];
}

/** `lists.color`: one of the ten keys `GET /api/meta` publishes as `list_colors` (Section 4.4). */
export type ListColorKey =
  'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'blue' | 'sky' | 'lime' | 'pink' | 'gray';

/** `labels.color`: the ten `label_colors` keys plus `none` (Sections 2.9.2 and 4.3). */
export type LabelColorKey =
  | 'green'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'purple'
  | 'blue'
  | 'sky'
  | 'lime'
  | 'pink'
  | 'black'
  | 'none';

/** A board label (Section 4.3). `name` may be empty — the six seeded labels are. */
export interface Label {
  id: number;
  board_id: number;
  name: string;
  color: LabelColorKey;
  tone: LabelTone;
  position: number;
}

/** `GET /api/boards/{board_id}/labels`. */
export interface LabelList {
  items: Label[];
}

/** A list column as every list mutation and the board payload return it (Section 4.4). */
export interface ListOut {
  id: number;
  board_id: number;
  name: string;
  position: number;
  color: ListColorKey | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

/** One row of `GET /api/boards/{board_id}/lists`: a list plus its active card count. */
export interface ListWithCount extends ListOut {
  card_count: number;
}

/** `GET /api/boards/{board_id}/lists` (Section 4.4). */
export interface ListList {
  items: ListWithCount[];
}

/** The four tile badge counts of Sections 2.5.3 and 4.10.1. */
export interface Badges {
  description: boolean;
  attachments: number;
  checklist_done: number;
  checklist_total: number;
}

export type CoverKind = 'color' | 'attachment';
export type CoverSize = 'normal' | 'full';

/**
 * `cards.cover_type` / `cover_value` / `cover_size` as the tile reads them (Section 4.10.1).
 * `image_url` and `dominant_color` are only ever set for an `attachment` cover (M4).
 */
export interface CardCover {
  kind: CoverKind;
  value: string;
  size: CoverSize;
  image_url?: string;
  dominant_color?: string;
}

/**
 * A card as every card response and the board payload carry it (Sections 4.5 and 4.10.1).
 * `client_id` is the stored `cards.client_id` echoed for the row's lifetime, so `CardTile`
 * keys on `client_id ?? id` and never remounts on the optimistic id swap (Section 4.4).
 */
export interface CardSummary {
  id: number;
  client_id?: string;
  board_id: number;
  list_id: number;
  short_id: number;
  title: string;
  position: number;
  is_archived: boolean;
  is_template: boolean;
  start_at: string | null;
  due_at: string | null;
  due_complete: boolean;
  cover: CardCover | null;
  label_ids: number[];
  badges: Badges;
  created_at: string;
  updated_at: string;
}

/** One row of a checklist, as Section 4.6 types it. */
export interface ChecklistItem {
  id: number;
  checklist_id: number;
  name: string;
  position: number;
  is_checked: boolean;
  checked_at: string | null;
  due_at: string | null;
}

/**
 * `PATCH /api/checklist-items/{item_id}` answers with `ChecklistItemOut & {badges}`, so ticking
 * an item patches the tile's `checklist_done / checklist_total` from the same round trip
 * (Section 4.6).
 */
export interface ChecklistItemPatched extends ChecklistItem {
  badges: Badges;
}

/** A checklist with its items in `position` order (Section 4.6). */
export interface Checklist {
  id: number;
  card_id: number;
  name: string;
  position: number;
  items: ChecklistItem[];
}

/** `POST /api/checklists/{checklist_id}/items` with `split_lines`: one item per line (4.6). */
export interface ItemsCreated {
  items: ChecklistItem[];
  board_version: number;
}

/** One row of `GET /api/boards/{board_id}/checklists`: the "Copy items from…" select (4.6). */
export interface BoardChecklist {
  id: number;
  name: string;
  card_id: number;
  card_title: string;
  item_count: number;
}

/** `GET /api/boards/{board_id}/checklists` (Section 4.6). */
export interface BoardChecklistList {
  items: BoardChecklist[];
}

/** `attachments.kind`: an uploaded file or a pasted link (Sections 3.4 and 4.6). */
export type AttachmentKind = 'upload' | 'link';

/**
 * One `attachments` row (`AttachmentOut`, Section 4.6). `url` is what the row links to and
 * what the section renders: `/uploads/attachments/{id}/{safe_name}` for an upload (Section
 * 3.11) or the pasted `http(s)` address for a link. `thumb_url` is the 512x256 2:1 JPEG
 * images get, which is also the `cover.image_url` of a card covered by this attachment, and
 * `dominant_color` the colour Pillow read off it; both are `null` for everything else.
 */
export interface Attachment {
  id: number;
  card_id: number;
  name: string;
  kind: AttachmentKind;
  url: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_image: boolean;
  thumb_url: string | null;
  dominant_color: string | null;
  /** True while this attachment is the card's cover, so the row offers "Remove cover". */
  is_cover: boolean;
  created_at: string;
}

/**
 * The nine `DatesPopover` reminder offsets, in minutes before the due date; `0` is "At time of
 * due date" and `null` "None" (Section 2.6.5). The request body is validated against this closed
 * list; the stored value comes back as a plain number.
 */
export type DueReminderMinutes = 0 | 5 | 10 | 15 | 60 | 120 | 1440 | 2880;

/**
 * `GET /api/cards/{card_id}` — `CardSummary` plus the fields only the modal reads (Section 4.5).
 * `label_ids` stays an id array because the board payload already cached every label of the
 * board; `attachments` does not, because only the modal renders it and the cover strip reads
 * the original image out of it by `Number(cover.value)` (Section 2.6.1).
 */
export interface CardDetail extends CardSummary {
  description: string;
  due_reminder_minutes: number | null;
  board_name: string;
  list_name: string;
  checklists: Checklist[];
  attachments: Attachment[];
}

/**
 * `PUT` / `DELETE /api/cards/{card_id}/labels/{label_id}` (Section 4.5). Deliberately not a
 * `Mutated<Label>`: the card's whole label id list comes back, in the `position` order the
 * chips row renders, so the client patches one array into its caches.
 */
export interface CardLabels {
  label_ids: number[];
  board_version: number;
}

/**
 * One `activities` row as either feed carries it (Sections 4.3 and 4.5). `data` holds the names
 * denormalised at write time, and `lib/activity.ts` renders the Section 3.8 sentence from
 * `type` + `data`, so a row about a deleted card still reads correctly.
 */
export interface Activity {
  id: number;
  board_id: number;
  card_id: number | null;
  list_id: number | null;
  type: string;
  data: Record<string, unknown>;
  board_version: number;
  created_at: string;
}

/**
 * `GET /api/boards/{board_id}` — the single round-trip board document (Section 4.10.1),
 * served for a closed board too. `lists` and `cards` hold the active rows only;
 * `lib/normalize.ts` turns the arrays into the cache shape of 5.4.2.
 */
export interface BoardPayload {
  board: BoardSummary;
  labels: Label[];
  lists: ListOut[];
  cards: CardSummary[];
}

/** The M1 name for the payload above, still used by `hooks/useBoards.ts`. */
export type Board = BoardPayload;

/** `POST /api/lists/{list_id}/cards` with `split_lines`: one card per pasted line (4.4). */
export interface CardsCreated {
  items: CardSummary[];
  board_version: number;
}

/** `PUT` / `DELETE /api/boards/{board_id}/star`. A star bumps no version and records no activity. */
export interface StarState {
  is_starred: boolean;
}

/** `GET /api/boards/{board_id}/backgrounds` — the `/api/meta` presets plus the uploaded images. */
export interface BoardBackgrounds {
  colors: { key: string; hex: string }[];
  gradients: { key: string; css: string }[];
  custom: { id: number; url: string; thumb_url: string }[];
}

/**
 * Every single-row mutation inside a board (Section 4.1). `board_version` is the board's
 * version after the write; for a `BoardSummary` item it equals `item.version`.
 */
export interface Mutated<T> {
  item: T;
  board_version: number;
}

/**
 * Every move response (Section 4.9). `positions` is empty unless the server had to renumber
 * the container; when it is not, the client writes every listed position into its cache and
 * re-sorts. JSON object keys are strings, so the map is keyed by the id as text.
 */
export interface MoveResult<T> extends Mutated<T> {
  positions: Record<string, number>;
}

/** `POST /api/lists/{list_id}/sort` — the rewritten positions of the active cards (4.4). */
export interface PositionsResult {
  positions: Record<string, number>;
  board_version: number;
}

/** `POST /api/lists/{list_id}/move-all-cards` — `PositionsResult` plus how many moved. */
export interface MoveAllCardsResult extends PositionsResult {
  moved: number;
}

/** `POST /api/lists/{list_id}/archive-all-cards`; `archived_ids` feeds the Undo toast (4.4). */
export interface ArchiveAllCardsResult {
  archived: number;
  archived_ids: number[];
  board_version: number;
}

/** `POST /api/lists/{list_id}/unarchive-cards` — how many of the ids came back (4.4). */
export interface UnarchiveCardsResult {
  restored: number;
  board_version: number;
}

/** Which half of `GET /api/boards/{board_id}/archived` is being read (Section 4.3). */
export type ArchivedType = 'cards' | 'lists';

/**
 * One page of `GET /api/boards/{board_id}/archived` (Section 4.3), paged newest first with
 * `before=<id>`; `next_before` is `null` once the page was not full, which is how "Load more"
 * stops, exactly as the feed's cursor works.
 */
export interface ArchivedPage<T> {
  items: T[];
  next_before: number | null;
}

/** `?type=cards`: only cards with `is_archived = 1`, never cards inside an archived list. */
export type ArchivedCards = ArchivedPage<CardSummary>;

/** `?type=lists`: the archived columns, which come back with their cards when restored. */
export type ArchivedLists = ArchivedPage<ListOut>;

/**
 * One resolved label chip of a search hit (Section 4.7). The label travels with the row rather
 * than as an id: a hit may belong to a board other than the open one, whose labels are in no
 * client cache, and `SearchPopover` still has to paint the 8px chips.
 */
export interface SearchCardLabel {
  color: LabelColorKey;
  tone: LabelTone;
  name: string;
}

/**
 * One card hit of `GET /api/search` (Section 4.7), ranked by `bm25(cards_fts)`. Deliberately
 * **not** a `CardSummary`: the FTS statement produces exactly these columns plus the labels
 * above — no badges and no cover — and the popover row needs nothing else.
 */
export interface SearchCard {
  id: number;
  short_id: number;
  title: string;
  board_id: number;
  list_id: number;
  board_name: string;
  list_name: string;
  labels: SearchCardLabel[];
}

/** `GET /api/search?q=` — the two groups `SearchPopover` renders, boards first (Section 2.1.1). */
export interface SearchResults {
  boards: BoardSummary[];
  cards: SearchCard[];
}

/**
 * One cursor page of `GET /api/boards/{board_id}/activity` (Sections 4.3 and 4.5), newest first.
 * The card modal reads the same page narrowed by `card_id`, so one shape serves both feeds;
 * `next_before` is the `activities.id` to page before and `null` once the end is reached.
 */
export interface ActivityPage {
  items: Activity[];
  next_before: number | null;
}

/** The seven entities an event can name (Section 4.8); `item` is a checklist item. */
export type EventEntity = 'board' | 'list' | 'card' | 'label' | 'checklist' | 'item' | 'attachment';

/**
 * One SSE frame of `GET /api/boards/{board_id}/events` and one item of `/changes` (Section 4.8).
 *
 * **Events are notifications, not patches.** Nothing here carries a title, a body or a row, so a
 * client can only answer one by refetching what it names — which is why `useBoardEvents` never
 * writes a cache entry from this payload. `id` is `null` only for `card.deleted`, whose activity
 * row carries no `card_id`, and which the client therefore treats as a board-level change.
 * `type` is an activity type of Section 3.8 plus the synthetic `hello` (the current version, sent
 * on connect) and `resync` (more than 500 versions were missed). `card_id`, `list_id` and
 * `position` are absent rather than null when the event has none.
 */
export interface BoardEvent {
  version: number;
  type: string;
  entity: EventEntity;
  id: number | null;
  card_id?: number;
  list_id?: number;
  position?: number;
  at: string;
}

/**
 * `GET /api/boards/{board_id}/changes?since=N` — the polling fallback of Sections 4.3 and 4.8,
 * carrying the same event objects as the stream. `resync` is true exactly when more than 500
 * versions are pending, and `events` is then empty: the client refetches the board instead.
 */
export interface Changes {
  version: number;
  events: BoardEvent[];
  resync: boolean;
}

/** The error envelope every non-2xx response carries (Section 4.1). */
export interface PydanticError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export type ErrorDetails = PydanticError[] | Record<string, unknown> | null;

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ErrorDetails;
    request_id: string | null;
  };
}
