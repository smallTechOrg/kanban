import { describe, expect, it } from 'vitest';
import {
  FALLBACK_LABEL_KEY,
  labelPatternIndex,
  labelStyle,
  listBackground,
  tokenVar,
  type LabelPalette,
} from './colors';

const palette: LabelPalette = {
  green: {
    subtle: 'rgb(186, 243, 219)',
    normal: 'rgb(75, 206, 151)',
    bold: 'rgb(31, 132, 90)',
    text: 'rgb(22, 75, 53)',
    text_bold: 'rgb(255, 255, 255)',
  },
  [FALLBACK_LABEL_KEY]: {
    subtle: 'rgba(9, 30, 66, 0.06)',
    normal: 'rgba(9, 30, 66, 0.06)',
    bold: 'rgba(9, 30, 66, 0.06)',
    text: 'rgb(23, 43, 77)',
    text_bold: 'rgb(23, 43, 77)',
  },
};

describe('tokenVar', () => {
  it('references the custom property declared in tokens.css', () => {
    expect(tokenVar('success')).toBe('var(--success)');
    expect(tokenVar('text-muted')).toBe('var(--text-muted)');
  });
});

describe('labelStyle', () => {
  it('reads the requested tone from the server palette', () => {
    expect(labelStyle('green', 'normal', palette)).toEqual({
      background: 'rgb(75, 206, 151)',
      color: 'rgb(22, 75, 53)',
    });
  });

  it('uses the bold text colour on the bold tone', () => {
    expect(labelStyle('green', 'bold', palette)).toEqual({
      background: 'rgb(31, 132, 90)',
      color: 'rgb(255, 255, 255)',
    });
  });

  it('falls back to the "none" row for an unknown key', () => {
    expect(labelStyle('chartreuse', 'subtle', palette)).toEqual(
      labelStyle(FALLBACK_LABEL_KEY, 'subtle', palette),
    );
  });

  it('falls back to tokens when the palette has no "none" row', () => {
    expect(labelStyle('green', 'normal', {})).toEqual({
      background: 'var(--hover)',
      color: 'var(--text)',
    });
  });
});

describe('listBackground', () => {
  const lists = { green: 'rgb(186, 243, 219)', blue: 'rgb(204, 224, 255)' };

  it('reads the column colour from the server palette', () => {
    expect(listBackground('green', lists)).toBe('rgb(186, 243, 219)');
  });

  it('falls back to the default grey column without a colour', () => {
    expect(listBackground(null, lists)).toBe('var(--list-bg)');
  });

  it('falls back to the default grey column for a key this server does not publish', () => {
    expect(listBackground('chartreuse', lists)).toBe('var(--list-bg)');
  });
});

describe('labelPatternIndex', () => {
  it("is the key's slot in the server palette, so every key gets its own pattern", () => {
    expect(labelPatternIndex('green', palette)).toBe(0);
    expect(labelPatternIndex(FALLBACK_LABEL_KEY, palette)).toBe(1);
  });

  it('answers -1 for a key this palette does not publish', () => {
    expect(labelPatternIndex('teal', palette)).toBe(-1);
  });
});
