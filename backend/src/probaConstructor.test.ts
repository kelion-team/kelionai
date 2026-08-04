import { describe, it, expect } from 'vitest';
import { probaConstructor } from './services/probaConstructor';

describe('probaConstructor', () => {
  it('should greet the name given', () => {
    expect(probaConstructor('Adrian')).toBe('Kelion saluta pe Adrian');
  });
});
