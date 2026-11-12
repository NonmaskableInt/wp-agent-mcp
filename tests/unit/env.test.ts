import { describe, expect, it } from 'vitest';
import { config_help, validate_env } from '../../src/env.js';

const good = { WP_BASE_URL: 'https://example.com', WP_USERNAME: 'agent-user', WP_APP_PASSWORD: 'abcd efgh ijkl mnop qrst uvwx' };

describe('validate_env', () => {
  it('accepts a complete, valid configuration and normalises the URL', () => {
    const r = validate_env({ ...good, WP_BASE_URL: 'https://example.com/' });
    expect(r.problems).toEqual([]);
    expect(r.values).toMatchObject({ baseUrl: 'https://example.com', username: 'agent-user' });
  });

  it('reports EVERY missing setting at once, not just the first', () => {
    const r = validate_env({});
    expect(r.problems.join('\n')).toMatch(/WP_BASE_URL/);
    expect(r.problems.join('\n')).toMatch(/WP_USERNAME/);
    expect(r.problems.join('\n')).toMatch(/WP_APP_PASSWORD/);
    expect(r.problems).toHaveLength(3);
  });

  it('reports only what is missing', () => {
    const r = validate_env({ WP_BASE_URL: good.WP_BASE_URL, WP_USERNAME: good.WP_USERNAME });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/WP_APP_PASSWORD/);
  });

  it('treats empty and whitespace-only values as missing', () => {
    expect(validate_env({ ...good, WP_APP_PASSWORD: '' }).problems[0]).toMatch(/WP_APP_PASSWORD/);
    expect(validate_env({ ...good, WP_USERNAME: '   ' }).problems[0]).toMatch(/WP_USERNAME/);
  });

  it.each([
    ['no scheme', 'example.com', /http:\/\/ or https:\/\//],
    ['a non-http scheme', 'ftp://example.com', /http:\/\/ or https:\/\//],
    ['the REST path included', 'https://example.com/wp-json', /wp-json/],
    ['the bridge path included', 'https://example.com/wp-json/agent/v1', /wp-json/],
    ['credentials in the URL', 'https://user:pw@example.com', /credentials/i],
    ['garbage', 'not a url', /http:\/\/ or https:\/\//],
  ])('rejects a base URL with %s and says why', (_l, url, why) => {
    const r = validate_env({ ...good, WP_BASE_URL: url });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/WP_BASE_URL/);
    expect(r.problems[0]).toMatch(why);
  });

  it('keeps a subdirectory install path', () => {
    expect(validate_env({ ...good, WP_BASE_URL: 'https://example.com/blog/' }).values?.baseUrl).toBe('https://example.com/blog');
  });

  it('trims stray whitespace and surrounding quotes, and says it did', () => {
    const r = validate_env({ WP_BASE_URL: ' "https://example.com" ', WP_USERNAME: " 'agent-user' ", WP_APP_PASSWORD: ' "abcd efgh" ' });
    expect(r.problems).toEqual([]);
    expect(r.values).toMatchObject({ baseUrl: 'https://example.com', username: 'agent-user', appPassword: 'abcd efgh' });
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.notes.join(' ')).toMatch(/quote/i);
  });

  it('does not strip quotes that are part of a value', () => {
    expect(validate_env({ ...good, WP_APP_PASSWORD: 'ab"cd' }).values?.appPassword).toBe('ab"cd');
  });
});

describe('config_help', () => {
  it('explains that an MCP client does not read a .env file, and where the values go', () => {
    const t = config_help(['Missing WP_APP_PASSWORD']);
    expect(t).toMatch(/Missing WP_APP_PASSWORD/);
    expect(t).toMatch(/env/);
    expect(t).toMatch(/\.env/);
    expect(t).toMatch(/--check/);
  });

  it('never prints a password-looking value', () => {
    expect(config_help(['x'])).not.toMatch(/WP_APP_PASSWORD["']?\s*[:=]\s*["'][a-z0-9]{8,}/i);
  });
});
