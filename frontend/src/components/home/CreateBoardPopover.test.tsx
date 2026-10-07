import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CreateBoardInput } from '@/api/boards';
import { makeBoardSummary, metaFixture } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { CreateBoardPopover } from './CreateBoardPopover';

const GRADIENT_KEY = 'gradient-ocean';
const COLOR_HEX = 'rgb(0, 121, 191)';

/** A palette with two colours and one gradient: enough to prove the swatches drive state. */
function useFullPalette(): void {
  server.use(
    http.get('/api/meta', () =>
      HttpResponse.json({
        ...metaFixture,
        board_colors: { blue: COLOR_HEX, green: 'rgb(81, 152, 57)' },
        board_gradients: { [GRADIENT_KEY]: 'linear-gradient(135deg, red, blue)' },
      }),
    ),
  );
}

/** Captures the body `POST /api/boards` receives. */
function recordCreate(): { input: CreateBoardInput | null } {
  const captured: { input: CreateBoardInput | null } = { input: null };
  server.use(
    http.post('/api/boards', async ({ request }) => {
      captured.input = (await request.json()) as CreateBoardInput;
      return HttpResponse.json(makeBoardSummary({ id: 42, name: captured.input.name }), {
        status: 201,
      });
    }),
  );
  return captured;
}

function renderPopover(): void {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  renderWithProviders(
    <Routes>
      <Route path="/" element={<CreateBoardPopover anchor={anchor} onClose={() => undefined} />} />
      <Route path="/b/:boardId" element={<p>Board page</p>} />
    </Routes>,
  );
}

describe('CreateBoardPopover', () => {
  it('keeps Create disabled until the title has a real character', async () => {
    const user = userEvent.setup();
    useFullPalette();
    renderPopover();

    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();

    const title = screen.getByLabelText('Space title *');
    await user.type(title, '   ');
    expect(create).toBeDisabled();

    await user.type(title, 'Roadmap');
    expect(create).toBeEnabled();
  });

  it('asks for a title after the input is left empty', async () => {
    const user = userEvent.setup();
    useFullPalette();
    renderPopover();

    await user.click(screen.getByLabelText('Space title *'));
    await user.tab();

    expect(await screen.findByText(/Space title is required/)).toBeInTheDocument();
  });

  it('paints the preview with the chosen background', async () => {
    const user = userEvent.setup();
    useFullPalette();
    renderPopover();

    const gradient = await screen.findByRole('button', { name: 'Ocean gradient background' });
    expect(gradient).toHaveAttribute('aria-pressed', 'false');

    await user.click(gradient);

    expect(gradient).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Space preview' }).getAttribute('style')).toContain(
      'linear-gradient',
    );
  });

  it('sends the chosen background and default lists, then opens the board', async () => {
    const user = userEvent.setup();
    useFullPalette();
    const captured = recordCreate();
    renderPopover();

    await user.click(await screen.findByRole('button', { name: 'Ocean gradient background' }));
    await user.type(screen.getByLabelText('Space title *'), 'Roadmap');
    await user.click(screen.getByLabelText('Start with default lists'));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(captured.input).toEqual({
        name: 'Roadmap',
        default_lists: false,
        background_type: 'gradient',
        background_value: GRADIENT_KEY,
      }),
    );
    expect(await screen.findByText('Board page')).toBeInTheDocument();
  });
});
