import { expect, it } from 'vitest';
import { DEFAULT_STYLE, LAYOUTS, blankSlide, fit, normalize, renderTemplate } from '../src/v6/templates';

const cover = { presenter: 'Dr A', institution: 'MIA', date: '2026' };
it('renders every layout with escaped text and a slide number', () => {
  for (const layout of LAYOUTS) {
    const d = { ...blankSlide(layout), title: 'T <script>', items: [1, 2, 3].map(i => ({ icon: 'brain', title: 'I' + i, text: 'x', value: String(i * 10) })), left: { title: 'L', items: ['a', 'b'] }, right: { title: 'R', items: ['c', 'd'] }, headers: ['h1', 'h2'], rows: [['a', 'b']], value: '68%', quote: 'q', imageQuery: 'knee' };
    const html = renderTemplate(d, 2, 9, DEFAULT_STYLE, false, cover);
    expect(html).toContain('class="slide t');
    expect(html).not.toContain('<script>');
  }
});
it('falls back to a safe layout when the AI leaves required content empty', () => {
  expect(normalize({ ...blankSlide('chart'), items: [] }).layout).toBe('section');
  expect(normalize({ ...blankSlide('comparison'), left: { title: 'a', items: [] } }).layout).toBe('section');
  expect(normalize({ layout: 'nope' as any }).layout).toBe('section');
});
it('shrinks long text and applies the student size scale', () => {
  expect(fit('short', 46, 34, 30)).toBe(46);
  expect(fit('x'.repeat(200), 46, 34, 30)).toBe(30);
  expect(fit('short', 46, 34, 30, 1.2)).toBe(55);
});
