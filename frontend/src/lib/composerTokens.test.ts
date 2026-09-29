import { describe, expect, it } from 'vitest';
import {
  MIN_PASTE_LINES,
  parseComposerTokens,
  pastedLines,
  type ComposerContext,
  type LabelCandidate,
} from './composerTokens';

const labels: LabelCandidate[] = [
  { id: 31, name: '', color: 'green' },
  { id: 32, name: 'Bug fix', color: 'red' },
  { id: 33, name: 'Design', color: 'purple' },
];

const context: ComposerContext = { labels, activeCount: 5 };

describe('position tokens', () => {
  it('turns Trello’s 1-based ^3 into the server’s index 2', () => {
    const parsed = parseComposerTokens('Write the brief ^3', context);
    expect(parsed.index).toBe(2);
    expect(parsed.title).toBe('Write the brief');
    expect(parsed.tokens).toEqual([{ kind: 'position', text: '^3', index: 2 }]);
  });

  it('clamps ^99 to an append over the five active cards', () => {
    expect(parseComposerTokens('Last ^99', context).index).toBe(5);
    expect(parseComposerTokens('First ^1', context).index).toBe(0);
  });

  it('ignores ^0 and a non-numeric value, leaving both in the title', () => {
    const zero = parseComposerTokens('Ship it ^0', context);
    expect(zero.index).toBeUndefined();
    expect(zero.title).toBe('Ship it ^0');

    const word = parseComposerTokens('Ship it ^abc', context);
    expect(word.index).toBeUndefined();
    expect(word.title).toBe('Ship it ^abc');
  });

  it('reads ^top and ^bottom, and lets the last position token win', () => {
    expect(parseComposerTokens('Urgent ^top', context).index).toBe('top');
    expect(parseComposerTokens('Later ^BOTTOM', context).index).toBe('bottom');
    expect(parseComposerTokens('Pick one ^top ^2', context).index).toBe(1);
  });

  it('clamps against zero active cards when no count is given', () => {
    expect(parseComposerTokens('Only card ^4').index).toBe(0);
  });
});

describe('label tokens', () => {
  it('matches a colour key and a multi-word name, case-insensitively', () => {
    const parsed = parseComposerTokens('Fix the header #green #bug FIX', context);
    expect(parsed.title).toBe('Fix the header');
    expect(parsed.label_ids).toEqual([31, 32]);
    expect(parsed.tokens).toEqual([
      { kind: 'label', text: '#green', id: 31, name: '', color: 'green' },
      { kind: 'label', text: '#bug FIX', id: 32, name: 'Bug fix', color: 'red' },
    ]);
  });

  it('keeps the words that follow a matched name', () => {
    const parsed = parseComposerTokens('Review #Design please', context);
    expect(parsed.label_ids).toEqual([33]);
    expect(parsed.title).toBe('Review please');
  });

  it('leaves a token that names nothing on this board in the title', () => {
    const parsed = parseComposerTokens('Ask #nobody # about it', context);
    expect(parsed.title).toBe('Ask #nobody # about it');
    expect(parsed.tokens).toEqual([]);
    expect(parsed.label_ids).toEqual([]);
  });

  it('resolves a repeated token once', () => {
    const parsed = parseComposerTokens('#Design #design Polish', context);
    expect(parsed.label_ids).toEqual([33]);
    expect(parsed.title).toBe('Polish');
  });

  it('matches nothing when the board has no labels', () => {
    const parsed = parseComposerTokens('Plain #green');
    expect(parsed.title).toBe('Plain #green');
  });
});

describe('the cleaned title', () => {
  it('collapses the gap a stripped token leaves and keeps the line breaks', () => {
    const parsed = parseComposerTokens('  Write   the   #green  brief  ', context);
    expect(parsed.title).toBe('Write the brief');

    const pasted = parseComposerTokens('First line ^top\nSecond line', context);
    expect(pasted.title).toBe('First line\nSecond line');
    expect(pasted.index).toBe('top');
  });

  it('returns an empty title when the input is nothing but tokens', () => {
    const parsed = parseComposerTokens('#green ^2', context);
    expect(parsed).toEqual({
      title: '',
      label_ids: [31],
      index: 1,
      tokens: [
        { kind: 'label', text: '#green', id: 31, name: '', color: 'green' },
        { kind: 'position', text: '^2', index: 1 },
      ],
    });
  });
});

describe('pastedLines', () => {
  it('trims every line and drops the blank ones', () => {
    expect(pastedLines('  Alpha  \n\nBeta\r\n  \nGamma')).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('reads one line as one line, which is under the prompt threshold', () => {
    expect(pastedLines('Just this')).toEqual(['Just this']);
    expect(pastedLines('   ')).toEqual([]);
    expect(MIN_PASTE_LINES).toBe(2);
  });
});
