// Poll observations only: never refocus, scroll, reload, or repeat an interaction.
export async function waitForBrowserState<T>(read: () => Promise<T>, ready: (state: T) => boolean, label: string,
  { timeoutMs = 5_000, intervalMs = 50, pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  let state: T;
  do {
    state = await read();
    if (ready(state)) return state;
    if (Date.now() >= deadline) break;
    await pause(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  } while (true);
  throw new Error(`${label} timed out after ${timeoutMs}ms; state=${JSON.stringify(state)}`);
}

export function requireCategoryFocus(state: { selected: string | null; focused: string | null; selectedFocused: boolean }, label: string) {
  if (!state.selected || !state.selectedFocused || state.focused !== state.selected) {
    throw new Error(`${label}: selected category does not own keyboard focus; state=${JSON.stringify(state)}`);
  }
}

export async function settledGeometry<T extends Record<string, unknown>>(read: () => Promise<T>, label: string, options = {}) {
  let previous: T | undefined;
  let consecutive = 0;
  return waitForBrowserState(read, (state) => {
    const finite = Object.values(state).every((value) => typeof value !== 'number' || Number.isFinite(value));
    const same = previous && Object.keys(state).every((key) => typeof state[key] === 'number'
      ? typeof previous![key] === 'number' && Math.abs(Number(state[key]) - Number(previous![key])) <= 0.25
      : state[key] === previous![key]);
    consecutive = finite && same ? consecutive + 1 : 0;
    previous = state;
    return consecutive >= 2;
  }, `${label} geometry settlement`, options);
}
