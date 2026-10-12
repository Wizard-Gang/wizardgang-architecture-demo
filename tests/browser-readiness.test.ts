import { describe, expect, it, vi } from 'vitest';
import { requireCategoryFocus, settledGeometry, waitForBrowserState } from '../scripts/lib/browser-readiness.ts';

describe('current browser readiness and failure contracts', () => {
  it('observes readiness without replaying the action and reports the last mounted/busy state', async () => {
    const read = vi.fn().mockResolvedValue({ mounted: false, busy: 'true', selected: 'Data', focused: 'Reset' });
    await expect(waitForBrowserState(read, (state) => state.mounted && state.busy === 'false', 'missing mount', { timeoutMs: 0 }))
      .rejects.toThrow('state={"mounted":false,"busy":"true","selected":"Data","focused":"Reset"}');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('rejects wrong keyboard focus before dispatch, including another tab in the same category', () => {
    expect(() => requireCategoryFocus({ selected: 'Data', focused: null, selectedFocused: false }, 'ArrowRight')).toThrow('does not own keyboard focus');
    expect(() => requireCategoryFocus({ selected: 'Data', focused: 'Data', selectedFocused: false }, 'ArrowRight')).toThrow();
    expect(() => requireCategoryFocus({ selected: 'Data', focused: 'Data', selectedFocused: true }, 'ArrowRight')).not.toThrow();
  });

  it('settles consecutive measurements', async () => {
    const positions = [950, 940, 940, 940];
    const read = vi.fn(async () => ({ top: positions.shift() ?? 940, bottom: 980, height: 900 }));
    const box = await settledGeometry(read, '375px heading', { intervalMs: 0 });
    expect(read).toHaveBeenCalledTimes(4);
    expect(box).toEqual({ top: 940, bottom: 980, height: 900 });
  });

  it('fails boundedly when geometry never settles', async () => {
    await expect(settledGeometry(async () => ({ top: NaN }), 'unstable heading', { timeoutMs: 0 })).rejects.toThrow('geometry settlement timed out');
  });
});
