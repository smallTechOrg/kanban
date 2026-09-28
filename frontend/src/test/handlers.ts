import { http, HttpResponse } from 'msw';
import type { CoverInput, LinkAttachmentInput } from '@/api/attachments';
import type { ProfileInput } from '@/api/auth';
import type { CreateBoardInput, UpdateBoardInput } from '@/api/boards';
import type { CopyCardInput, CreateCardInput, MoveCardInput, UpdateCardInput } from '@/api/cards';
import type {
  CreateChecklistInput,
  CreateItemInput,
  MoveItemInput,
  UpdateItemInput,
} from '@/api/checklists';
import type { CreateLabelInput, UpdateLabelInput } from '@/api/labels';
import type { CopyListInput, CreateListInput, MoveInput, UpdateListInput } from '@/api/lists';
import type {
  Activity,
  ArchiveAllCardsResult,
  Attachment,
  Badges,
  Board,
  BoardBackgrounds,
  BoardChecklist,
  BoardGroups,
  BoardSummary,
  CardCover,
  CardDetail,
  CardFeed,
  CardLabels,
  CardMembers,
  CardSummary,
  CardsCreated,
  Changes,
  Checklist,
  ChecklistItem,
  ChecklistItemPatched,
  Comment,
  FeedItem,
  ItemsCreated,
  Label,
  ListOut,
  ListWithCount,
  Member,
  Meta,
  MoveAllCardsResult,
  MoveResult,
  Mutated,
  PositionsResult,
  PublicUser,
  SearchCard,
  SearchResults,
  UnarchiveCardsResult,
  User,
  WatchState,
} from '@/api/types';

/**
 * The default happy path for every endpoint M1 calls. Tests that need a failure or a
 * different shape override one handler with `server.use(...)`.
 *
 * Colours are written as design tokens rather than hexes: the fixtures flow straight into
 * inline styles, and the lint rule of CLAUDE.md section 3 bans hex literals outside
 * styles/tokens.css. No assertion depends on the exact value.
 */

/**
 * A trimmed `GET /api/meta`. Only the `none` palette row is filled in: real palettes come
 * from the server, and tests that need a full one build it from this fixture.
 */
export const metaFixture: Meta = {
  version: '1.0.0',
  label_colors: {
    none: {
      subtle: 'var(--hover)',
      normal: 'var(--hover)',
      bold: 'var(--hover)',
      text: 'var(--text)',
      text_bold: 'var(--text)',
    },
  },
  cover_colors: {},
  board_colors: { blue: 'var(--primary)' },
  avatar_colors: [
    'var(--logo)',
    'var(--success)',
    'var(--danger)',
    'var(--warning)',
    'var(--primary)',
    'var(--progress)',
    'var(--star)',
    'var(--text-muted)',
  ],
  board_gradients: { 'gradient-ocean': 'linear-gradient(135deg, var(--primary), var(--logo))' },
  list_colors: {},
  max_upload_mb: 25,
  signup_enabled: true,
  single_user: false,
  admin_username: 'admin',
};

/** The signed-in user. `/api/auth/*` is the only place `email` comes back (Section 4.2). */
export const userFixture: User = {
  id: 1,
  email: 'vivek@example.com',
  username: 'vivek',
  full_name: 'Vivek Sharma',
  initials: 'VS',
  avatar_color: 'var(--logo)',
  created_at: '2026-09-01T09:12:00.000Z',
};

export const memberFixture: Member = {
  id: 1,
  username: 'vivek',
  full_name: 'Vivek Sharma',
  initials: 'VS',
  avatar_color: 'var(--logo)',
  role: 'admin',
  joined_at: '2026-09-01T09:12:00.000Z',
};

/** `GET /api/users` rows, alphabetical by `full_name` like the server (Section 4.2). */
export const publicUsersFixture: PublicUser[] = [
  {
    id: 2,
    username: 'asha',
    full_name: 'Asha Patel',
    initials: 'AP',
    avatar_color: 'var(--success)',
  },
  {
    id: 1,
    username: 'vivek',
    full_name: 'Vivek Sharma',
    initials: 'VS',
    avatar_color: 'var(--logo)',
  },
];

const BOARD_TEMPLATE: BoardSummary = {
  id: 7,
  name: 'Website relaunch',
  description: '',
  owner_id: 1,
  background_type: 'color',
  background_value: 'var(--primary)',
  background_thumb_url: null,
  visibility: 'private',
  is_closed: false,
  version: 1,
  is_starred: false,
  my_role: 'admin',
  created_at: '2026-09-01T09:12:00.000Z',
  updated_at: '2026-09-24T17:58:41.120Z',
};

/** Builds a `BoardSummary` for a fixture or an override. */
export function makeBoardSummary(overrides: Partial<BoardSummary> = {}): BoardSummary {
  return { ...BOARD_TEMPLATE, ...overrides };
}

export const starredBoardFixture = makeBoardSummary({ id: 5, name: 'Roadmap', is_starred: true });
export const boardFixture = makeBoardSummary();
export const closedBoardFixture = makeBoardSummary({ id: 9, name: 'Trip 2027', is_closed: true });

/** `GET /api/boards`: one starred board, the same board under Recent, three under all. */
export const boardGroupsFixture: BoardGroups = {
  starred: [starredBoardFixture],
  recent: [boardFixture, starredBoardFixture],
  all: [makeBoardSummary({ id: 3, name: 'Personal' }), starredBoardFixture, boardFixture],
};

/** `ordering.STEP`, the spacing the server appends with (Section 4.9). */
const STEP = 65536;

/** The six labels every board is seeded with, trimmed to the two the fixtures need. */
export const labelFixtures: Label[] = [
  { id: 31, board_id: 7, name: '', color: 'green', tone: 'normal', position: STEP },
  { id: 32, board_id: 7, name: 'Bug fix', color: 'red', tone: 'normal', position: 2 * STEP },
];

const LIST_TEMPLATE: ListOut = {
  id: 11,
  board_id: 7,
  name: 'To Do',
  position: STEP,
  color: null,
  is_archived: false,
  created_at: '2026-09-01T09:12:00.000Z',
  updated_at: '2026-09-01T09:12:00.000Z',
};

/** Builds a `ListOut` for a fixture or a handler's answer. */
export function makeListOut(overrides: Partial<ListOut> = {}): ListOut {
  return { ...LIST_TEMPLATE, ...overrides };
}

/** The two columns of the fixture board, in `position` order (Section 4.10.1). */
export const listFixtures: ListOut[] = [
  makeListOut(),
  makeListOut({ id: 12, name: 'Doing', position: 2 * STEP, color: 'blue' }),
];

const CARD_TEMPLATE: CardSummary = {
  id: 101,
  board_id: 7,
  list_id: 11,
  short_id: 12,
  title: 'Write launch announcement',
  position: STEP,
  is_archived: false,
  is_template: false,
  start_at: null,
  due_at: null,
  due_complete: false,
  cover: null,
  label_ids: [],
  member_ids: [],
  is_watching: false,
  badges: {
    description: false,
    comments: 0,
    attachments: 0,
    checklist_done: 0,
    checklist_total: 0,
  },
  created_at: '2026-09-03T11:00:00.000Z',
  updated_at: '2026-09-24T17:58:41.120Z',
};

/** Builds a `CardSummary` for a fixture or a handler's answer. */
export function makeCardSummary(overrides: Partial<CardSummary> = {}): CardSummary {
  return { ...CARD_TEMPLATE, ...overrides };
}

/** Three cards: two in "To Do" and one in "Doing", each in `position` order. */
export const cardFixtures: CardSummary[] = [
  makeCardSummary({ label_ids: [31, 32], member_ids: [1] }),
  makeCardSummary({ id: 102, short_id: 13, title: 'Draft the brief', position: 2 * STEP }),
  makeCardSummary({ id: 103, short_id: 14, title: 'Migrate DNS', list_id: 12 }),
];

const ITEM_TEMPLATE: ChecklistItem = {
  id: 501,
  checklist_id: 51,
  name: 'Wireframe',
  position: STEP,
  is_checked: true,
  checked_at: '2026-09-24T12:00:00.000Z',
  due_at: null,
  assignee_id: null,
};

/** Builds a `ChecklistItem` for a fixture or a handler's answer (Section 4.6). */
export function makeChecklistItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return { ...ITEM_TEMPLATE, ...overrides };
}

/** One checklist on card 101: two items, one of them ticked, so the tile badge reads 1/2. */
export const checklistFixtures: Checklist[] = [
  {
    id: 51,
    card_id: 101,
    name: 'Launch steps',
    position: STEP,
    items: [
      makeChecklistItem(),
      makeChecklistItem({
        id: 502,
        name: 'Palette',
        position: 2 * STEP,
        is_checked: false,
        checked_at: null,
      }),
    ],
  },
];

/** `GET /api/boards/7/checklists` — the "Copy items from…" rows of `ChecklistPopover` (4.6). */
export const boardChecklistsFixture: BoardChecklist[] = checklistFixtures.map((checklist) => ({
  id: checklist.id,
  name: checklist.name,
  card_id: checklist.card_id,
  card_title: cardFixtures[0]?.title ?? '',
  item_count: checklist.items.length,
}));

const ATTACHMENT_TEMPLATE: Attachment = {
  id: 401,
  card_id: 101,
  user_id: userFixture.id,
  name: 'mock-up.png',
  kind: 'upload',
  url: '/uploads/attachments/401/mock-up.png',
  mime_type: 'image/png',
  size_bytes: 24_576,
  is_image: true,
  thumb_url: '/uploads/attachments/401/thumb.jpg',
  dominant_color: 'var(--primary)',
  is_cover: false,
  created_at: '2026-09-24T15:14:00.000Z',
};

/** Builds an `AttachmentOut` for a fixture or a handler's answer (Section 4.6). */
export function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return { ...ATTACHMENT_TEMPLATE, ...overrides };
}

/**
 * One of each kind on card 101: an image, which is the only kind a cover can use, and a link.
 * `makeCardDetail` answers with no attachments unless a test asks for these, so a card is
 * attachment-free by default exactly as a new card is.
 */
export const attachmentFixtures: Attachment[] = [
  makeAttachment(),
  makeAttachment({
    id: 402,
    name: 'Launch spec',
    kind: 'link',
    url: 'https://example.com/spec',
    mime_type: null,
    size_bytes: null,
    is_image: false,
    thumb_url: null,
    dominant_color: null,
  }),
];

/** The comment author, as everyone but `/api/auth/*` sees them (Section 4.2). */
export const publicUserFixture: PublicUser = {
  id: userFixture.id,
  username: userFixture.username,
  full_name: userFixture.full_name,
  initials: userFixture.initials,
  avatar_color: userFixture.avatar_color,
};

export const commentFixture: Comment = {
  id: 801,
  card_id: 101,
  user: publicUserFixture,
  body: 'Looks good, shipping it.',
  created_at: '2026-09-24T17:00:00.000Z',
  edited_at: null,
};

export const activityFixture: Activity = {
  id: 9001,
  board_id: 7,
  card_id: 101,
  list_id: 11,
  user: publicUserFixture,
  type: 'card.created',
  data: { card_title: cardFixtures[0]?.title ?? '', list_name: 'To Do' },
  board_version: 1,
  created_at: '2026-09-03T11:00:00.000Z',
};

/** `GET /api/cards/101/feed` — newest first: one comment row and one activity row (Section 4.5). */
export const feedFixture: FeedItem[] = [
  { kind: 'comment', comment: commentFixture },
  { kind: 'activity', activity: activityFixture },
];

/**
 * `GET /api/boards/7/activity` — the drawer's feed (Section 4.3): the same rows as the card feed's
 * activity half plus one board-level row, newest first. One short page, so `next_before` is null
 * and the infinite scroll stops after it.
 */
export const boardActivityFixture: Activity[] = [
  {
    ...activityFixture,
    id: 9002,
    card_id: null,
    list_id: null,
    type: 'board.renamed',
    data: { to: boardFixture.name, from: 'Website' },
    board_version: 2,
    created_at: '2026-09-24T17:58:41.120Z',
  },
  activityFixture,
];

/** One `GET /api/search` card hit (Section 4.7): the seven columns plus resolved label chips. */
export const searchCardFixture: SearchCard = {
  id: 101,
  short_id: 12,
  title: CARD_TEMPLATE.title,
  board_id: boardFixture.id,
  list_id: 11,
  board_name: boardFixture.name,
  list_name: 'To Do',
  labels: [{ color: 'red', tone: 'normal', name: 'Bug fix' }],
};

/** `GET /api/search?q=` — one board and one card, which the handler filters by the typed text. */
export const searchResultsFixture: SearchResults = {
  boards: [boardFixture],
  cards: [searchCardFixture],
};

/** `GET /api/cards/{card_id}` — the document the card modal renders (Section 4.5). */
export function makeCardDetail(overrides: Partial<CardDetail> = {}): CardDetail {
  const card = cardById(overrides.id ?? 101);
  return {
    ...card,
    description: '',
    due_reminder_minutes: null,
    board_name: boardFixture.name,
    list_name: 'To Do',
    checklists: card.id === 101 ? checklistFixtures : [],
    attachments: [],
    ...overrides,
  };
}

/** `GET /api/boards/7` — the single round-trip board document (Section 4.10.1). */
export const boardPayloadFixture: Board = {
  board: boardFixture,
  members: [memberFixture],
  labels: labelFixtures,
  lists: listFixtures,
  cards: cardFixtures,
};

/** `GET /api/boards/7/lists` — the same columns with their active card counts (Section 4.4). */
export const listsWithCountFixture: ListWithCount[] = listFixtures.map((list) => ({
  ...list,
  card_count: cardFixtures.filter((card) => card.list_id === list.id).length,
}));

/** The board version every M2 write in these handlers reports (`boards.version + 1`). */
const NEXT_VERSION = boardFixture.version + 1;

/**
 * `GET /api/boards/7/changes?since=` — the polling fallback's page (Section 4.8): one card event a
 * version ahead of the fixture board, which is what passes the version gate of `useBoardEvents`.
 */
export const changesFixture: Changes = {
  version: NEXT_VERSION,
  events: [
    {
      version: NEXT_VERSION,
      type: 'card.renamed',
      entity: 'card',
      id: 101,
      card_id: 101,
      list_id: 11,
      actor_id: userFixture.id,
      at: '2026-09-25T09:00:00.000Z',
    },
  ],
  resync: false,
};

function listById(listId: number): ListOut {
  return listFixtures.find((list) => list.id === listId) ?? makeListOut({ id: listId });
}

function cardById(cardId: number): CardSummary {
  return cardFixtures.find((card) => card.id === cardId) ?? makeCardSummary({ id: cardId });
}

function labelById(labelId: number): Label {
  return (
    labelFixtures.find((label) => label.id === labelId) ?? {
      id: labelId,
      board_id: 7,
      name: '',
      color: 'green',
      tone: 'normal',
      position: STEP,
    }
  );
}

function checklistById(checklistId: number): Checklist {
  return (
    checklistFixtures.find((checklist) => checklist.id === checklistId) ?? {
      id: checklistId,
      card_id: 101,
      name: 'Checklist',
      position: STEP,
      items: [],
    }
  );
}

function itemById(itemId: number): ChecklistItem {
  for (const checklist of checklistFixtures) {
    const item = checklist.items.find((row) => row.id === itemId);
    if (item !== undefined) return item;
  }
  return makeChecklistItem({ id: itemId });
}

function attachmentById(attachmentId: number): Attachment {
  return (
    attachmentFixtures.find((row) => row.id === attachmentId) ??
    makeAttachment({ id: attachmentId })
  );
}

/**
 * The card's recomputed `badges` the item patch answers with (Section 4.6), so a test can assert
 * that the tile's `done/total` came from the response rather than from a second client-side count.
 */
function badgesAfter(item: ChecklistItem): Badges {
  const items = checklistFixtures.flatMap((checklist) =>
    checklist.items.map((row) => (row.id === item.id ? item : row)),
  );
  return {
    ...cardById(101).badges,
    checklist_done: items.filter((row) => row.is_checked).length,
    checklist_total: items.length,
  };
}

export const backgroundsFixture: BoardBackgrounds = {
  colors: [{ key: 'blue', hex: 'var(--primary)' }],
  gradients: [
    { key: 'gradient-ocean', css: 'linear-gradient(135deg, var(--primary), var(--logo))' },
  ],
  custom: [],
};

/** The `Mutated<T>` envelope of Section 4.1; for a board row `board_version` is its version. */
function mutated<T>(item: T, boardVersion: number): Mutated<T> {
  return { item, board_version: boardVersion };
}

const NO_CONTENT = { status: 204 } as const;

/**
 * The uploaded file behind a multipart request, as far as this environment can see it.
 *
 * `POST /api/cards/{card_id}/attachments` has the two branches of Section 4.6 and the server
 * tells them apart by the content-type. Only the JSON branch can be recognised that way here:
 * jsdom's `FormData` is not the `FormData` the `Request` implementation under vitest knows, so a
 * multipart body — sent by `fetch` or by the `XMLHttpRequest` of Section 5.8 alike — reaches the
 * handler flattened to the string "[object FormData]" with a `text/plain` content-type, and
 * `request.formData()` throws. The branch is therefore "not JSON is an upload", and the file's
 * own name and size are read when they survive (a real browser, so every Playwright run) and
 * fall back to the fixture's when they do not. No mocked upload asserts on the name.
 */
async function uploadedFile(request: Request): Promise<File | null> {
  try {
    const field = (await request.clone().formData()).get('file');
    return field instanceof File ? field : null;
  } catch {
    return null;
  }
}

export const handlers = [
  http.get('/api/meta', () => HttpResponse.json(metaFixture)),

  http.post('/api/auth/register', () => HttpResponse.json(userFixture, { status: 201 })),
  http.post('/api/auth/login', () =>
    HttpResponse.json({ user: userFixture, token: 'kb_test_raw_token' }),
  ),
  http.post('/api/auth/logout', () => new HttpResponse(null, NO_CONTENT)),
  http.get('/api/auth/me', () => HttpResponse.json(userFixture)),
  http.patch('/api/auth/me', async ({ request }) => {
    const patch = (await request.json()) as ProfileInput;
    return HttpResponse.json({
      ...userFixture,
      full_name: patch.full_name ?? userFixture.full_name,
      avatar_color: patch.avatar_color ?? userFixture.avatar_color,
    });
  }),
  http.post('/api/auth/dev-login', () => HttpResponse.json(userFixture)),

  http.get('/api/users', () => HttpResponse.json({ items: publicUsersFixture })),

  http.get('/api/boards', ({ request }) => {
    const closed = new URL(request.url).searchParams.get('closed');
    return closed === '1'
      ? HttpResponse.json({ closed: [closedBoardFixture] })
      : HttpResponse.json(boardGroupsFixture);
  }),
  http.post('/api/boards', async ({ request }) => {
    const input = (await request.json()) as CreateBoardInput;
    return HttpResponse.json(
      makeBoardSummary({
        id: 42,
        name: input.name,
        background_type: input.background_type ?? 'color',
        background_value: input.background_value ?? 'var(--primary)',
        visibility: input.visibility ?? 'private',
      }),
      { status: 201 },
    );
  }),
  http.get('/api/boards/:boardId', ({ params }) =>
    HttpResponse.json({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: Number(params['boardId']) }),
    }),
  ),
  http.patch('/api/boards/:boardId', async ({ params, request }) => {
    const patch = (await request.json()) as UpdateBoardInput;
    const item = makeBoardSummary({ ...patch, id: Number(params['boardId']), version: 2 });
    return HttpResponse.json(mutated(item, item.version));
  }),
  http.post('/api/boards/:boardId/close', ({ params }) => {
    const item = makeBoardSummary({ id: Number(params['boardId']), is_closed: true, version: 2 });
    return HttpResponse.json(mutated(item, item.version));
  }),
  http.post('/api/boards/:boardId/reopen', ({ params }) => {
    const item = makeBoardSummary({ id: Number(params['boardId']), is_closed: false, version: 3 });
    return HttpResponse.json(mutated(item, item.version));
  }),
  http.delete('/api/boards/:boardId', () => new HttpResponse(null, NO_CONTENT)),

  http.put('/api/boards/:boardId/star', () => HttpResponse.json({ is_starred: true })),
  http.delete('/api/boards/:boardId/star', () => HttpResponse.json({ is_starred: false })),

  http.get('/api/boards/:boardId/members', () => HttpResponse.json({ items: [memberFixture] })),
  http.put('/api/boards/:boardId/members/:userId', async ({ params, request }) => {
    const { role } = (await request.json()) as { role?: Member['role'] };
    return HttpResponse.json(
      mutated({ ...memberFixture, id: Number(params['userId']), role: role ?? 'member' }, 2),
    );
  }),
  http.delete('/api/boards/:boardId/members/:userId', () => new HttpResponse(null, NO_CONTENT)),

  http.get('/api/boards/:boardId/backgrounds', () => HttpResponse.json(backgroundsFixture)),

  // ------------------------------------------------------------------ lists (Section 4.4)

  http.get('/api/boards/:boardId/lists', () => HttpResponse.json({ items: listsWithCountFixture })),
  http.post('/api/boards/:boardId/lists', async ({ params, request }) => {
    const input = (await request.json()) as CreateListInput;
    const item = makeListOut({
      id: 20,
      board_id: Number(params['boardId']),
      name: input.name,
      position: 3 * STEP,
    });
    return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
  }),
  http.patch('/api/lists/:listId', async ({ params, request }) => {
    const patch = (await request.json()) as UpdateListInput;
    const list = listById(Number(params['listId']));
    const item = makeListOut({
      ...list,
      name: patch.name ?? list.name,
      color: patch.color === undefined ? list.color : patch.color,
    });
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.post('/api/lists/:listId/move', async ({ params, request }) => {
    const body = (await request.json()) as MoveInput;
    const item = makeListOut({
      ...listById(Number(params['listId'])),
      position: (body.index + 1) * STEP,
    });
    const result: MoveResult<ListOut> = { item, positions: {}, board_version: NEXT_VERSION };
    return HttpResponse.json(result);
  }),
  http.post('/api/lists/:listId/copy', async ({ params, request }) => {
    const input = (await request.json()) as CopyListInput;
    const item = makeListOut({
      ...listById(Number(params['listId'])),
      id: 21,
      name: input.name,
      position: 4 * STEP,
    });
    return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
  }),
  http.post('/api/lists/:listId/archive', ({ params }) => {
    const item = makeListOut({ ...listById(Number(params['listId'])), is_archived: true });
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.post('/api/lists/:listId/unarchive', ({ params }) => {
    const item = makeListOut({ ...listById(Number(params['listId'])), is_archived: false });
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.delete('/api/lists/:listId', () => new HttpResponse(null, NO_CONTENT)),
  http.post('/api/lists/:listId/move-all-cards', ({ params }) => {
    const moved = cardFixtures.filter((card) => card.list_id === Number(params['listId']));
    const positions: Record<string, number> = {};
    moved.forEach((card, at) => {
      positions[String(card.id)] = (at + 1) * STEP;
    });
    const result: MoveAllCardsResult = {
      moved: moved.length,
      positions,
      board_version: NEXT_VERSION,
    };
    return HttpResponse.json(result);
  }),
  http.post('/api/lists/:listId/archive-all-cards', ({ params }) => {
    const archived = cardFixtures.filter((card) => card.list_id === Number(params['listId']));
    const result: ArchiveAllCardsResult = {
      archived: archived.length,
      archived_ids: archived.map((card) => card.id),
      board_version: NEXT_VERSION,
    };
    return HttpResponse.json(result);
  }),
  http.post('/api/lists/:listId/unarchive-cards', async ({ request }) => {
    const { card_ids } = (await request.json()) as { card_ids: number[] };
    const result: UnarchiveCardsResult = {
      restored: card_ids.length,
      board_version: NEXT_VERSION,
    };
    return HttpResponse.json(result);
  }),
  http.post('/api/lists/:listId/sort', ({ params }) => {
    const sorted = cardFixtures.filter((card) => card.list_id === Number(params['listId']));
    const positions: Record<string, number> = {};
    sorted.forEach((card, at) => {
      positions[String(card.id)] = (at + 1) * STEP;
    });
    const result: PositionsResult = { positions, board_version: NEXT_VERSION };
    return HttpResponse.json(result);
  }),

  // ------------------------------------------------------------ cards (Sections 4.4 and 4.5)

  http.post('/api/lists/:listId/cards', async ({ params, request }) => {
    const input = (await request.json()) as CreateCardInput;
    const listId = Number(params['listId']);
    if (input.split_lines === true) {
      const lines = input.title.split('\n').filter((line) => line.trim() !== '');
      const created: CardsCreated = {
        items: lines.map((line, at) =>
          makeCardSummary({
            id: 900 + at,
            short_id: 20 + at,
            list_id: listId,
            title: line.trim(),
            position: (at + 3) * STEP,
          }),
        ),
        board_version: NEXT_VERSION,
      };
      return HttpResponse.json(created);
    }
    const item = makeCardSummary({
      id: 900,
      short_id: 20,
      client_id: input.client_id,
      list_id: listId,
      title: input.title,
      position: 3 * STEP,
      label_ids: input.label_ids ?? [],
      member_ids: input.member_ids ?? [],
    });
    return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
  }),
  http.get('/api/cards/:cardId', ({ params }) =>
    HttpResponse.json(makeCardDetail({ id: Number(params['cardId']) })),
  ),
  http.patch('/api/cards/:cardId', async ({ params, request }) => {
    const patch = (await request.json()) as UpdateCardInput;
    const card = cardById(Number(params['cardId']));
    const item = makeCardSummary({
      ...card,
      title: patch.title ?? card.title,
      start_at: patch.start_at === undefined ? card.start_at : patch.start_at,
      due_at: patch.due_at === undefined ? card.due_at : patch.due_at,
      due_complete: patch.due_complete ?? card.due_complete,
      is_template: patch.is_template ?? card.is_template,
      badges:
        patch.description === undefined
          ? card.badges
          : { ...card.badges, description: patch.description !== '' },
    });
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.post('/api/cards/:cardId/move', async ({ params, request }) => {
    const body = (await request.json()) as MoveCardInput;
    const card = cardById(Number(params['cardId']));
    // A cross-board move re-homes the card and answers with the target board's version, and the
    // server assigns it a fresh `short_id` and drops its labels (Section 4.5).
    const crossBoard = body.to_board_id !== undefined && body.to_board_id !== card.board_id;
    const item = makeCardSummary({
      ...card,
      board_id: body.to_board_id ?? card.board_id,
      list_id: body.to_list_id,
      position: (body.index + 1) * STEP,
      short_id: crossBoard ? 1 : card.short_id,
      label_ids: crossBoard ? [] : card.label_ids,
    });
    const result: MoveResult<CardSummary> = { item, positions: {}, board_version: NEXT_VERSION };
    return HttpResponse.json(result);
  }),
  http.post('/api/cards/:cardId/copy', async ({ params, request }) => {
    const input = (await request.json()) as CopyCardInput;
    const card = cardById(Number(params['cardId']));
    const item = makeCardSummary({
      ...card,
      id: 920,
      short_id: 31,
      title: input.title,
      list_id: input.to_list_id,
      position: (input.index + 1) * STEP,
      is_template: input.is_template ?? false,
      label_ids: input.keep.labels === true ? card.label_ids : [],
      member_ids: input.keep.members === true ? card.member_ids : [],
    });
    return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
  }),
  http.post('/api/cards/:cardId/archive', ({ params }) => {
    const item = makeCardSummary({ ...cardById(Number(params['cardId'])), is_archived: true });
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.post('/api/cards/:cardId/unarchive', ({ params }) => {
    const item = makeCardSummary({ ...cardById(Number(params['cardId'])), is_archived: false });
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.delete('/api/cards/:cardId', () => new HttpResponse(null, NO_CONTENT)),

  // ----------------------------------------------------- labels (Sections 4.3 and 4.5)

  http.get('/api/boards/:boardId/labels', () => HttpResponse.json({ items: labelFixtures })),
  http.post('/api/boards/:boardId/labels', async ({ params, request }) => {
    const input = (await request.json()) as CreateLabelInput;
    const item: Label = {
      id: 33,
      board_id: Number(params['boardId']),
      name: input.name ?? '',
      color: input.color,
      tone: input.tone ?? 'normal',
      position: 3 * STEP,
    };
    return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
  }),
  http.patch('/api/labels/:labelId', async ({ params, request }) => {
    const patch = (await request.json()) as UpdateLabelInput;
    return HttpResponse.json(
      mutated({ ...labelById(Number(params['labelId'])), ...patch }, NEXT_VERSION),
    );
  }),
  http.delete('/api/labels/:labelId', () => new HttpResponse(null, NO_CONTENT)),
  http.put('/api/cards/:cardId/labels/:labelId', ({ params }) => {
    const card = cardById(Number(params['cardId']));
    const labelId = Number(params['labelId']);
    const result: CardLabels = {
      label_ids: card.label_ids.includes(labelId) ? card.label_ids : [...card.label_ids, labelId],
      board_version: NEXT_VERSION,
    };
    return HttpResponse.json(result);
  }),
  http.delete('/api/cards/:cardId/labels/:labelId', ({ params }) => {
    const card = cardById(Number(params['cardId']));
    const labelId = Number(params['labelId']);
    const result: CardLabels = {
      label_ids: card.label_ids.filter((id) => id !== labelId),
      board_version: NEXT_VERSION,
    };
    return HttpResponse.json(result);
  }),

  // ------------------------------ card members, watching and covers (Section 4.5)

  http.put('/api/cards/:cardId/members/:userId', ({ params }) => {
    const card = cardById(Number(params['cardId']));
    const userId = Number(params['userId']);
    const result: CardMembers = {
      member_ids: card.member_ids.includes(userId) ? card.member_ids : [...card.member_ids, userId],
      board_version: NEXT_VERSION,
    };
    return HttpResponse.json(result);
  }),
  http.delete('/api/cards/:cardId/members/:userId', ({ params }) => {
    const card = cardById(Number(params['cardId']));
    const userId = Number(params['userId']);
    const result: CardMembers = {
      member_ids: card.member_ids.filter((id) => id !== userId),
      board_version: NEXT_VERSION,
    };
    return HttpResponse.json(result);
  }),
  // Watching is per-user state: the answer carries no `board_version` at all (Section 4.5).
  http.put('/api/cards/:cardId/watch', () => {
    const state: WatchState = { is_watching: true };
    return HttpResponse.json(state);
  }),
  http.delete('/api/cards/:cardId/watch', () => {
    const state: WatchState = { is_watching: false };
    return HttpResponse.json(state);
  }),
  http.put('/api/cards/:cardId/cover', async ({ params, request }) => {
    const input = (await request.json()) as CoverInput;
    const attachment = attachmentFixtures.find((row) => String(row.id) === input.value);
    // Only an attachment cover carries the thumbnail and its dominant colour (Section 4.5).
    const cover: CardCover = {
      kind: input.kind,
      value: input.value,
      size: input.size ?? 'normal',
      ...(input.kind === 'attachment' && attachment?.thumb_url != null
        ? { image_url: attachment.thumb_url }
        : {}),
      ...(input.kind === 'attachment' && attachment?.dominant_color != null
        ? { dominant_color: attachment.dominant_color }
        : {}),
    };
    const item = makeCardSummary({ ...cardById(Number(params['cardId'])), cover });
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.delete('/api/cards/:cardId/cover', ({ params }) => {
    const item = makeCardSummary({ ...cardById(Number(params['cardId'])), cover: null });
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),

  // ------------------------------------------------ checklists and items (Section 4.6)

  http.get('/api/boards/:boardId/checklists', () =>
    HttpResponse.json({ items: boardChecklistsFixture }),
  ),
  http.post('/api/cards/:cardId/checklists', async ({ params, request }) => {
    const input = (await request.json()) as CreateChecklistInput;
    const source =
      input.copy_from_checklist_id === undefined
        ? undefined
        : checklistById(input.copy_from_checklist_id);
    const item: Checklist = {
      id: 60,
      card_id: Number(params['cardId']),
      name: input.name ?? 'Checklist',
      position: 2 * STEP,
      // The source's items are copied unchecked (Section 4.6).
      items: (source?.items ?? []).map((row, at) =>
        makeChecklistItem({
          ...row,
          id: 600 + at,
          checklist_id: 60,
          is_checked: false,
          checked_at: null,
        }),
      ),
    };
    return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
  }),
  http.patch('/api/checklists/:checklistId', async ({ params, request }) => {
    const patch = (await request.json()) as { name: string };
    const item = { ...checklistById(Number(params['checklistId'])), name: patch.name };
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.delete('/api/checklists/:checklistId', () => new HttpResponse(null, NO_CONTENT)),
  http.post('/api/checklists/:checklistId/move', async ({ params, request }) => {
    const body = (await request.json()) as MoveInput;
    const item: Checklist = {
      ...checklistById(Number(params['checklistId'])),
      position: (body.index + 1) * STEP,
    };
    const result: MoveResult<Checklist> = { item, positions: {}, board_version: NEXT_VERSION };
    return HttpResponse.json(result);
  }),
  http.post('/api/checklists/:checklistId/items', async ({ params, request }) => {
    const input = (await request.json()) as CreateItemInput & { split_lines?: boolean };
    const checklistId = Number(params['checklistId']);
    if (input.split_lines === true) {
      const lines = input.name.split('\n').filter((line) => line.trim() !== '');
      const created: ItemsCreated = {
        items: lines.map((line, at) =>
          makeChecklistItem({
            id: 700 + at,
            checklist_id: checklistId,
            name: line.trim(),
            position: (at + 3) * STEP,
            is_checked: false,
            checked_at: null,
          }),
        ),
        board_version: NEXT_VERSION,
      };
      return HttpResponse.json(created, { status: 201 });
    }
    const item = makeChecklistItem({
      id: 700,
      checklist_id: checklistId,
      name: input.name,
      position: 3 * STEP,
      is_checked: false,
      checked_at: null,
    });
    return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
  }),
  http.patch('/api/checklist-items/:itemId', async ({ params, request }) => {
    const patch = (await request.json()) as UpdateItemInput;
    const current = itemById(Number(params['itemId']));
    const row = makeChecklistItem({
      ...current,
      name: patch.name ?? current.name,
      is_checked: patch.is_checked ?? current.is_checked,
      due_at: patch.due_at === undefined ? current.due_at : patch.due_at,
      assignee_id: patch.assignee_id === undefined ? current.assignee_id : patch.assignee_id,
    });
    const item: ChecklistItemPatched = { ...row, badges: badgesAfter(row) };
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.delete('/api/checklist-items/:itemId', () => new HttpResponse(null, NO_CONTENT)),
  http.post('/api/checklist-items/:itemId/move', async ({ params, request }) => {
    const body = (await request.json()) as MoveItemInput;
    const item = makeChecklistItem({
      ...itemById(Number(params['itemId'])),
      checklist_id: body.to_checklist_id,
      position: (body.index + 1) * STEP,
    });
    const result: MoveResult<ChecklistItem> = { item, positions: {}, board_version: NEXT_VERSION };
    return HttpResponse.json(result);
  }),
  http.post('/api/checklist-items/:itemId/convert', ({ params }) => {
    const item = itemById(Number(params['itemId']));
    const card = makeCardSummary({ id: 910, short_id: 30, title: item.name, position: 4 * STEP });
    return HttpResponse.json(mutated(card, NEXT_VERSION), { status: 201 });
  }),

  // ------------------------------------- comments and the card feed (Sections 4.5, 4.6)

  http.post('/api/cards/:cardId/comments', async ({ params, request }) => {
    const { body } = (await request.json()) as { body: string };
    const item: Comment = {
      ...commentFixture,
      id: 802,
      card_id: Number(params['cardId']),
      body,
    };
    return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
  }),
  http.patch('/api/comments/:commentId', async ({ params, request }) => {
    const { body } = (await request.json()) as { body: string };
    const item: Comment = {
      ...commentFixture,
      id: Number(params['commentId']),
      body,
      edited_at: '2026-09-25T09:05:00.000Z',
    };
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.delete('/api/comments/:commentId', () => new HttpResponse(null, NO_CONTENT)),
  http.get('/api/cards/:cardId/feed', ({ request }) => {
    const details = new URL(request.url).searchParams.get('details');
    // `details=0` is "Hide details": comments only (Section 4.5).
    const items =
      details === '0' ? feedFixture.filter((row) => row.kind === 'comment') : feedFixture;
    // One short page, so `next_before` is null and "Load more" knows to stop.
    const page: CardFeed = { items, next_before: null };
    return HttpResponse.json(page);
  }),
  // ----------------------------------------------------------- attachments (Section 4.6)

  http.post('/api/cards/:cardId/attachments', async ({ params, request }) => {
    const cardId = Number(params['cardId']);
    if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
      const file = await uploadedFile(request);
      const name = file?.name ?? ATTACHMENT_TEMPLATE.name;
      const mimeType =
        file === null || file.type === '' ? ATTACHMENT_TEMPLATE.mime_type : file.type;
      const isImage = mimeType !== null && mimeType.startsWith('image/');
      const item = makeAttachment({
        id: 410,
        card_id: cardId,
        name,
        kind: 'upload',
        url: `/uploads/attachments/410/${name}`,
        mime_type: mimeType,
        size_bytes: file?.size ?? ATTACHMENT_TEMPLATE.size_bytes,
        is_image: isImage,
        thumb_url: isImage ? '/uploads/attachments/410/thumb.jpg' : null,
        dominant_color: isImage ? 'var(--primary)' : null,
      });
      return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
    }
    const input = (await request.json()) as LinkAttachmentInput;
    const item = makeAttachment({
      id: 411,
      card_id: cardId,
      name: input.name === undefined || input.name === '' ? new URL(input.url).host : input.name,
      kind: 'link',
      url: input.url,
      mime_type: null,
      size_bytes: null,
      is_image: false,
      thumb_url: null,
      dominant_color: null,
    });
    return HttpResponse.json(mutated(item, NEXT_VERSION), { status: 201 });
  }),
  http.patch('/api/attachments/:attachmentId', async ({ params, request }) => {
    const { name } = (await request.json()) as { name: string };
    const item = makeAttachment({ ...attachmentById(Number(params['attachmentId'])), name });
    return HttpResponse.json(mutated(item, NEXT_VERSION));
  }),
  http.delete('/api/attachments/:attachmentId', () => new HttpResponse(null, NO_CONTENT)),

  // ------------------------------------------- search, board activity and realtime (4.3, 4.7, 4.8)

  /**
   * The two groups, filtered by the typed text the way the server's LIKE and FTS statements are,
   * so a query that matches nothing answers with empty groups and the "We couldn't find anything"
   * state of Section 2.10 is reachable without overriding this handler.
   */
  http.get('/api/search', ({ request }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
    if (q === '') return HttpResponse.json({ boards: [], cards: [] } satisfies SearchResults);
    const results: SearchResults = {
      boards: searchResultsFixture.boards.filter((board) => board.name.toLowerCase().includes(q)),
      cards: searchResultsFixture.cards.filter((card) => card.title.toLowerCase().includes(q)),
    };
    return HttpResponse.json(results);
  }),

  // One short page: `next_before` is null, so "Load more" stops after it.
  http.get('/api/boards/:boardId/activity', ({ request }) => {
    const before = new URL(request.url).searchParams.get('before');
    const items = before === null ? boardActivityFixture : [];
    return HttpResponse.json({ items, next_before: null });
  }),

  http.get('/api/boards/:boardId/changes', ({ request }) => {
    const since = Number(new URL(request.url).searchParams.get('since'));
    // Nothing new for a caller that is already at the fixture's version (the version gate's
    // left-hand side), one card event for anybody behind it.
    const changes: Changes =
      since >= changesFixture.version ? { ...changesFixture, events: [] } : changesFixture;
    return HttpResponse.json(changes);
  }),
];
