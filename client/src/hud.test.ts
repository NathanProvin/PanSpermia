import { expect, test } from 'vitest';
import { roman } from './hud.ts';

test('generations read in roman numerals', () => {
  expect([1, 4, 9, 14, 40, 90, 400, 1994].map(roman)).toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'XC', 'CD', 'MCMXCIV']);
});
