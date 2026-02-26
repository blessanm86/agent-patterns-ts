import type { KBDocument } from "./types.js";

// ─── NexusDB Knowledge Base ─────────────────────────────────────────────────
//
// 12 documentation pages for a fictional database called NexusDB.
// Every detail is invented — port numbers, CLI commands, config keys —
// so hallucination is easily detectable: if the LLM says something that
// isn't in these docs, it made it up.

export const documents: KBDocument[] = [
  {
    id: "getting-started",
    title: "Getting Started with NexusDB",
    content: `# Getting Started with NexusDB

## Installation

NexusDB is available as a single binary for Linux, macOS, and Windows.

\`\`\`bash
curl -fsSL https://get.nexusdb.io | sh
\`\`\`

This installs the \`nexus-cli\` command-line tool and the \`nexusd\` server daemon.

## Starting the Server

Start NexusDB with the default configuration:

\`\`\`bash
nexusd start
\`\`\`

By default, NexusDB listens on port **9242** and stores data in \`/var/lib/nexusdb/data\`. The admin UI is available at \`http://localhost:9242/admin\`.

## Your First Database

Create a database and insert a record:

\`\`\`bash
nexus-cli create-db myapp
nexus-cli insert myapp users '{"name": "Alice", "email": "alice@example.com"}'
nexus-cli query myapp "FROM users SELECT *"
\`\`\`

## System Requirements

- **CPU:** 2+ cores recommended
- **RAM:** Minimum 512 MB, recommended 4 GB for production
- **Disk:** SSD strongly recommended, minimum 1 GB free space
- **OS:** Linux (kernel 4.15+), macOS 12+, Windows 10+`,
  },
  {
    id: "configuration",
    title: "NexusDB Configuration Reference",
    content: `# NexusDB Configuration Reference

## Config File Location

NexusDB reads its configuration from \`/etc/nexusdb/nexus.conf\` by default. Override with the \`--config\` flag:

\`\`\`bash
nexusd start --config /path/to/nexus.conf
\`\`\`

## Core Settings

| Key | Default | Description |
|-----|---------|-------------|
| \`server.port\` | \`9242\` | TCP port for client connections |
| \`server.bind_address\` | \`0.0.0.0\` | Network interface to bind |
| \`server.max_connections\` | \`1024\` | Maximum concurrent client connections |
| \`storage.data_dir\` | \`/var/lib/nexusdb/data\` | Root directory for data files |
| \`storage.wal_dir\` | \`/var/lib/nexusdb/wal\` | Write-ahead log directory |
| \`storage.cache_size_mb\` | \`256\` | In-memory page cache size |
| \`storage.compaction_interval\` | \`3600\` | Seconds between automatic compactions |

## Logging

| Key | Default | Description |
|-----|---------|-------------|
| \`logging.level\` | \`info\` | Log level: debug, info, warn, error |
| \`logging.file\` | \`/var/log/nexusdb/nexus.log\` | Log file path |
| \`logging.max_size_mb\` | \`100\` | Max log file size before rotation |
| \`logging.max_files\` | \`5\` | Number of rotated log files to keep |

## Example Configuration

\`\`\`toml
[server]
port = 9242
bind_address = "0.0.0.0"
max_connections = 2048

[storage]
data_dir = "/data/nexusdb"
cache_size_mb = 512
compaction_interval = 1800

[logging]
level = "info"
file = "/var/log/nexusdb/nexus.log"
\`\`\``,
  },
  {
    id: "nql-query-syntax",
    title: "NQL Query Syntax",
    content: `# NQL — NexusDB Query Language

NQL is the query language for NexusDB. It uses a pipe-based syntax inspired by log query languages.

## Basic Syntax

\`\`\`
FROM <collection> [WHERE <condition>] [SELECT <fields>] [ORDER BY <field> <dir>] [LIMIT <n>]
\`\`\`

## Examples

Select all users:
\`\`\`
FROM users SELECT *
\`\`\`

Filter with conditions:
\`\`\`
FROM orders WHERE status = "shipped" AND total > 100 SELECT id, customer, total
\`\`\`

Sort and limit:
\`\`\`
FROM products ORDER BY price DESC LIMIT 10
\`\`\`

## Aggregations

NQL supports five aggregation functions: \`COUNT\`, \`SUM\`, \`AVG\`, \`MIN\`, \`MAX\`.

\`\`\`
FROM orders WHERE status = "completed" SELECT COUNT(*) AS order_count, SUM(total) AS revenue
\`\`\`

Group by:
\`\`\`
FROM orders GROUP BY customer SELECT customer, COUNT(*) AS orders, AVG(total) AS avg_spend
\`\`\`

## Nested Fields

Access nested JSON fields with dot notation:

\`\`\`
FROM users WHERE address.city = "Portland" SELECT name, address.zip
\`\`\`

## Full-Text Search

Use the \`MATCH\` operator for full-text search on indexed fields:

\`\`\`
FROM articles WHERE MATCH(body, "distributed consensus") SELECT title, score()
\`\`\`

The \`score()\` function returns the relevance score for full-text matches.`,
  },
  {
    id: "indexing",
    title: "Indexing in NexusDB",
    content: `# Indexing in NexusDB

## Index Types

NexusDB supports four index types:

1. **B-Tree Index** — Default for scalar fields. Best for equality and range queries.
2. **Hash Index** — Fastest for exact-match lookups. Cannot do range queries.
3. **Full-Text Index** — Inverted index for text search with BM25 ranking.
4. **Geo Index** — R-tree index for spatial queries (point-in-polygon, nearest neighbor).

## Creating Indexes

\`\`\`bash
nexus-cli create-index myapp users email --type btree
nexus-cli create-index myapp articles body --type fulltext
nexus-cli create-index myapp locations coords --type geo
\`\`\`

Or via NQL:

\`\`\`
CREATE INDEX idx_users_email ON users(email) USING BTREE
CREATE INDEX idx_articles_body ON articles(body) USING FULLTEXT
\`\`\`

## Index Management

List indexes:
\`\`\`bash
nexus-cli list-indexes myapp users
\`\`\`

Drop an index:
\`\`\`bash
nexus-cli drop-index myapp idx_users_email
\`\`\`

## Index Statistics

Check index health and size:
\`\`\`bash
nexus-cli index-stats myapp idx_users_email
\`\`\`

Output:
\`\`\`
Index: idx_users_email
Type: btree
Collection: users
Field: email
Entries: 1,247,832
Size: 48 MB
Fragmentation: 3.2%
Last rebuilt: 2025-01-15T08:30:00Z
\`\`\`

## Auto-Indexing

Enable automatic index creation for frequently queried fields:

\`\`\`toml
[indexing]
auto_index = true
auto_index_threshold = 100  # queries before auto-creating an index
\`\`\``,
  },
  {
    id: "replication",
    title: "Replication and Clustering",
    content: `# Replication and Clustering

## Replication Modes

NexusDB supports two replication modes:

1. **Leader-Follower** — One writable leader, N read-only followers. Default mode.
2. **Multi-Leader** — Multiple writable nodes with conflict resolution. For geo-distributed deployments.

## Setting Up Leader-Follower

On the leader node (\`nexus.conf\`):
\`\`\`toml
[replication]
mode = "leader-follower"
role = "leader"
replication_port = 9243
\`\`\`

On each follower:
\`\`\`toml
[replication]
mode = "leader-follower"
role = "follower"
leader_address = "leader-host:9243"
sync_interval_ms = 500
\`\`\`

## Replication Lag

Monitor replication lag with:
\`\`\`bash
nexus-cli replication-status
\`\`\`

Output:
\`\`\`
Node: follower-1
  Status: syncing
  Lag: 120ms
  WAL position: 847293 / 847310
\`\`\`

## Multi-Leader Conflict Resolution

Multi-leader mode uses **last-write-wins (LWW)** by default. Configure custom resolution:

\`\`\`toml
[replication]
mode = "multi-leader"
conflict_resolution = "lww"  # options: lww, custom
\`\`\`

For custom resolution, register a conflict handler:
\`\`\`bash
nexus-cli register-handler myapp conflict_resolver ./handlers/resolve.js
\`\`\`

## Cluster Health

\`\`\`bash
nexus-cli cluster-status
\`\`\`

Shows all nodes, their roles, connection status, and replication lag.`,
  },
  {
    id: "security",
    title: "Security and Authentication",
    content: `# Security and Authentication

## Authentication

NexusDB supports three authentication methods:

1. **API Key** — Simple key-based auth for services. Default method.
2. **Username/Password** — For interactive users and the admin UI.
3. **mTLS** — Mutual TLS for zero-trust environments.

## API Key Management

Generate an API key:
\`\`\`bash
nexus-cli create-api-key --name "backend-service" --permissions read,write
\`\`\`

Output:
\`\`\`
Key: nxk_a1b2c3d4e5f6g7h8i9j0
Name: backend-service
Permissions: read, write
Created: 2025-02-01T10:00:00Z
\`\`\`

Use the key in requests:
\`\`\`bash
nexus-cli query myapp "FROM users SELECT *" --api-key nxk_a1b2c3d4e5f6g7h8i9j0
\`\`\`

## Role-Based Access Control (RBAC)

Built-in roles:
- \`admin\` — Full access to all databases and settings
- \`readwrite\` — Read and write to assigned databases
- \`readonly\` — Read-only access to assigned databases
- \`monitor\` — View cluster status and metrics only

Create a user with a role:
\`\`\`bash
nexus-cli create-user --name "analyst" --password "secure123" --role readonly --database myapp
\`\`\`

## Encryption

Enable encryption at rest:
\`\`\`toml
[security]
encryption_at_rest = true
encryption_key_file = "/etc/nexusdb/encryption.key"
\`\`\`

TLS for client connections:
\`\`\`toml
[security]
tls_enabled = true
tls_cert = "/etc/nexusdb/server.crt"
tls_key = "/etc/nexusdb/server.key"
\`\`\``,
  },
  {
    id: "api-reference",
    title: "HTTP API Reference",
    content: `# HTTP API Reference

NexusDB exposes a REST API on the same port as the server (default 9242).

## Base URL

\`\`\`
http://localhost:9242/api/v1
\`\`\`

## Authentication

Include the API key in the \`Authorization\` header:
\`\`\`
Authorization: Bearer nxk_your_api_key_here
\`\`\`

## Endpoints

### Query
\`\`\`
POST /api/v1/query
Content-Type: application/json

{
  "database": "myapp",
  "query": "FROM users WHERE age > 25 SELECT name, email"
}
\`\`\`

### Insert
\`\`\`
POST /api/v1/insert
Content-Type: application/json

{
  "database": "myapp",
  "collection": "users",
  "document": {"name": "Bob", "email": "bob@example.com", "age": 30}
}
\`\`\`

### Bulk Insert
\`\`\`
POST /api/v1/bulk-insert
Content-Type: application/json

{
  "database": "myapp",
  "collection": "users",
  "documents": [
    {"name": "Charlie", "age": 28},
    {"name": "Diana", "age": 35}
  ]
}
\`\`\`

Maximum batch size: **10,000 documents** per request.

### Delete
\`\`\`
DELETE /api/v1/documents
Content-Type: application/json

{
  "database": "myapp",
  "collection": "users",
  "filter": {"email": "bob@example.com"}
}
\`\`\`

### Database Management
\`\`\`
POST   /api/v1/databases          # Create database
GET    /api/v1/databases          # List databases
DELETE /api/v1/databases/:name    # Drop database
\`\`\`

## Rate Limiting

The API enforces a default rate limit of **1,000 requests per minute** per API key. Configure in \`nexus.conf\`:

\`\`\`toml
[api]
rate_limit_rpm = 1000
rate_limit_burst = 50
\`\`\``,
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting Guide",
    content: `# Troubleshooting Guide

## Common Issues

### Server Won't Start

**Symptom:** \`nexusd start\` exits immediately.

**Check the log file:**
\`\`\`bash
tail -f /var/log/nexusdb/nexus.log
\`\`\`

**Common causes:**
1. **Port already in use:** Another process is using port 9242. Change \`server.port\` in config or stop the conflicting process.
2. **Insufficient permissions:** \`nexusd\` needs write access to \`storage.data_dir\` and \`storage.wal_dir\`.
3. **Corrupt WAL:** If the server crashed, the WAL may be corrupt. Run \`nexus-cli repair-wal\` to attempt recovery.

### Slow Queries

**Symptom:** Queries take more than 500ms.

**Diagnosis steps:**
1. Run \`EXPLAIN\` to check the query plan:
   \`\`\`
   EXPLAIN FROM orders WHERE customer_id = "abc123" SELECT *
   \`\`\`
2. Check if the filtered field is indexed: \`nexus-cli list-indexes myapp orders\`
3. Check compaction status: \`nexus-cli compaction-status myapp\`
4. Monitor cache hit rate: \`nexus-cli stats myapp --metric cache_hit_rate\`

A cache hit rate below 80% usually means \`storage.cache_size_mb\` is too low.

### Out of Memory

**Symptom:** \`nexusd\` killed by OOM killer.

**Solutions:**
1. Reduce \`storage.cache_size_mb\` — the page cache is the largest memory consumer
2. Set \`server.max_connections\` lower — each connection uses ~2 MB
3. Enable \`storage.memory_limit_mb\` to cap total memory usage:
   \`\`\`toml
   [storage]
   memory_limit_mb = 2048
   \`\`\`

### Connection Refused

**Symptom:** Clients get "connection refused" errors.

**Check:**
1. Is \`nexusd\` running? \`nexus-cli ping\`
2. Is it listening on the expected port? \`nexus-cli server-info\`
3. Are max connections reached? \`nexus-cli stats --metric active_connections\``,
  },
  {
    id: "migrations",
    title: "Schema Migrations",
    content: `# Schema Migrations

## Overview

NexusDB is schema-flexible by default — you can insert any JSON document without declaring a schema. However, for production use, you can enforce schemas and manage migrations.

## Enabling Schema Enforcement

\`\`\`bash
nexus-cli set-schema myapp users '{
  "name": {"type": "string", "required": true},
  "email": {"type": "string", "required": true, "unique": true},
  "age": {"type": "integer"},
  "created_at": {"type": "timestamp", "default": "now()"}
}'
\`\`\`

Once a schema is set, inserts that don't match are rejected with a \`SCHEMA_VIOLATION\` error.

## Migration Files

Migrations live in a \`migrations/\` directory and are numbered sequentially:

\`\`\`
migrations/
  001_create_users.nql
  002_add_email_index.nql
  003_add_orders_collection.nql
\`\`\`

Each file contains NQL statements:
\`\`\`
-- 002_add_email_index.nql
CREATE INDEX idx_users_email ON users(email) USING BTREE;
\`\`\`

## Running Migrations

\`\`\`bash
nexus-cli migrate myapp ./migrations
\`\`\`

NexusDB tracks which migrations have run in an internal \`_migrations\` collection. It never re-runs a completed migration.

## Rollback

\`\`\`bash
nexus-cli migrate-rollback myapp --steps 1
\`\`\`

Each migration can have a companion \`.rollback.nql\` file:
\`\`\`
-- 002_add_email_index.rollback.nql
DROP INDEX idx_users_email;
\`\`\`

## Best Practices

1. **Never modify a deployed migration** — create a new one instead
2. **Test migrations on a copy** — use \`nexus-cli clone-db myapp myapp_staging\` first
3. **Keep migrations small** — one change per file
4. **Always write rollbacks** for production databases`,
  },
  {
    id: "performance-tuning",
    title: "Performance Tuning",
    content: `# Performance Tuning

## Key Metrics

Monitor these metrics for optimal performance:

\`\`\`bash
nexus-cli stats myapp --metric all
\`\`\`

| Metric | Healthy Range | Description |
|--------|--------------|-------------|
| \`cache_hit_rate\` | > 85% | Page cache effectiveness |
| \`query_p99_ms\` | < 200ms | 99th percentile query latency |
| \`wal_sync_ms\` | < 10ms | WAL flush latency |
| \`compaction_debt\` | < 5 | Pending compaction levels |
| \`active_connections\` | < 80% of max | Connection pool usage |

## Cache Tuning

The page cache is the single most impactful performance knob.

**Rule of thumb:** Set \`cache_size_mb\` to 25-50% of available RAM.

\`\`\`toml
[storage]
cache_size_mb = 2048  # 2 GB for an 8 GB machine
\`\`\`

## Write Performance

For write-heavy workloads:

\`\`\`toml
[storage]
wal_sync_mode = "batch"       # batch WAL syncs (default: "immediate")
wal_batch_interval_ms = 10    # flush every 10ms
compaction_interval = 1800    # compact every 30 min
\`\`\`

**Warning:** \`wal_sync_mode = "batch"\` can lose up to \`wal_batch_interval_ms\` of writes on crash.

## Read Performance

For read-heavy workloads:

1. **Add indexes** on frequently filtered fields
2. **Increase cache** — cache misses are 100x slower than hits
3. **Use read replicas** — spread read traffic across followers
4. **Enable query plan caching:**
   \`\`\`toml
   [query]
   plan_cache_size = 1000
   \`\`\`

## Compaction

NexusDB uses LSM-tree storage. Regular compaction is essential:

\`\`\`bash
# Manual compaction
nexus-cli compact myapp

# Check compaction status
nexus-cli compaction-status myapp
\`\`\`

If \`compaction_debt\` stays above 5, reduce \`compaction_interval\` or run manual compaction.`,
  },
  {
    id: "backup-restore",
    title: "Backup and Restore",
    content: `# Backup and Restore

## Backup Types

NexusDB supports two backup strategies:

1. **Snapshot Backup** — Full point-in-time copy. Larger but self-contained.
2. **Incremental Backup** — Only changes since last backup. Smaller but requires the base snapshot.

## Creating a Snapshot

\`\`\`bash
nexus-cli backup myapp --type snapshot --output /backups/myapp-2025-02-01.nxb
\`\`\`

The \`.nxb\` file contains all data, indexes, and schemas. The server remains available during backup (uses consistent snapshot isolation).

## Incremental Backups

\`\`\`bash
# First: create a base snapshot
nexus-cli backup myapp --type snapshot --output /backups/myapp-base.nxb

# Later: create incremental backups
nexus-cli backup myapp --type incremental --base /backups/myapp-base.nxb --output /backups/myapp-incr-001.nxb
\`\`\`

## Restoring

Restore from a snapshot:
\`\`\`bash
nexus-cli restore --input /backups/myapp-2025-02-01.nxb --database myapp_restored
\`\`\`

Restore with incremental:
\`\`\`bash
nexus-cli restore --input /backups/myapp-base.nxb --incremental /backups/myapp-incr-001.nxb --database myapp_restored
\`\`\`

## Automated Backups

Configure in \`nexus.conf\`:

\`\`\`toml
[backup]
enabled = true
schedule = "0 2 * * *"         # daily at 2 AM (cron syntax)
type = "incremental"
base_snapshot_interval = 7     # full snapshot every 7 days
output_dir = "/backups/nexusdb"
retention_days = 30
\`\`\`

## Verifying Backups

Always verify after backup:
\`\`\`bash
nexus-cli verify-backup /backups/myapp-2025-02-01.nxb
\`\`\`

Output:
\`\`\`
Backup: myapp-2025-02-01.nxb
Status: valid
Collections: 8
Documents: 2,847,293
Size: 1.2 GB
Checksum: sha256:a1b2c3...
\`\`\``,
  },
  {
    id: "data-types",
    title: "Data Types and Schema",
    content: `# Data Types and Schema

## Supported Data Types

NexusDB stores documents as JSON internally but supports typed fields for schemas and indexes:

| Type | Description | Example |
|------|-------------|---------|
| \`string\` | UTF-8 text, max 16 MB | \`"hello world"\` |
| \`integer\` | 64-bit signed integer | \`42\` |
| \`float\` | 64-bit IEEE 754 | \`3.14\` |
| \`boolean\` | True or false | \`true\` |
| \`timestamp\` | ISO 8601 with timezone | \`"2025-02-01T10:30:00Z"\` |
| \`array\` | Ordered list of values | \`[1, 2, 3]\` |
| \`object\` | Nested JSON object | \`{"key": "value"}\` |
| \`binary\` | Base64-encoded binary data | \`"data:base64,..."\` |
| \`null\` | Explicit null value | \`null\` |
| \`geo_point\` | Latitude/longitude pair | \`{"lat": 45.5, "lon": -122.6}\` |

## Schema Definition

\`\`\`bash
nexus-cli set-schema myapp products '{
  "name": {"type": "string", "required": true},
  "price": {"type": "float", "required": true, "min": 0},
  "category": {"type": "string", "enum": ["electronics", "clothing", "food"]},
  "tags": {"type": "array", "items": {"type": "string"}},
  "metadata": {"type": "object"},
  "location": {"type": "geo_point"},
  "created_at": {"type": "timestamp", "default": "now()"}
}'
\`\`\`

## Type Coercion

NexusDB performs automatic type coercion in queries:
- Strings that look like numbers are coerced for numeric comparisons
- ISO 8601 strings are coerced to timestamps
- \`"true"\`/\`"false"\` strings are coerced to booleans

Disable coercion with strict mode:
\`\`\`toml
[query]
strict_types = true
\`\`\`

## Collection Size Limits

- Maximum document size: **16 MB**
- Maximum collection count per database: **10,000**
- Maximum field nesting depth: **32 levels**
- Maximum fields per document: **2,000**`,
  },
];
