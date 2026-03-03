// ─── Simulated Org Database & Credential Store ──────────────────────────────
//
// Layer 2: Which bundles each org has enabled (simulated database)
// Layer 3: Per-org, per-bundle credentials (lazy-loaded on first tool call)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrgConfig {
  id: string;
  name: string;
  enabledBundles: string[];
}

export interface BundleCredentials {
  token: string;
  [key: string]: string;
}

// ─── Layer 2: Org Integrations ───────────────────────────────────────────────

const ORGS: Record<string, OrgConfig> = {
  acme: {
    id: "acme",
    name: "Acme Corp",
    enabledBundles: ["github", "slack"],
  },
  globex: {
    id: "globex",
    name: "Globex Inc",
    enabledBundles: ["github", "jira"],
  },
  initech: {
    id: "initech",
    name: "Initech Ltd",
    enabledBundles: ["github"],
  },
};

// ─── Layer 3: Session Credentials ────────────────────────────────────────────

const CREDENTIAL_STORE: Record<string, Record<string, BundleCredentials>> = {
  acme: {
    github: { token: "ghp_acme_a1b2c3", org: "acme-corp" },
    slack: { token: "xoxb-acme_s1s2s3", workspace: "acme-hq" },
  },
  globex: {
    github: { token: "ghp_globex_d4e5f6", org: "globex-inc" },
    jira: { token: "jira_globex_j1j2j3", site: "globex.atlassian.net" },
  },
  initech: {
    github: { token: "ghp_initech_g7h8i9", org: "initech-ltd" },
  },
};

// ─── Accessors ───────────────────────────────────────────────────────────────

export function getOrg(orgId: string): OrgConfig | undefined {
  return ORGS[orgId];
}

export function listOrgs(): OrgConfig[] {
  return Object.values(ORGS);
}

export function getCredentials(orgId: string, bundleName: string): BundleCredentials | undefined {
  const creds = CREDENTIAL_STORE[orgId]?.[bundleName];
  if (creds) {
    console.log(`  🔑 Lazy-loading credentials: ${orgId}/${bundleName}`);
  }
  return creds;
}
