/** Mock adapter: realistic Persian data with a small latency so loading states are real. */
import type { ApiAdapter } from '../client';
import { mockAssist, mockMeta, mockOptions, mockParse, mockPlan, mockResolve } from './engine';

const delay = (ms = 140) => new Promise<void>((r) => setTimeout(r, ms));

export const mockAdapter: ApiAdapter = {
  async parse(req) {
    await delay(220);
    return mockParse(req.text);
  },
  async resolve(req) {
    await delay(120);
    return mockResolve(req.state);
  },
  async options(req) {
    await delay(160);
    return mockOptions(req.state, req.itemId);
  },
  async plan(req) {
    await delay(180);
    return mockPlan(req.state);
  },
  async assist(req) {
    await delay(200);
    return mockAssist(req);
  },
  async meta() {
    await delay(40);
    const m = mockMeta();
    return { ...m, snapshotLabel: undefined, fictionalShopNames: true };
  },
};
