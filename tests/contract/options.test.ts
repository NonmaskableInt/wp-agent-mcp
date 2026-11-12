import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';

describe.skipIf(!bridgeConfigured)('contract: options', () => {
  let session: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    session = await connect();
  });
  afterAll(async () => {
    await session?.close();
  });

  it('option_set writes an allowlisted option that option_get reads back', async () => {
    const value = `Contract ${Date.now()}`;

    const set = await session.call('option_set', { options: { blogname: value } });
    expect(set.text).not.toMatch(/option_not_allowed/);
    expect(set.isError).toBe(false);

    const get = await session.call('option_get', { keys: ['blogname'] });
    expect(get.isError).toBe(false);
    expect(get.json).toMatchObject({ blogname: value });
  });

  it('option_set still rejects non-allowlisted keys', async () => {
    const res = await session.call('option_set', { options: { admin_email: 'x@example.test' } });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/option_not_allowed/);
  });
});
