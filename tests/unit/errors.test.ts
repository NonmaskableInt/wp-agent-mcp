import { describe, expect, it } from 'vitest';
import { enrich_error, explain_http_failure, explain_network_error } from '../../src/errors.js';

const URL_ = 'https://example.com/wp-json/agent/v1/options';

describe('explain_http_failure (a response that is not the bridge\'s JSON)', () => {
  it.each([
    [404, 'text/html', 'not_found', /URL|installed|active/i, /www/],
    [401, 'text/html', 'auth_failed', /application password/i, /not .*login password|WP_APP_PASSWORD/i],
    [403, 'text/html', 'forbidden', /forbidden|permission|blocked/i, /./],
    [406, 'text/html', 'blocked_by_firewall', /firewall|ModSecurity/i, /./],
    [429, 'text/html', 'rate_limited', /too many|rate/i, /./],
    [500, 'text/html', 'server_error', /server error/i, /error log|\.htaccess|PHP/i],
    [502, 'text/html', 'unavailable', /unavailable|gateway/i, /./],
    [503, 'text/html', 'unavailable', /unavailable|maintenance/i, /./],
    [504, 'text/html', 'unavailable', /timed out|gateway|unavailable/i, /./],
    [200, 'text/html', 'not_json', /HTML/i, /maintenance|login|different site|redirect/i],
  ])('status %i %s -> %s', (status, type, code, first, second) => {
    const e = explain_http_failure({ status, url: URL_, contentType: type, body: '<html></html>' });
    expect(e.code).toBe(code);
    expect(e.message).toMatch(first);
    expect(e.message).toMatch(second);
    expect(e.message).toContain(String(status));
    expect(e.message).toContain('example.com');
  });

  it('puts the actual URL in the message, so a wrong host is obvious', () => {
    expect(explain_http_failure({ status: 404, url: 'https://www.example.com/wp-json/agent/v1/x', contentType: 'text/html', body: '' }).message).toContain('www.example.com');
  });

  it('never echoes a large response body', () => {
    const e = explain_http_failure({ status: 500, url: URL_, contentType: 'text/html', body: 'X'.repeat(5000) });
    expect(e.message.length).toBeLessThan(700);
  });
});

describe('explain_network_error (the request never got a response)', () => {
  const err = (code: string, message = 'fetch failed') => Object.assign(new TypeError(message), { cause: { code } });

  it.each([
    ['ENOTFOUND', 'dns_failure', /resolve|DNS|spell/i],
    ['EAI_AGAIN', 'dns_failure', /resolve|DNS/i],
    ['ECONNREFUSED', 'connection_refused', /refused|nothing is listening|port/i],
    ['ECONNRESET', 'connection_reset', /reset|firewall|rate/i],
    ['EPIPE', 'connection_reset', /reset|closed/i],
    ['ETIMEDOUT', 'timeout', /time/i],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout', /time/i],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_error', /does not match the name/i],
    ['CERT_HAS_EXPIRED', 'tls_error', /expired/i],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_error', /self-signed|trusted/i],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls_error', /certificate|trusted/i],
  ])('%s -> %s', (code, expected, hint) => {
    const e = explain_network_error(err(code), 'https://example.com');
    expect(e.code).toBe(expected);
    expect(e.message).toMatch(hint);
    expect(e.message).toContain('example.com');
  });

  it('recognises a timeout by the error name too', () => {
    const e = explain_network_error(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'https://example.com');
    expect(e.code).toBe('timeout');
  });

  it('falls back to a generic message that keeps the original detail', () => {
    const e = explain_network_error(new Error('weird thing happened'), 'https://example.com');
    expect(e.code).toBe('network_error');
    expect(e.message).toContain('weird thing happened');
  });

  it('handles non-Error throwables', () => {
    expect(explain_network_error('boom', 'https://example.com').code).toBe('network_error');
  });
});

describe('enrich_error (JSON errors that already have a code)', () => {
  it('leaves bridge errors alone', () => {
    expect(enrich_error('option_not_allowed', "Option key 'x' is not allowed.", 403)).toBe("Option key 'x' is not allowed.");
    expect(enrich_error('validation_error', 'posts_per_page must be between 1 and 100', 422)).toBe('posts_per_page must be between 1 and 100');
  });

  it.each([
    ['rest_not_logged_in', 401],
    ['incorrect_password', 401],
    ['invalid_username', 401],
    ['rest_forbidden', 401],
  ])('adds an authentication hint to %s', (code, status) => {
    expect(enrich_error(code, 'You are not currently logged in.', status)).toMatch(/application password/i);
  });

  it('explains rest_no_route as a missing or outdated bridge', () => {
    expect(enrich_error('rest_no_route', 'No route was found matching the URL and request method.', 404)).toMatch(/php-agent-bridge|not installed|inactive|older/i);
  });

  it('keeps the original message in every case', () => {
    expect(enrich_error('rest_no_route', 'No route was found.', 404)).toContain('No route was found.');
    expect(enrich_error('rest_not_logged_in', 'You are not currently logged in.', 401)).toContain('You are not currently logged in.');
  });
});
