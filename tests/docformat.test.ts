import { expect, it } from 'vitest';
import { DEFAULT_FORMAT, parts, sectionLabel } from '../src/v6/docDesign';

it('numbers headings in every supported style', () => {
  const f = (numbering: any) => ({ ...DEFAULT_FORMAT, numbering });
  expect(sectionLabel(3, f('padded'), false)).toBe('03');
  expect(sectionLabel(3, f('decimal'), false)).toBe('3');
  expect(sectionLabel(4, f('roman'), false)).toBe('IV');
  expect(sectionLabel(2, f('letters'), false)).toBe('B');
  expect(sectionLabel(2, f('letters'), true)).toBe('ب');
  expect(sectionLabel(2, f('none'), false)).toBe('');
});

it('turns "- " lines into bullet lists and keeps prose as prose', () => {
  const r = parts('Intro sentence.\n- first point\n- second point\nClosing sentence.');
  expect(r.map(x => x.list)).toEqual([false, true, false]);
  expect(r[1].lines).toEqual(['first point', 'second point']);
});
