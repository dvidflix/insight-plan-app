/** A small client for Apache Superset's REST API (the stack's local instance), signed in as the admin of its .env-local.
    Used by externalPlugin.ts to look at what Superset holds and to build the comparison dashboard (supersetDashboard.ts).
    Superset wants a JWT for the API and, for writes, a CSRF token that goes with the session cookie. */

export interface SupersetConfig {
  base: string;
  user: string;
  password: string;
}

export class SupersetError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export class Superset {
  private jar = new Map<string, string>();
  private token = '';
  private csrf = '';

  constructor(private cfg: SupersetConfig) {}

  private remember(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }

  private cookies = () => [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');

  async connect(): Promise<this> {
    const { base, user, password } = this.cfg;
    if (!user || !password) throw new SupersetError('Superset sign-in details are missing (ADMIN_USERNAME / ADMIN_PASSWORD in the stack\'s docker/.env-local).', 503);
    let res: Response;
    try {
      res = await fetch(`${base}/api/v1/security/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password, provider: 'db', refresh: true }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      throw new SupersetError(`Superset is not answering at ${base}: is its Docker stack running? (${e instanceof Error ? e.message : e})`, 503);
    }
    if (!res.ok) throw new SupersetError(`Superset refused the sign-in (${res.status}).`, 503);
    this.remember(res);
    this.token = ((await res.json()) as { access_token: string }).access_token;
    const c = await fetch(`${base}/api/v1/security/csrf_token/`, { headers: { Authorization: `Bearer ${this.token}`, Cookie: this.cookies() } });
    this.remember(c);
    this.csrf = ((await c.json()) as { result: string }).result;
    return this;
  }

  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'X-CSRFToken': this.csrf,
        Referer: this.cfg.base,
        Cookie: this.cookies(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    this.remember(res);
    const text = await res.text();
    if (!res.ok) throw new SupersetError(`Superset ${method} ${path}: ${res.status} ${text.slice(0, 600)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Rison-encoded `q` parameter of the list endpoints. */
  static q(rison: string) {
    return `?q=${encodeURIComponent(rison)}`;
  }

  /** What the instance holds: databases, datasets (with their columns), charts and dashboards. */
  async overview() {
    const [databases, datasets, charts, dashboards] = await Promise.all([
      this.call('GET', `/api/v1/database/${Superset.q('(page_size:100)')}`),
      this.call('GET', `/api/v1/dataset/${Superset.q('(page_size:200)')}`),
      this.call('GET', `/api/v1/chart/${Superset.q('(page_size:200)')}`),
      this.call('GET', `/api/v1/dashboard/${Superset.q('(page_size:100)')}`),
    ]);
    return {
      databases: (databases.result ?? []).map((d: any) => ({ id: d.id, name: d.database_name, backend: d.backend })),
      datasets: (datasets.result ?? []).map((d: any) => ({ id: d.id, table: d.table_name, database: d.database?.database_name, schema: d.schema, kind: d.kind })),
      charts: (charts.result ?? []).map((c: any) => ({ id: c.id, name: c.slice_name, viz: c.viz_type, dataset: c.datasource_name_text })),
      dashboards: (dashboards.result ?? []).map((d: any) => ({ id: d.id, title: d.dashboard_title, slug: d.slug, published: d.published })),
    };
  }
}
