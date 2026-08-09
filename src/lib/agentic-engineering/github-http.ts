import type { GitHubCredential } from "./github-credentials";
import { redactSecrets } from "./github-credentials";
import type { AgenticGitHubConfig } from "./github-config";

export type GitHubHttpError = {
  ok: false;
  code:
    | "http_error"
    | "timeout"
    | "rate_limited"
    | "network_error"
    | "invalid_json"
    | "not_found";
  message: string;
  status?: number;
};

export type GitHubHttpSuccess<T> = {
  ok: true;
  data: T;
  status: number;
  /** Absolute or API-relative path for Link rel=next, if present. */
  nextPath?: string;
};

export type GitHubHttpResult<T> = GitHubHttpSuccess<T> | GitHubHttpError;

export type GitHubRequest = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Path beginning with / — relative to apiBaseUrl. */
  path: string;
  body?: unknown;
  /** Extra headers (never Authorization — injected from credential). */
  headers?: Record<string, string>;
};

/**
 * Transport seam — real fetch or fake in tests.
 * Implementations must never log Authorization headers or token values.
 */
export interface GitHubTransport {
  request<T>(req: GitHubRequest): Promise<GitHubHttpResult<T>>;
}

export function createFetchGitHubTransport(
  config: AgenticGitHubConfig,
  credential: GitHubCredential,
  fetchImpl: typeof fetch = fetch,
): GitHubTransport {
  return {
    async request<T>(req: GitHubRequest): Promise<GitHubHttpResult<T>> {
      const url = `${config.apiBaseUrl.replace(/\/$/, "")}${req.path}`;
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        config.requestTimeoutMs,
      );
      try {
        const res = await fetchImpl(url, {
          method: req.method,
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            Authorization: credential.authorizationHeader,
            "User-Agent": "globalcontent-agentic-engineering-phase-c",
            ...(req.body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
            ...req.headers,
          },
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
          signal: controller.signal,
        });

        if (res.status === 403 || res.status === 429) {
          const remaining = res.headers.get("x-ratelimit-remaining");
          if (res.status === 429 || remaining === "0") {
            return {
              ok: false,
              code: "rate_limited",
              message: "GitHub API rate limit exceeded",
              status: res.status,
            };
          }
        }

        if (res.status === 404) {
          return {
            ok: false,
            code: "not_found",
            message: `GitHub resource not found: ${req.method} ${req.path}`,
            status: 404,
          };
        }

        const text = await res.text();
        let data: unknown = null;
        if (text.length > 0) {
          try {
            data = JSON.parse(text);
          } catch {
            return {
              ok: false,
              code: "invalid_json",
              message: `invalid JSON from GitHub (${res.status})`,
              status: res.status,
            };
          }
        }

        if (!res.ok) {
          const msg =
            typeof data === "object" &&
            data !== null &&
            "message" in data &&
            typeof (data as { message: unknown }).message === "string"
              ? (data as { message: string }).message
              : `GitHub HTTP ${res.status}`;
          return {
            ok: false,
            code: "http_error",
            message: redactSecrets(msg),
            status: res.status,
          };
        }

        return {
          ok: true,
          data: data as T,
          status: res.status,
          nextPath: parseNextPath(
            res.headers.get("link"),
            config.apiBaseUrl,
          ),
        };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return {
            ok: false,
            code: "timeout",
            message: `GitHub request timed out after ${config.requestTimeoutMs}ms`,
          };
        }
        return {
          ok: false,
          code: "network_error",
          message: redactSecrets(
            err instanceof Error ? err.message : String(err),
          ),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function parseNextPath(
  linkHeader: string | null,
  apiBaseUrl: string,
): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(",")) {
    const m = part.trim().match(/^<([^>]+)>\s*;\s*rel="next"$/);
    if (!m) continue;
    const abs = m[1];
    const base = apiBaseUrl.replace(/\/$/, "");
    if (abs.startsWith(base)) {
      return abs.slice(base.length);
    }
    try {
      const u = new URL(abs);
      return `${u.pathname}${u.search}`;
    } catch {
      return abs;
    }
  }
  return undefined;
}

/** Follow Link: rel="next" pagination for list endpoints. */
export async function githubPaginate<T>(
  transport: GitHubTransport,
  firstPath: string,
  extract: (page: unknown) => T[],
  maxPages = 20,
): Promise<GitHubHttpResult<T[]>> {
  const all: T[] = [];
  let path: string | null = firstPath;
  let pages = 0;
  while (path) {
    pages += 1;
    if (pages > maxPages) {
      return {
        ok: false,
        code: "http_error",
        message: `pagination exceeded max pages (${maxPages})`,
      };
    }
    const res: GitHubHttpResult<unknown> = await transport.request<unknown>({
      method: "GET",
      path,
    });
    if (!res.ok) return res;
    all.push(...extract(res.data));
    path = res.nextPath ?? null;
  }
  return { ok: true, data: all, status: 200 };
}
