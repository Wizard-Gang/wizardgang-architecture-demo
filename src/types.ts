import type { D1Like, R2Like } from '#wg-edge';

/** The body of an R2 object as the demo reads it back through the shared bucket. */
export interface R2ObjectBody {
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array>;
  size?: number;
  etag?: string;
  uploaded?: Date;
  httpMetadata?: { contentType?: string };
}

export interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

export interface SecretsStoreSecret {
  get(): Promise<string>;
}

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  // Baseline's shared `wizardgang` D1 (records and events) and R2 bucket; the demo reaches both through lib/storage.ts.
  WG_DB: D1Like;
  WG_R2?: R2Like;
  DEMO_COORDINATOR?: DurableObjectNamespace;
  ASSETS?: AssetsBinding;
  GITHUB_REPO_URL: string;
  GITHUB_BRANCH: string;

  // WORKER_SECRETS_START
  DEMO_WEBHOOK_SECRET?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  MICROSOFT_OAUTH_CLIENT_SECRET?: string;
  CLOUDFLARE_BILLING_TOKEN?: string;
  // WORKER_SECRETS_END

  // Shared Secrets Store bindings: the shell gates /admin with WG_OPS_TOKEN; derived session keys use WG_SESSION_KEY.
  WG_OPS_TOKEN?: SecretsStoreSecret | string;
  WG_SESSION_KEY?: SecretsStoreSecret | string;

  // The public wg-github-app identity; wg-edge githubAppToken signs with GITHUB_APP_PRIVATE_KEY.
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  MICROSOFT_OAUTH_CLIENT_ID?: string;
  MICROSOFT_TENANT_ID?: string;
  SAML_IDP_CERT?: string;
  SAML_IDP_ISSUER?: string;
  SAML_SSO_URL?: string;
  DEPLOYED_VERSION?: string;
  DEPLOYED_SHA?: string;
  DEPLOYMENT_ENVIRONMENT?: string;
  DEPLOYMENT_CI_STATUS?: string;
  BILLING_DEMO_MONTHLY_BUDGET_USD?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_WORKER_NAME?: string;
  CLOUDFLARE_R2_BUCKET?: string;
  CLOUDFLARE_D1_DATABASE_ID?: string;
  CLOUDFLARE_DO_NAMESPACE?: string;
  CLOUDFLARE_BILLABLE_USAGE?: 'not-offered';
}

export type DemoStatus = 'working' | 'planned';

export interface DemoAction {
  id?: string;
  title?: string;
  description?: string;
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface DemoDefinition {
  id: string;
  route?: string;
  title: string;
  group: string;
  sourcePath: string;
  summary: string;
  notice?: string;
  proves: string[];
  status: DemoStatus;
  sections?: Array<{
    id: string;
    title: string;
    description: string;
    points?: string[];
  }>;
  interfaces?: Array<{
    method: string;
    path: string;
    description: string;
  }>;
  supportingSources?: Array<{
    label: string;
    path: string;
  }>;
  action?: DemoAction;
  actions?: DemoAction[];
  repositoryLinks?: Array<{
    label: string;
    path: string;
  }>;
}
