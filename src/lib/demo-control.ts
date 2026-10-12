import type { Env } from '../types';
import { recordDemoEvent } from './audit';
import { COLLECTIONS, demoRecords } from './storage';

export interface DemoControl {
  state: 'online' | 'offline';
  publicMessage: string;
  updatedAt: string;
  updatedBy: string | null;
}

// The state before any operator change: the demo is online. Only an unreadable record fails closed.
const INITIAL_CONTROL: DemoControl = {
  state: 'online',
  publicMessage: 'The architecture demo is available.',
  updatedAt: new Date(0).toISOString(),
  updatedBy: null
};

const DEFAULT_CONTROL: DemoControl = {
  state: 'offline',
  publicMessage: 'Demo control state is temporarily unavailable.',
  updatedAt: new Date(0).toISOString(),
  updatedBy: null
};

export async function getDemoControl(env: Env): Promise<DemoControl> {
  try {
    const record = await demoRecords(env).get<DemoControl>(COLLECTIONS.control, 'demo');
    const control = record?.body;
    if (!control) return INITIAL_CONTROL;
    if (control.state !== 'online' && control.state !== 'offline') return DEFAULT_CONTROL;
    return control;
  } catch {
    // Fail closed: a D1 outage must not accidentally bypass an intentional offline state.
    return DEFAULT_CONTROL;
  }
}

export async function setDemoControl(
  env: Env,
  state: 'online' | 'offline',
  publicMessage: string,
  updatedBy: string
): Promise<DemoControl> {
  const updatedAt = new Date().toISOString();
  const control: DemoControl = { state, publicMessage, updatedAt, updatedBy };
  await demoRecords(env).put(COLLECTIONS.control, 'demo', control);

  await recordDemoEvent(env, 'admin', 'demo_state_changed', {
    state,
    message: publicMessage,
    updatedBy,
    updatedAt
  });


  return control;
}
