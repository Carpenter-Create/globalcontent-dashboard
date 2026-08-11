/**
 * Shared local security-harness configuration validation.
 * Node built-ins only. Never logs or includes key values in errors.
 */

export class HarnessConfigError extends Error {
  /** @param {string} variable */
  /** @param {string} category */
  constructor(variable, category) {
    super(`${variable}: ${category}`);
    this.name = "HarnessConfigError";
    this.variable = variable;
    this.category = category;
  }
}

const ALLOWED_AUTHORITIES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * @param {string} raw
 */
export function extractHttpAuthority(raw) {
  const match = raw.match(/^http:\/\/([^/?#]+)/i);
  if (!match) return null;
  const hostPort = match[1];
  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    return end === -1 ? null : hostPort.slice(0, end + 1);
  }
  const lastColon = hostPort.lastIndexOf(":");
  if (lastColon === -1) return hostPort;
  const portPart = hostPort.slice(lastColon + 1);
  if (/^\d+$/.test(portPart)) {
    return hostPort.slice(0, lastColon);
  }
  return hostPort;
}

/**
 * @param {string} authority
 * @param {string} name
 */
export function validateLexicalAuthority(authority, name) {
  if (!authority) {
    throw new HarnessConfigError(name, "malformed-url");
  }
  if (authority.includes("%")) {
    throw new HarnessConfigError(name, "encoded-host");
  }
  if (authority.endsWith(".")) {
    throw new HarnessConfigError(name, "nonloopback-host");
  }
  if (!ALLOWED_AUTHORITIES.has(authority)) {
    throw new HarnessConfigError(name, "nonloopback-host");
  }
}

/**
 * @param {unknown} value
 * @param {string} name
 */
export function validateRequiredKey(value, name) {
  if (value === undefined || value === null) {
    throw new HarnessConfigError(name, "missing");
  }
  if (typeof value !== "string") {
    throw new HarnessConfigError(name, "invalid-type");
  }
  if (value !== value.trim()) {
    throw new HarnessConfigError(name, "surrounding-whitespace");
  }
  if (value.length === 0) {
    throw new HarnessConfigError(name, "empty");
  }
  if (/[\r\n]/.test(value)) {
    throw new HarnessConfigError(name, "multiline");
  }
  return value;
}

/**
 * @param {string} raw
 * @param {string} name
 * @param {number} requiredPort
 */
export function validateLoopbackHttpUrl(raw, name, requiredPort) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new HarnessConfigError(name, "missing");
  }
  if (/^http:\/\/[^/?#]*@/i.test(raw)) {
    throw new HarnessConfigError(name, "embedded-credentials");
  }
  if (/^https:\/\//i.test(raw)) {
    throw new HarnessConfigError(name, "non-http-scheme");
  }
  const authority = extractHttpAuthority(raw);
  validateLexicalAuthority(authority, name);

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HarnessConfigError(name, "malformed-url");
  }
  if (url.protocol !== "http:") {
    throw new HarnessConfigError(name, "non-http-scheme");
  }
  if (url.username || url.password) {
    throw new HarnessConfigError(name, "embedded-credentials");
  }
  if (url.search || url.hash) {
    throw new HarnessConfigError(name, url.search ? "query-not-allowed" : "fragment-not-allowed");
  }
  const pathname = url.pathname;
  if (pathname !== "" && pathname !== "/") {
    throw new HarnessConfigError(name, "non-root-path");
  }
  const port = url.port ? Number(url.port) : 80;
  if (port !== requiredPort) {
    throw new HarnessConfigError(name, "wrong-port");
  }
  return raw;
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function loadHarnessConfig(env) {
  const supabaseUrl = validateLoopbackHttpUrl(
    validateRequiredKey(env.SUPABASE_URL, "SUPABASE_URL"),
    "SUPABASE_URL",
    54321,
  );
  const supabaseAnonKey = validateRequiredKey(env.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = validateRequiredKey(
    env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  return { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey };
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function loadHarnessConfigWithApp(env) {
  const base = loadHarnessConfig(env);
  const appUrl = validateLoopbackHttpUrl(
    validateRequiredKey(env.APP_URL, "APP_URL"),
    "APP_URL",
    3100,
  );
  return { ...base, appUrl };
}
