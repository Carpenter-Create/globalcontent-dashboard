import { createHash } from "node:crypto";

import type {
  GitHubHttpResult,
  GitHubRequest,
  GitHubTransport,
} from "./github-http";

type Blob = { content: string };
type TreeEntry = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string;
};
type Commit = {
  sha: string;
  treeSha: string;
  parents: string[];
  message: string;
};

function sha1Hex(s: string): string {
  // Deterministic fake "git-like" object ids for tests (not real git hashing).
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 40);
}

/**
 * In-memory GitHub transport for Phase C unit tests.
 * No network. Supports the subset used by GitHubRestClient.
 */
export class FakeGitHubTransport implements GitHubTransport {
  readonly owner: string;
  readonly repo: string;
  defaultBranch = "main";
  mainTip = "a".repeat(40);

  private blobs = new Map<string, Blob>();
  private trees = new Map<string, TreeEntry[]>();
  private commits = new Map<string, Commit>();
  private refs = new Map<string, string>(); // ref -> commit sha
  private issueComments = new Map<
    number,
    {
      id: number;
      body: string;
      created_at: string;
      updated_at: string;
      user: { id: number; login: string };
      issue_number: number;
    }
  >();
  private pulls = new Map<
    number,
    {
      number: number;
      state: "open" | "closed";
      head: { sha: string; ref: string };
      base: { sha: string; ref: string };
    }
  >();
  private checkRuns = new Map<string, unknown[]>();
  private reviews = new Map<number, unknown[]>();
  private rulesets:
    | Array<{ id: number; name: string; enforcement: string }>
    | "forbidden" = [];

  constructor(owner = "Carpenter-Create", repo = "globalcontent-dashboard") {
    this.owner = owner;
    this.repo = repo;
    this.refs.set("refs/heads/main", this.mainTip);
  }

  setIssueComment(comment: {
    id: number;
    issue_number: number;
    body: string;
    created_at: string;
    updated_at: string;
    user: { id: number; login: string };
  }): void {
    this.issueComments.set(comment.id, comment);
  }

  setPull(pr: {
    number: number;
    state: "open" | "closed";
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
  }): void {
    this.pulls.set(pr.number, pr);
  }

  setCheckRuns(sha: string, runs: unknown[]): void {
    this.checkRuns.set(sha, runs);
  }

  setReviews(prNumber: number, reviews: unknown[]): void {
    this.reviews.set(prNumber, reviews);
  }

  setRulesets(
    rulesets:
      | Array<{ id: number; name: string; enforcement: string }>
      | "forbidden",
  ): void {
    this.rulesets = rulesets;
  }

  getRef(ref: string): string | undefined {
    return this.refs.get(ref);
  }

  getCommit(sha: string): Commit | undefined {
    return this.commits.get(sha);
  }

  getTree(sha: string): TreeEntry[] | undefined {
    return this.trees.get(sha);
  }

  async request<T>(req: GitHubRequest): Promise<GitHubHttpResult<T>> {
    const prefix = `/repos/${this.owner}/${this.repo}`;
    if (!req.path.startsWith(prefix) && req.path !== prefix) {
      // allow exact repo path
      if (req.path !== `/repos/${this.owner}/${this.repo}`) {
        return {
          ok: false,
          code: "not_found",
          message: `wrong repo path: ${req.path}`,
          status: 404,
        };
      }
    }

    const sub = req.path.slice(prefix.length) || "";

    if (req.method === "GET" && (sub === "" || sub === "/")) {
      return ok<T>({
        id: 1,
        name: this.repo,
        full_name: `${this.owner}/${this.repo}`,
        default_branch: this.defaultBranch,
        owner: { login: this.owner, id: 1 },
      });
    }

    const refMatch = sub.match(/^\/git\/ref\/heads\/(.+)$/);
    if (req.method === "GET" && refMatch) {
      const branch = decodeURIComponent(refMatch[1]);
      const sha = this.refs.get(`refs/heads/${branch}`);
      if (!sha) {
        return {
          ok: false,
          code: "not_found",
          message: "ref not found",
          status: 404,
        };
      }
      return ok({ ref: `refs/heads/${branch}`, object: { sha, type: "commit" } });
    }

    const commentMatch = sub.match(/^\/issues\/comments\/(\d+)$/);
    if (req.method === "GET" && commentMatch) {
      const id = Number(commentMatch[1]);
      const c = this.issueComments.get(id);
      if (!c) {
        return {
          ok: false,
          code: "not_found",
          message: "comment not found",
          status: 404,
        };
      }
      return ok({
        id: c.id,
        body: c.body,
        created_at: c.created_at,
        updated_at: c.updated_at,
        user: c.user,
        html_url: `https://github.com/${this.owner}/${this.repo}/issues/${c.issue_number}#issuecomment-${c.id}`,
        issue_url: `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${c.issue_number}`,
      });
    }

    const prMatch = sub.match(/^\/pulls\/(\d+)$/);
    if (req.method === "GET" && prMatch) {
      const pr = this.pulls.get(Number(prMatch[1]));
      if (!pr) {
        return {
          ok: false,
          code: "not_found",
          message: "pr not found",
          status: 404,
        };
      }
      return ok(pr);
    }

    const checksMatch = sub.match(
      /^\/commits\/([0-9a-f]{40})\/check-runs/,
    );
    if (req.method === "GET" && checksMatch) {
      return ok({ check_runs: this.checkRuns.get(checksMatch[1]) ?? [] });
    }

    const reviewsMatch = sub.match(/^\/pulls\/(\d+)\/reviews/);
    if (req.method === "GET" && reviewsMatch) {
      return ok(this.reviews.get(Number(reviewsMatch[1])) ?? []);
    }

    const commitMatch = sub.match(/^\/git\/commits\/([0-9a-f]{40})$/);
    if (req.method === "GET" && commitMatch) {
      const c = this.commits.get(commitMatch[1]);
      if (!c) {
        return {
          ok: false,
          code: "not_found",
          message: "commit not found",
          status: 404,
        };
      }
      return ok({
        sha: c.sha,
        tree: { sha: c.treeSha },
        parents: c.parents.map((p) => ({ sha: p })),
      });
    }

    const treeMatch = sub.match(/^\/git\/trees\/([0-9a-f]{40})/);
    if (req.method === "GET" && treeMatch) {
      const entries = this.trees.get(treeMatch[1]);
      if (!entries) {
        return {
          ok: false,
          code: "not_found",
          message: "tree not found",
          status: 404,
        };
      }
      return ok({
        sha: treeMatch[1],
        truncated: false,
        tree: entries.map((e) => ({ ...e })),
      });
    }

    const blobGet = sub.match(/^\/git\/blobs\/([0-9a-f]{40})$/);
    if (req.method === "GET" && blobGet) {
      const b = this.blobs.get(blobGet[1]);
      if (!b) {
        return {
          ok: false,
          code: "not_found",
          message: "blob not found",
          status: 404,
        };
      }
      return ok({
        sha: blobGet[1],
        content: Buffer.from(b.content, "utf8").toString("base64"),
        encoding: "base64",
      });
    }

    if (req.method === "POST" && sub === "/git/blobs") {
      const body = req.body as { content: string; encoding: string };
      const content = Buffer.from(body.content, "base64").toString("utf8");
      const sha = sha1Hex(`blob:${content}`);
      this.blobs.set(sha, { content });
      return ok({ sha }, 201);
    }

    if (req.method === "POST" && sub === "/git/trees") {
      const body = req.body as {
        tree: TreeEntry[];
        base_tree?: string;
      };
      const map = new Map<string, TreeEntry>();
      if (body.base_tree) {
        const base = this.trees.get(body.base_tree);
        if (!base) {
          return {
            ok: false,
            code: "http_error",
            message: "base_tree not found",
            status: 422,
          };
        }
        for (const e of base) map.set(e.path, e);
      }
      for (const e of body.tree) map.set(e.path, e);
      const entries = [...map.values()].sort((a, b) =>
        a.path < b.path ? -1 : 1,
      );
      const sha = sha1Hex(`tree:${JSON.stringify(entries)}`);
      this.trees.set(sha, entries);
      return ok({ sha }, 201);
    }

    if (req.method === "POST" && sub === "/git/commits") {
      const body = req.body as {
        message: string;
        tree: string;
        parents: string[];
      };
      if (!this.trees.has(body.tree)) {
        return {
          ok: false,
          code: "http_error",
          message: "tree missing",
          status: 422,
        };
      }
      const sha = sha1Hex(
        `commit:${body.tree}:${body.parents.join(",")}:${body.message}`,
      );
      this.commits.set(sha, {
        sha,
        treeSha: body.tree,
        parents: body.parents,
        message: body.message,
      });
      return ok({ sha }, 201);
    }

    if (req.method === "POST" && sub === "/git/refs") {
      const body = req.body as { ref: string; sha: string };
      if (this.refs.has(body.ref)) {
        return {
          ok: false,
          code: "http_error",
          message: "Reference already exists",
          status: 422,
        };
      }
      if (!this.commits.has(body.sha)) {
        return {
          ok: false,
          code: "http_error",
          message: "sha not found",
          status: 422,
        };
      }
      this.refs.set(body.ref, body.sha);
      return ok({ ref: body.ref, object: { sha: body.sha, type: "commit" } }, 201);
    }

    const patchRef = sub.match(/^\/git\/refs\/heads\/(.+)$/);
    if (req.method === "PATCH" && patchRef) {
      const branch = decodeURIComponent(patchRef[1]);
      const ref = `refs/heads/${branch}`;
      const body = req.body as { sha: string; force?: boolean };
      if (body.force) {
        return {
          ok: false,
          code: "http_error",
          message: "force updates are not permitted in Phase C fake/transport",
          status: 422,
        };
      }
      const current = this.refs.get(ref);
      if (!current) {
        return {
          ok: false,
          code: "not_found",
          message: "ref not found",
          status: 404,
        };
      }
      const next = this.commits.get(body.sha);
      if (!next) {
        return {
          ok: false,
          code: "http_error",
          message: "sha not found",
          status: 422,
        };
      }
      // Fast-forward only: new commit must have current as parent (or equal).
      if (body.sha !== current && !next.parents.includes(current)) {
        return {
          ok: false,
          code: "http_error",
          message: "Update is not a fast forward",
          status: 422,
        };
      }
      this.refs.set(ref, body.sha);
      return ok({ ref, object: { sha: body.sha, type: "commit" } });
    }

    if (req.method === "GET" && sub === "/rulesets") {
      if (this.rulesets === "forbidden") {
        return {
          ok: false,
          code: "http_error",
          message: "Resource not accessible by personal access token",
          status: 403,
        };
      }
      return ok(this.rulesets);
    }

    return {
      ok: false,
      code: "not_found",
      message: `unhandled fake path ${req.method} ${req.path}`,
      status: 404,
    };
  }
}

function ok<T>(data: unknown, status = 200): GitHubHttpResult<T> {
  return { ok: true, data: data as T, status };
}
