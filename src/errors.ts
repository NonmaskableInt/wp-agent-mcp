/**
 * Turns "something went wrong" into "here is what is wrong and what to do". Pure functions, no I/O.
 * The goal: an agent or a person reading a failure can tell a wrong URL from bad credentials from a
 * blocked request without needing server logs.
 */

export interface Explained {
  code: string;
  message: string;
}

const AUTH_HINT =
  'authentication failed: check WP_USERNAME and WP_APP_PASSWORD. Use an application password (Users → Profile → Application Passwords), not the account\'s login password.';

function host_of(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function explain_http_failure(input: { status: number; url: string; contentType: string; body: string }): Explained {
  const { status, url } = input;
  const at = `HTTP ${status} from ${url}`;
  switch (status) {
    case 401:
      return { code: 'auth_failed', message: `${at}: ${AUTH_HINT}` };
    case 403:
      return { code: 'forbidden', message: `${at}: forbidden. The account may lack permission (the bridge needs an administrator), or a security plugin or firewall is blocking the request.` };
    case 404:
      return { code: 'not_found', message: `${at}: this address does not serve the WordPress REST API. Check WP_BASE_URL (a "www." address can point at a different site than the bare domain), and that the php-agent-bridge plugin is installed and active.` };
    case 406:
      return { code: 'blocked_by_firewall', message: `${at}: blocked by the host's web application firewall (ModSecurity or similar). The request was rejected before reaching WordPress; ask the host to allow it, or check whether the request contained a pattern the firewall dislikes.` };
    case 429:
      return { code: 'rate_limited', message: `${at}: too many requests (rate limited). Wait a minute and retry.` };
    case 502:
    case 503:
    case 504:
      return { code: 'unavailable', message: `${at}: the site is temporarily unavailable (bad gateway, maintenance, or a timed-out upstream). Retry shortly; if it persists, check the host.` };
    default:
      break;
  }
  if (status >= 500) {
    return { code: 'server_error', message: `${at}: server error. Check the PHP/Apache error log; a recent .htaccess, plugin or theme change is the usual cause.` };
  }
  if (status >= 200 && status < 300) {
    return { code: 'not_json', message: `${at}: got HTML instead of JSON. This is usually a maintenance or "coming soon" page, a redirect to a login page, or a different site (such as the www address). Check WP_BASE_URL.` };
  }
  return { code: 'http_error', message: `${at}: unexpected response (${input.contentType || 'unknown type'}). Check WP_BASE_URL.` };
}

export function explain_network_error(err: unknown, url: string): Explained {
  const host = host_of(url);
  const anyErr = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } } | undefined;
  const code = anyErr?.cause?.code ?? anyErr?.code ?? '';

  if (anyErr?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return { code: 'timeout', message: `Timed out talking to ${host}. The site may be slow or down, or a firewall is dropping the connection.` };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { code: 'dns_failure', message: `Cannot resolve ${host}: the name does not exist or DNS is not answering. Check the spelling of WP_BASE_URL and that the domain's DNS is set up.` };
  }
  if (code === 'ECONNREFUSED') {
    return { code: 'connection_refused', message: `Connection to ${host} was refused: nothing is listening on that address and port. Check the host name and port in WP_BASE_URL.` };
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') {
    return { code: 'connection_reset', message: `The connection to ${host} was reset or closed. This often means a firewall or rate limiter on the host; wait a minute and retry.` };
  }
  if (code === 'CERT_HAS_EXPIRED') {
    return { code: 'tls_error', message: `The TLS certificate for ${host} has expired.` };
  }
  if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return { code: 'tls_error', message: `The TLS certificate for ${host} is self-signed and not trusted.` };
  }
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return { code: 'tls_error', message: `The TLS certificate does not match the name ${host}. The site's certificate may not have been issued for this address yet.` };
  }
  if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || code.startsWith('ERR_TLS')) {
    return { code: 'tls_error', message: `The TLS certificate for ${host} could not be verified (not a trusted certificate).` };
  }

  const detail = anyErr?.cause?.message || anyErr?.message || (typeof err === 'string' ? err : 'unknown error');
  return { code: 'network_error', message: `Could not reach ${host}: ${detail}` };
}

/** Adds a plain-language hint to errors that arrive as JSON with a code (WordPress core and bridge errors). */
export function enrich_error(code: string, message: string, status: number): string {
  if (status === 401 || code === 'rest_not_logged_in' || code === 'incorrect_password' || code === 'invalid_username') {
    return `${message} — ${AUTH_HINT}`;
  }
  if (code === 'rest_no_route') {
    return `${message} — the route was not found: php-agent-bridge may not be installed or active on this site, or it is older than this server expects. (Also check that WP_BASE_URL points at the right site.)`;
  }
  return message;
}
