import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { UpdateBoardInput } from '@/api/boards';
import type { BoardBackgrounds } from '@/api/types';
import { backgroundsFixture, boardPayloadFixture, makeBoardSummary } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { BoardBackgroundPicker } from './BoardBackgroundPicker';

const BOARD_ID = 7;

/** The one colour and one gradient `backgroundsFixture` carries, as the picker reads them. */
const BLUE = backgroundsFixture.colors[0] ?? { key: 'blue', hex: 'var(--primary)' };
const OCEAN = backgroundsFixture.gradients[0] ?? { key: 'gradient-ocean', css: 'none' };

/** A board colour that is not one of the swatches, so a preview is visibly a preview. */
const OWN_COLOR = 'var(--danger)';

/**
 * The picker previews on the `<main>` that paints the board background, exactly as `BoardPage`
 * does, so the test renders the one the real tree gives it.
 */
function renderPicker(): void {
  renderWithProviders(
    <main style={{ backgroundColor: 'var(--surface)' }}>
      <BoardBackgroundPicker boardId={BOARD_ID} />
    </main>,
    `/b/${BOARD_ID}`,
  );
}

function surface(): HTMLElement {
  const element = document.querySelector('main');
  if (element === null) throw new Error('no board surface');
  return element;
}

/** Answers the board with a background other than the fixture's. */
function serveBoard(overrides: Parameters<typeof makeBoardSummary>[0]): void {
  server.use(
    http.get('/api/boards/:boardId', () =>
      HttpResponse.json({
        ...boardPayloadFixture,
        board: makeBoardSummary({ id: BOARD_ID, ...overrides }),
      }),
    ),
  );
}

function serveLibrary(library: BoardBackgrounds): void {
  server.use(http.get('/api/boards/:boardId/backgrounds', () => HttpResponse.json(library)));
}

/** Captures the body of the next `PATCH /api/boards/{id}` the picker sends. */
function capturePatch(): { body: UpdateBoardInput | null } {
  const captured: { body: UpdateBoardInput | null } = { body: null };
  server.use(
    http.patch('/api/boards/:boardId', async ({ request }) => {
      const patch = (await request.json()) as UpdateBoardInput;
      captured.body = patch;
      const item = makeBoardSummary({ ...patch, id: BOARD_ID, version: 2 });
      return HttpResponse.json({ item, board_version: item.version });
    }),
  );
  return captured;
}

describe('BoardBackgroundPicker', () => {
  it('sends the colour as a background patch when a swatch is chosen', async () => {
    const user = userEvent.setup();
    const captured = capturePatch();
    renderPicker();

    await user.click(await screen.findByRole('button', { name: 'Blue background' }));

    await waitFor(() =>
      expect(captured.body).toEqual({ background_type: 'color', background_value: BLUE.hex }),
    );
  });

  it('sends the gradient key, not its CSS, when a gradient is chosen', async () => {
    const user = userEvent.setup();
    const captured = capturePatch();
    renderPicker();

    await user.click(await screen.findByRole('button', { name: 'Ocean gradient background' }));

    await waitFor(() =>
      expect(captured.body).toEqual({
        background_type: 'gradient',
        background_value: OCEAN.key,
      }),
    );
  });

  it('previews a swatch on hover and puts the board back on leave', async () => {
    const user = userEvent.setup();
    serveBoard({ background_type: 'color', background_value: OWN_COLOR });
    renderPicker();
    const swatch = await screen.findByRole('button', { name: 'Blue background' });

    await user.hover(swatch);
    expect(surface().style.backgroundColor).toBe(BLUE.hex);

    await user.unhover(swatch);
    expect(surface().style.backgroundColor).toBe(OWN_COLOR);
    expect(surface().style.backgroundImage).toBe('');
  });

  it('previews a gradient as an image, and leaves no colour behind it', async () => {
    const user = userEvent.setup();
    serveBoard({ background_type: 'color', background_value: OWN_COLOR });
    renderPicker();

    await user.hover(await screen.findByRole('button', { name: 'Ocean gradient background' }));

    expect(surface().style.backgroundImage).toBe(OCEAN.css);
    expect(surface().style.backgroundColor).toBe('');
  });

  it('previews on focus too, so the keyboard sees what the pointer does', async () => {
    serveBoard({ background_type: 'color', background_value: OWN_COLOR });
    renderPicker();
    const swatch = await screen.findByRole('button', { name: 'Blue background' });

    swatch.focus();
    expect(surface().style.backgroundColor).toBe(BLUE.hex);

    swatch.blur();
    expect(surface().style.backgroundColor).toBe(OWN_COLOR);
  });

  it('marks the board’s current background as pressed', async () => {
    serveBoard({ background_type: 'color', background_value: BLUE.hex });
    renderPicker();

    const swatch = await screen.findByRole('button', { name: 'Blue background' });

    expect(swatch).toHaveAttribute('aria-pressed', 'true');
  });

  it('lists the caller’s library on the Custom tab and re-selects an image by id', async () => {
    const user = userEvent.setup();
    serveLibrary({
      ...backgroundsFixture,
      custom: [
        { id: 4, url: '/uploads/backgrounds/4.png', thumb_url: '/uploads/backgrounds/4.thumb.jpg' },
      ],
    });
    const captured = capturePatch();
    renderPicker();

    await user.click(await screen.findByRole('tab', { name: 'Custom' }));
    await user.click(await screen.findByRole('button', { name: 'Custom background 1' }));

    await waitFor(() => expect(captured.body).toEqual({ background_image_id: 4 }));
  });

  it('sends a chosen file to the upload endpoint and lists it once it lands', async () => {
    const user = userEvent.setup();
    const library: BoardBackgrounds = { ...backgroundsFixture, custom: [] };
    let uploads = 0;
    server.use(
      http.get('/api/boards/:boardId/backgrounds', () => HttpResponse.json(library)),
      http.post('/api/boards/:boardId/background', () => {
        uploads += 1;
        library.custom = [
          {
            id: 9,
            url: '/uploads/backgrounds/9.png',
            thumb_url: '/uploads/backgrounds/9.thumb.jpg',
          },
        ];
        const item = makeBoardSummary({
          id: BOARD_ID,
          version: 3,
          background_type: 'image',
          background_value: '/uploads/backgrounds/9.png',
          background_thumb_url: '/uploads/backgrounds/9.thumb.jpg',
        });
        return HttpResponse.json({ item, board_version: item.version });
      }),
    );
    renderPicker();

    await user.click(await screen.findByRole('tab', { name: 'Custom' }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    await user.upload(input, new File(['bytes'], 'beach.png', { type: 'image/png' }));

    expect(uploads).toBe(1);
    // The response is authoritative, so the library it joined is refetched, not guessed at.
    expect(await screen.findByRole('button', { name: 'Custom background 1' })).toBeInTheDocument();
  });
});
