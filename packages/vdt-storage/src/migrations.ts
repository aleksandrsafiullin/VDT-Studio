import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  assertDensePlainJson,
  assertExactKeys,
  assertSha256,
  canonicalizeJson,
  hashFramed,
  isPlainRecord
} from "./canonical";
import { assertInside } from "./project-files";
import {
  loadVerifiedSequence3Assets,
  type VerifiedSequence3Assets
} from "./sequence-3-assets";
import {
  validateLegacyAgentRunsForSequence3,
  type Sequence3MigrationIdentity,
  type Sequence3TransformAccepted
} from "./sequence-3-transform";
import type {
  JsonValue,
  Sha256,
  StorageMigrationFaultContext,
  StorageMigrationFaultPoint,
  StorageMigrationManifestEntryV1,
  StorageMigrationManifestV1
} from "./types";
import { VdtStorageError } from "./types";

export const EMPTY_SCHEMA_HASH =
  "sha256:c0e1e0f6e95438816ce50759cd743dde638aef811801cedbc327ad50e2b8fa5b" as const;
export const LEGACY_V1_SCHEMA_HASH =
  "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748" as const;
export const ATOMIC_REVISION_SCHEMA_HASH =
  "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02" as const;

const EXPECTED_SEQUENCE_1_CHECKSUM =
  "sha256:eed70d7619cdccb8aa6137d215704863e8419191e809ef94153b593e9f8b6df2";
const EXPECTED_SEQUENCE_2_CHECKSUM =
  "sha256:581d35e2d660d40d51a1405997c11aac0337ca77dbeccabaf40deb8aa6098eea";
const EXPECTED_MANIFEST_HASH =
  "sha256:f36158d9e2783a8cd1a9bd41f7d22da1d425a296dec95c8d272bb8fd789686ad";
const EXPECTED_SEQUENCE_3_MANIFEST_HASH =
  "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8";
const EXPECTED_SEQUENCE_3_CHECKSUM =
  "sha256:c9b7ce6486a50024259e53f34a7f4a1750544c442b75df310a55c03e5f8d3e0f";
const EXPECTED_SEQUENCE_3_POSTCONDITION_SCHEMA_HASH =
  "sha256:c4206299c5399b4ee113c920f02af650aa39ad6af452f5c46330dcec10adbb5a";
const SEQUENCE_3_MIGRATION_ID =
  "003-durable-agent-run-coordination" as const;

const SEQUENCE_1_SQL = readMigrationSql(
  new URL("./migrations/001-legacy-v1-bootstrap.sql", import.meta.url)
);
const SEQUENCE_2_SQL = readMigrationSql(
  new URL("./migrations/002-atomic-revisions.sql", import.meta.url)
);

const ENTRIES: StorageMigrationManifestEntryV1[] = [
  manifestEntry({
    sequence: 1,
    migrationId: "001-legacy-v1-bootstrap",
    fromUserVersion: 0,
    toUserVersion: 1,
    preconditionSchemaHash: EMPTY_SCHEMA_HASH,
    postconditionSchemaHash: LEGACY_V1_SCHEMA_HASH,
    sqlBytes: SEQUENCE_1_SQL,
    expectedChecksum: EXPECTED_SEQUENCE_1_CHECKSUM
  }),
  manifestEntry({
    sequence: 2,
    migrationId: "002-atomic-revisions",
    fromUserVersion: 1,
    toUserVersion: 2,
    preconditionSchemaHash: LEGACY_V1_SCHEMA_HASH,
    postconditionSchemaHash: ATOMIC_REVISION_SCHEMA_HASH,
    sqlBytes: SEQUENCE_2_SQL,
    expectedChecksum: EXPECTED_SEQUENCE_2_CHECKSUM
  })
];

const MANIFEST_WITHOUT_HASH = {
  schemaVersion: "migration_manifest.v1" as const,
  manifestVersion: 1,
  entries: ENTRIES
};
const computedManifestHash = hashFramed(
  "vdt-studio/migration-manifest",
  "migration_manifest_hash.v1",
  MANIFEST_WITHOUT_HASH as unknown as JsonValue
);
if (computedManifestHash !== EXPECTED_MANIFEST_HASH) {
  throw new Error(
    `Immutable storage migration manifest drifted: expected ${EXPECTED_MANIFEST_HASH}, got ${computedManifestHash}.`
  );
}

export const STORAGE_MIGRATION_MANIFEST: StorageMigrationManifestV1 = Object.freeze({
  ...MANIFEST_WITHOUT_HASH,
  manifestHash: EXPECTED_MANIFEST_HASH as Sha256,
  entries: Object.freeze([...ENTRIES]) as unknown as StorageMigrationManifestEntryV1[]
});

export interface StorageMigrationFixtureEntryV1 {
  sequence: number;
  migrationId: string;
  fromUserVersion: number;
  toUserVersion: number;
  preconditionSchemaHash: Sha256;
  postconditionSchemaHash: Sha256;
  sqlBytes: Buffer;
  expectedChecksum: Sha256;
}

export interface StorageMigrationTestPlan {
  readonly manifest: StorageMigrationManifestV1;
  readonly targetSequence: number;
  readonly targetUserVersion: number;
}

interface PlannedMigrationEntry {
  readonly manifestEntry: StorageMigrationManifestEntryV1;
  readonly sqlBytes: Buffer;
}

interface ValidatedStorageMigrationPlanBase {
  readonly entries: readonly PlannedMigrationEntry[];
  readonly prefixHashes: readonly Sha256[];
  readonly prefixSequenceByHash: ReadonlyMap<Sha256, number>;
  readonly targetSequence: number;
  readonly targetUserVersion: number;
}

interface ValidatedStorageMigrationTestPlan
  extends ValidatedStorageMigrationPlanBase,
    StorageMigrationTestPlan {
  readonly planKind: "v1-test";
  readonly sequence3Assets?: undefined;
}

interface ValidatedStorageProductionPlanV2
  extends ValidatedStorageMigrationPlanBase {
  readonly planKind: "v2-production";
  readonly targetManifestHash: Sha256;
  readonly historicalPrefixManifestHash: Sha256;
  readonly sequence3Assets: VerifiedSequence3Assets;
}

type ValidatedStorageMigrationPlan =
  | ValidatedStorageMigrationTestPlan
  | ValidatedStorageProductionPlanV2;

const validatedMigrationPlans = new WeakSet<object>();
const BOOTSTRAP_MIGRATION_PLAN = createValidatedMigrationPlan(
  [],
  EXPECTED_MANIFEST_HASH as Sha256
);
let retainedProductionMigrationPlan:
  | ValidatedStorageProductionPlanV2
  | undefined;

export function __createStorageMigrationPlanForTests(input: {
  entries: StorageMigrationFixtureEntryV1[];
  expectedManifestHash: Sha256;
}): StorageMigrationTestPlan {
  return createValidatedMigrationPlan(input.entries, input.expectedManifestHash);
}

export function resolveStorageMigrationAssetPath(
  assetReference: { toString(): string },
  bundledModuleDirectory = currentBundledModuleDirectory()
): string {
  const serialized = String(assetReference);
  if (serialized.startsWith("file:")) {
    return fileURLToPath(serialized);
  }

  const assetName = path.basename(serialized.replace(/[?#].*$/, ""));
  if (
    !bundledModuleDirectory ||
    !/^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[0-9a-f]+)?\.sql$/.test(
      assetName
    )
  ) {
    throw new TypeError(`Unsupported bundled storage migration asset: ${serialized}.`);
  }
  // Next App Router places API route modules deep under `.next/server/app/...`
  // while Webpack emits SQL assets at `.next/server/static/media/`. Walk up
  // from the emitting module until that media file is found.
  let current = bundledModuleDirectory;
  for (;;) {
    const candidate = path.join(current, "static", "media", assetName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.join(
    bundledModuleDirectory,
    "static",
    "media",
    assetName
  );
}

function readMigrationSql(assetReference: { toString(): string }): Buffer {
  return fs.readFileSync(resolveStorageMigrationAssetPath(assetReference));
}

function currentBundledModuleDirectory(): string | undefined {
  return typeof __dirname === "string" ? __dirname : undefined;
}

interface MigrationBootstrapJournal {
  schemaVersion: "migration_bootstrap_journal.v1";
  journalId: string;
  journalGeneration: number;
  previousJournalHash: Sha256 | null;
  journalHash: Sha256;
  databaseId: string;
  targetManifestHash: Sha256;
  ownerToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  nextSequence: 1 | 2;
  backupEvidence: {
    schemaVersion: "migration_backup_evidence.v1";
    backupEvidenceId: string;
    databaseId: string;
    fromUserVersion: number;
    manifestHash: Sha256;
    sourceDatabaseHash: Sha256;
    backupHash: Sha256;
    backupRelativePath: string;
    createdAt: string;
  };
  attemptStartedAt: string;
  state: "backed_up";
  relativePath: string;
}

interface LegacyRevisionEvidence {
  projectId: string;
  vdtId: string;
  revisionId: string;
  revisionNo: number;
  fileRelativePath: string;
  rawGraphHash: string;
  payloadByteLength: number;
}

interface LegacyVdtEvidence {
  projectId: string;
  vdtId: string;
  activeRevisionId: string | null;
  activeGraphHash: string | null;
  commitGeneration: number;
}

export interface StorageMigrationOptions {
  now: () => string;
  busyTimeoutMs: number;
  leaseMs: number;
  idFactory?: (() => string) | undefined;
  ownerTokenFactory?: (() => string) | undefined;
  faultInjector?:
    | ((
        point: StorageMigrationFaultPoint,
        context?: StorageMigrationFaultContext
      ) => void)
    | undefined;
}

interface MigrationForeignKeyViolationV1 {
  table: string;
  rowIdDecimal: string | null;
  parent: string;
  foreignKeyIndex: number;
}

interface MigrationForeignKeyCheckIdentityV1 {
  schemaVersion: "migration_foreign_key_check_identity.v1";
  databaseId: string;
  attemptId: string;
  fenceOwnerToken: string;
  fenceLeaseGeneration: number;
  targetManifestHash: Sha256;
  sequence: number;
  migrationId: string;
}

interface MigrationForeignKeyPendingLatchV1 {
  schemaVersion: "migration_foreign_key_pending_latch.v1";
  identity: MigrationForeignKeyCheckIdentityV1;
  identityHash: Sha256;
  createdAt: string;
  pendingLatchHash: Sha256;
}

interface MigrationForeignKeyCheckEvidenceV1 {
  schemaVersion: "migration_foreign_key_check_evidence.v1";
  identity: MigrationForeignKeyCheckIdentityV1;
  identityHash: Sha256;
  pendingLatchHash: Sha256;
  violationCount: number;
  violations: MigrationForeignKeyViolationV1[];
  truncated: boolean;
  createdAt: string;
  evidenceHash: Sha256;
}

interface PreparedMigrationForeignKeyPendingLatch {
  latch: MigrationForeignKeyPendingLatchV1;
  path: string;
  fileIdentity?: MigrationForeignKeyFilesystemIdentity;
}

interface MigrationForeignKeyRecoveryPair {
  pending: MigrationForeignKeyPendingLatchV1;
  evidence: MigrationForeignKeyCheckEvidenceV1;
}

interface MigrationForeignKeyFilesystemIdentity {
  device: bigint;
  inode: bigint;
  owner: bigint;
  mode: bigint;
  size: bigint;
  linkCount: bigint;
}

interface MigrationForeignKeyBlockDirectoryHandle {
  path: string;
  descriptor: number;
  effectiveUid: bigint;
  identity: MigrationForeignKeyFilesystemIdentity;
}

type MigrationStateBlockedReasonV1 =
  | "applied_prefix_mismatch"
  | "checksum_mismatch"
  | "precondition_failed"
  | "postcondition_failed"
  | "backup_failed";

interface LaterMigrationPreconditionFailure {
  diagnostic: string;
  blockedReason: Extract<
    MigrationStateBlockedReasonV1,
    "applied_prefix_mismatch" | "precondition_failed"
  >;
}

class MigrationForeignKeyCheckError extends Error {
  constructor(
    readonly violations: readonly MigrationForeignKeyViolationV1[],
    readonly pending: PreparedMigrationForeignKeyPendingLatch
  ) {
    super("Migration transaction failed PRAGMA foreign_key_check.");
    this.name = "MigrationForeignKeyCheckError";
  }
}

type MigrationBlockedWithEvidence = Error & {
  migrationBlockReason?: MigrationStateBlockedReasonV1;
};

export function runStorageMigrations(
  db: DatabaseSync,
  dataDir: string,
  options: StorageMigrationOptions
): void {
  runStorageMigrationsForPlatform(
    db,
    dataDir,
    options,
    process.platform
  );
}

/** Test-only admission seam; it is intentionally absent from the package entrypoint. */
export function __runStorageMigrationsForPlatformTests(
  db: DatabaseSync,
  dataDir: string,
  options: StorageMigrationOptions,
  platform: NodeJS.Platform
): void {
  runStorageMigrationsForPlatform(db, dataDir, options, platform);
}

function runStorageMigrationsForPlatform(
  db: DatabaseSync,
  dataDir: string,
  options: StorageMigrationOptions,
  platform: NodeJS.Platform
): void {
  assertSequence3PlatformCapability(platform);
  let plan: ValidatedStorageProductionPlanV2;
  try {
    const assets = loadVerifiedSequence3Assets();
    plan = productionMigrationPlan(assets);
  } catch (error) {
    if (
      error instanceof VdtStorageError &&
      error.code === "STORAGE_CAPABILITY_UNSUPPORTED"
    ) {
      throw error;
    }
    persistSequence3PreflightChecksumBlockWhenSafe(db, dataDir);
    throw migrationRecoveryRequired(
      "Sequence 3 runtime artifact verification failed."
    );
  }
  try {
    runStorageMigrationsWithPlan(db, dataDir, options, plan);
  } catch (error) {
    throw normalizeProductionMigrationBoundaryError(error);
  }
}

/** Test-only pure seam; production admission calls the same implementation. */
export function __assertSequence3PlatformCapabilityForTests(
  platform: NodeJS.Platform
): void {
  assertSequence3PlatformCapability(platform);
}

function assertSequence3PlatformCapability(platform: NodeJS.Platform): void {
  if (platform !== "win32") return;
  throw new VdtStorageError(
    "STORAGE_CAPABILITY_UNSUPPORTED",
    "Sequence 3 migration requires reviewed Windows no-follow directory identity and durable directory fsync support.",
    false
  );
}

export function __runStorageMigrationsWithPlanForTests(
  db: DatabaseSync,
  dataDir: string,
  options: StorageMigrationOptions,
  plan: StorageMigrationTestPlan
): void {
  if (!validatedMigrationPlans.has(plan as object)) {
    throw new TypeError("Storage migration test plan was not created by the validated plan builder.");
  }
  try {
    runStorageMigrationsWithPlan(
      db,
      dataDir,
      options,
      plan as ValidatedStorageMigrationTestPlan
    );
  } catch (error) {
    throw normalizeMigrationBoundaryError(error);
  }
}

/** Test-only immutable bootstrap seam; it is intentionally absent from the package entrypoint. */
export function __runBootstrapStorageMigrationsForTests(
  db: DatabaseSync,
  dataDir: string,
  options: StorageMigrationOptions
): void {
  try {
    runStorageMigrationsWithPlan(
      db,
      dataDir,
      options,
      BOOTSTRAP_MIGRATION_PLAN
    );
  } catch (error) {
    throw normalizeMigrationBoundaryError(error);
  }
}

function runStorageMigrationsWithPlan(
  db: DatabaseSync,
  dataDir: string,
  options: StorageMigrationOptions,
  plan: ValidatedStorageMigrationPlan
): void {
  enableAndVerifyForeignKeyEnforcement(db);
  migrationForeignKeyBlockDirectoryHasEntries(dataDir);
  positiveInteger(options.leaseMs, "migrationLeaseMs");
  if (plan.targetSequence === 2) {
    runBootstrapMigrations(db, dataDir, options);
    return;
  }

  const currentVersion = userVersion(db);
  if (currentVersion === 0 || currentVersion === 1) {
    runBootstrapMigrations(db, dataDir, options);
  }
  runLaterMigrations(db, dataDir, options, plan);
}

function runBootstrapMigrations(
  db: DatabaseSync,
  dataDir: string,
  options: StorageMigrationOptions
): void {
  positiveInteger(options.leaseMs, "migrationLeaseMs");
  const currentVersion = userVersion(db);
  const hasRecoveryArtifacts =
    migrationForeignKeyBlockDirectoryHasEntries(dataDir);
  if (currentVersion === 2 && !hasRecoveryArtifacts) {
    verifyReadyDatabase(db, dataDir);
    return;
  }
  if (
    !hasRecoveryArtifacts &&
    currentVersion !== 0 &&
    currentVersion !== 1 &&
    currentVersion !== 2
  ) {
    throw migrationBlocked(`Unsupported PRAGMA user_version=${currentVersion}.`);
  }

  db.exec(`PRAGMA busy_timeout = ${positiveInteger(options.busyTimeoutMs, "busyTimeoutMs")};`);
  db.exec("PRAGMA locking_mode = EXCLUSIVE;");
  try {
    acquireExclusiveMigrationFence(db, options.busyTimeoutMs);
    options.faultInjector?.("after_admission_fence_acquired");
    const recovery = prepareAndInspectMigrationBlockSidecars(dataDir);
    if (recovery) throw migrationForeignKeyRecoveryRequired(recovery);

    const fencedVersion = userVersion(db);
    if (fencedVersion === 2) {
      verifyReadyDatabase(db, dataDir);
      return;
    }
    if (fencedVersion !== 0 && fencedVersion !== 1) {
      throw migrationBlocked(`Unsupported fenced PRAGMA user_version=${fencedVersion}.`);
    }
    if (fencedVersion === 0) {
      const preHash = computeSchemaHash(db, 0);
      if (preHash !== EMPTY_SCHEMA_HASH) {
        throw migrationBlocked(`Fresh database schema drift: ${preHash}.`);
      }
    } else {
      verifyLegacyV1Fingerprint(db);
      verifyNoForeignKeyViolations(db);
    }

    const now = options.now();
    assertCanonicalTimestamp(now, "migration now");
    const latestJournal = readLatestValidJournal(dataDir);
    if (
      latestJournal &&
      Date.parse(latestJournal.leaseExpiresAt) > Date.parse(now)
    ) {
      throw new VdtStorageError(
        "MIGRATION_IN_PROGRESS",
        `Migration lease generation ${latestJournal.leaseGeneration} is active until ${latestJournal.leaseExpiresAt}.`,
        true
      );
    }
    const databaseId = latestJournal?.databaseId ?? `database_${id(options.idFactory)}`;
    const ownerToken = options.ownerTokenFactory?.() ?? `migration_owner_${id(options.idFactory)}`;
    const journal = createBackupAndJournal(db, dataDir, {
      databaseId,
      ownerToken,
      leaseGeneration: (latestJournal?.leaseGeneration ?? 0) + 1,
      journalGeneration: (latestJournal?.journalGeneration ?? 0) + 1,
      previousJournalHash: latestJournal?.journalHash ?? null,
      nextSequence: fencedVersion === 0 ? 1 : 2,
      now,
      leaseMs: options.leaseMs,
      idFactory: options.idFactory,
      faultInjector: options.faultInjector
    });
    verifyJournalBackup(dataDir, journal);

    if (fencedVersion === 0) {
      applySequenceOne(db, dataDir, journal, now, options);
      options.faultInjector?.("after_sequence_1_committed");
    }

    verifyLegacyV1Fingerprint(db);
    verifyNoForeignKeyViolations(db);
    verifyJournalBackup(dataDir, journal);
    const legacy = verifyLegacyRevisionState(db, dataDir);
    applySequenceTwo(
      db,
      journal,
      legacy,
      now,
      dataDir,
      options
    );
    options.faultInjector?.("after_sequence_2_committed");
    verifyReadyDatabase(db, dataDir);
  } finally {
    try {
      db.exec("PRAGMA locking_mode = NORMAL;");
    } catch {
      // Preserve the original migration failure. Closing the connection releases
      // the exclusive OS lock even when SQLite cannot switch modes here.
    }
  }
}

function acquireExclusiveMigrationFence(db: DatabaseSync, busyTimeoutMs: number): void {
  const timeout = positiveInteger(busyTimeoutMs, "busyTimeoutMs");
  const deadline = Date.now() + timeout;
  const sleeper = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  db.exec(`PRAGMA busy_timeout = ${Math.min(timeout, 100)};`);
  try {
    for (;;) {
      try {
        db.exec("BEGIN EXCLUSIVE;");
        db.exec("COMMIT;");
        db.exec(`PRAGMA busy_timeout = ${timeout};`);
        return;
      } catch (error) {
        try {
          db.exec("ROLLBACK;");
        } catch {
          // BEGIN did not acquire the fence, so there may be no transaction to roll back.
        }
        if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
        Atomics.wait(sleeper, 0, 0, Math.min(25, Math.max(1, deadline - Date.now())));
      }
    }
  } catch (error) {
    db.exec(`PRAGMA busy_timeout = ${timeout};`);
    throw error;
  }
}

function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    errcode?: unknown;
    errstr?: unknown;
    message?: unknown;
  };
  const numericCodes = [candidate.errcode, candidate.errno].filter(
    (value): value is number => typeof value === "number"
  );
  return (
    numericCodes.some(
      (value) => (value & 0xff) === 5 || (value & 0xff) === 6
    ) ||
    (typeof candidate.code === "string" &&
      /^(?:SQLITE_BUSY|SQLITE_LOCKED)(?:_|$)/.test(candidate.code)) ||
    [candidate.errstr, candidate.message].some(
      (value) =>
        typeof value === "string" &&
        /(?:SQLITE_(?:BUSY|LOCKED)|database (?:table )?is locked)/i.test(value)
    )
  );
}

function normalizeMigrationBoundaryError(error: unknown): unknown {
  if (error instanceof VdtStorageError || !isSqliteBusy(error)) return error;
  return new VdtStorageError(
    "MIGRATION_IN_PROGRESS",
    "SQLite migration state is busy or locked by another process.",
    true
  );
}

function normalizeProductionMigrationBoundaryError(error: unknown): unknown {
  if (error instanceof VdtStorageError) {
    if (
      error.code === "MIGRATION_IN_PROGRESS" ||
      error.code === "STORAGE_CAPABILITY_UNSUPPORTED"
    ) {
      return error;
    }
    if (error.code === "MIGRATION_RECOVERY_REQUIRED") {
      return migrationRecoveryRequired(
        "Sequence 3 migration state requires audited recovery."
      );
    }
    return error;
  }
  if (isSqliteBusy(error)) {
    return new VdtStorageError(
      "MIGRATION_IN_PROGRESS",
      "SQLite migration state is busy or locked by another process.",
      true
    );
  }
  return migrationRecoveryRequired(
    "Sequence 3 migration state requires audited recovery."
  );
}

function persistSequence3PreflightChecksumBlockWhenSafe(
  db: DatabaseSync,
  dataDir: string
): void {
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE;");
    transactionOpen = true;
    try {
      const verified = verifyDatabaseForPlanSnapshot(
        db,
        dataDir,
        BOOTSTRAP_MIGRATION_PLAN
      );
      if (
        verified.currentSequence !== 2 ||
        verified.currentUserVersion !== 2 ||
        verified.activeAttempt !== null
      ) {
        db.exec("ROLLBACK;");
        transactionOpen = false;
        return;
      }
      const changes = db.prepare(`
        UPDATE migration_state
        SET status = 'blocked', blocked_reason = 'checksum_mismatch'
        WHERE database_id = ? AND schema_version = 'migration_state.v1'
          AND manifest_hash = ? AND current_user_version = 2
          AND last_applied_sequence = 2 AND status = 'ready'
          AND blocked_reason IS NULL
      `).run(verified.databaseId, EXPECTED_MANIFEST_HASH).changes;
      if (changes !== 1) {
        db.exec("ROLLBACK;");
        transactionOpen = false;
        return;
      }
      db.exec("COMMIT;");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) db.exec("ROLLBACK;");
      transactionOpen = false;
      throw error;
    }
  } catch {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        // The exact audit CAS was not safe.
      }
    }
    // Preflight failure remains the authoritative public result. If the exact
    // audit CAS cannot be proven, no blocked row is invented.
  }
}

export function computeSchemaHash(db: DatabaseSync, version = userVersion(db)): Sha256 {
  const rows = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name, tbl_name
  `).all() as unknown as JsonValue;
  const body = Buffer.from(canonicalizeJson(rows), "utf8");
  return hashFramed(
    "vdt-studio/sqlite-schema",
    "sqlite_schema_hash.v1",
    { userVersion: version },
    body
  );
}

function applySequenceOne(
  db: DatabaseSync,
  dataDir: string,
  journal: MigrationBootstrapJournal,
  now: string,
  options: StorageMigrationOptions
): void {
  migrationApplicationTransaction(
    db,
    dataDir,
    migrationForeignKeyCheckIdentity({
      databaseId: journal.databaseId,
      attemptId: journal.journalId,
      fenceOwnerToken: journal.ownerToken,
      fenceLeaseGeneration: journal.leaseGeneration,
      targetManifestHash: journal.targetManifestHash,
      entry: ENTRIES[0]!
    }),
    now,
    options,
    () => {
      db.exec(SEQUENCE_1_SQL.toString("utf8"));
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(Date.parse(now));
      db.exec("PRAGMA user_version = 1;");
      const actual = computeSchemaHash(db, 1);
      if (actual !== LEGACY_V1_SCHEMA_HASH) {
        throw migrationBlocked(`Sequence 1 postcondition failed: ${actual}.`);
      }
    }
  );
}

function applySequenceTwo(
  db: DatabaseSync,
  journal: MigrationBootstrapJournal,
  legacy: { revisions: LegacyRevisionEvidence[]; vdts: LegacyVdtEvidence[] },
  now: string,
  dataDir: string,
  options: StorageMigrationOptions
): void {
  const legacyMigration = db.prepare(
    "SELECT version, applied_at FROM schema_migrations ORDER BY version"
  ).all() as Array<Record<string, unknown>>;
  if (
    legacyMigration.length !== 1 ||
    Number(legacyMigration[0]?.version) !== 1 ||
    !Number.isSafeInteger(Number(legacyMigration[0]?.applied_at))
  ) {
    throw migrationBlocked("Legacy schema_migrations record is not the frozen sole sequence-1 row.");
  }
  const appliedAt = Date.parse(now);
  const sequenceOne = ENTRIES[0]!;
  const sequenceTwo = ENTRIES[1]!;

  migrationApplicationTransaction(
    db,
    dataDir,
    migrationForeignKeyCheckIdentity({
      databaseId: journal.databaseId,
      attemptId: journal.journalId,
      fenceOwnerToken: journal.ownerToken,
      fenceLeaseGeneration: journal.leaseGeneration,
      targetManifestHash: journal.targetManifestHash,
      entry: sequenceTwo
    }),
    now,
    options,
    () => {
    db.exec(SEQUENCE_2_SQL.toString("utf8"));

    db.prepare(`
      INSERT INTO migration_backup_evidence
      (backup_evidence_id, schema_version, database_id, from_user_version, manifest_hash, source_database_hash, backup_hash, backup_relative_path, created_at)
      VALUES (?, 'migration_backup_evidence.v1', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      journal.backupEvidence.backupEvidenceId,
      journal.databaseId,
      journal.backupEvidence.fromUserVersion,
      journal.targetManifestHash,
      journal.backupEvidence.sourceDatabaseHash,
      journal.backupEvidence.backupHash,
      journal.backupEvidence.backupRelativePath,
      Date.parse(journal.backupEvidence.createdAt)
    );

    const migrationAttemptId = `migration_attempt_${id(options.idFactory)}`;
    db.prepare(`
      INSERT INTO migration_attempts
      (attempt_id, schema_version, database_id, target_manifest_hash, backup_evidence_id, next_sequence, owner_token, lease_generation, lease_expires_at, status, active_migration_id, started_at, updated_at, completed_at)
      VALUES (?, 'migration_attempt.v1', ?, ?, ?, 3, ?, ?, ?, 'completed', ?, ?, ?, ?)
    `).run(
      migrationAttemptId,
      journal.databaseId,
      journal.targetManifestHash,
      journal.backupEvidence.backupEvidenceId,
      journal.ownerToken,
      journal.leaseGeneration,
      Date.parse(journal.leaseExpiresAt),
      sequenceTwo.migrationId,
      Date.parse(journal.attemptStartedAt),
      appliedAt,
      appliedAt
    );

    db.prepare(`
      INSERT INTO legacy_migration_adoptions
      (database_id, schema_version, adopted_sequence, legacy_user_version, legacy_schema_migration_version, legacy_schema_migration_applied_at, attested_schema_hash, bootstrap_sql_checksum, bootstrap_journal_relative_path, bootstrap_journal_hash, adopted_at)
      VALUES (?, 'legacy_migration_adoption.v1', 1, 1, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      journal.databaseId,
      Number(legacyMigration[0]!.applied_at),
      LEGACY_V1_SCHEMA_HASH,
      sequenceOne.sqlChecksum,
      journal.relativePath,
      journal.journalHash,
      appliedAt
    );

    const attestation = db.prepare(`
      INSERT INTO legacy_revision_attestations
      (revision_id, schema_version, project_id, vdt_id, revision_no, file_relative_path, content_scheme, content_hash, payload_byte_length, verified_at)
      VALUES (?, 'legacy_revision_attestation.v1', ?, ?, ?, ?, 'legacy_graph_sha256', ?, ?, ?)
    `);
    for (const revision of legacy.revisions) {
      attestation.run(
        revision.revisionId,
        revision.projectId,
        revision.vdtId,
        revision.revisionNo,
        revision.fileRelativePath,
        `sha256:${revision.rawGraphHash}`,
        revision.payloadByteLength,
        appliedAt
      );
    }

    db.prepare(`
      INSERT INTO project_runtime_states
      (project_id, schema_version, runtime_generation, generation_version, migration_state, write_state, updated_at)
      SELECT id, 'project_runtime_state.v1', 'v1', 1, 'shadow_ready', 'enabled', ?
      FROM projects
    `).run(appliedAt);

    const headInsert = db.prepare(`
      INSERT INTO vdt_revision_heads
      (vdt_id, schema_version, project_id, active_revision_id, active_content_scheme, active_content_hash, pending_revision_id, commit_generation)
      VALUES (?, 'vdt_revision_head.v2', ?, ?, ?, ?, NULL, ?)
    `);
    for (const vdt of legacy.vdts) {
      headInsert.run(
        vdt.vdtId,
        vdt.projectId,
        vdt.activeRevisionId,
        vdt.activeRevisionId ? "legacy_graph_sha256" : null,
        vdt.activeGraphHash ? `sha256:${vdt.activeGraphHash}` : null,
        vdt.commitGeneration
      );
    }

    db.prepare(`
      INSERT INTO vdt_storage_lifecycles
      (vdt_id, project_id, state, initial_attempt_id, updated_at)
      SELECT id, project_id, 'ready', NULL, ? FROM vdts
    `).run(appliedAt);

    const applicationInsert = db.prepare(`
      INSERT INTO applied_migrations
      (sequence, schema_version, database_id, migration_id, sql_checksum, from_user_version, to_user_version, precondition_schema_hash, postcondition_schema_hash, manifest_hash, application_id, applied_at)
      VALUES (?, 'applied_migration.v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    applicationInsert.run(
      1,
      journal.databaseId,
      sequenceOne.migrationId,
      sequenceOne.sqlChecksum,
      sequenceOne.fromUserVersion,
      sequenceOne.toUserVersion,
      sequenceOne.preconditionSchemaHash,
      sequenceOne.postconditionSchemaHash,
      STORAGE_MIGRATION_MANIFEST.manifestHash,
      `migration_application_${id(options.idFactory)}`,
      appliedAt
    );
    applicationInsert.run(
      2,
      journal.databaseId,
      sequenceTwo.migrationId,
      sequenceTwo.sqlChecksum,
      sequenceTwo.fromUserVersion,
      sequenceTwo.toUserVersion,
      sequenceTwo.preconditionSchemaHash,
      sequenceTwo.postconditionSchemaHash,
      STORAGE_MIGRATION_MANIFEST.manifestHash,
      `migration_application_${id(options.idFactory)}`,
      appliedAt
    );

    db.prepare(`
      INSERT INTO migration_state
      (database_id, schema_version, manifest_hash, current_user_version, last_applied_sequence, status, blocked_reason)
      VALUES (?, 'migration_state.v1', ?, 2, 2, 'ready', NULL)
    `).run(journal.databaseId, STORAGE_MIGRATION_MANIFEST.manifestHash);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(2, ?)").run(appliedAt);
    db.exec("PRAGMA user_version = 2;");

    const actual = computeSchemaHash(db, 2);
    if (actual !== ATOMIC_REVISION_SCHEMA_HASH) {
      throw migrationBlocked(`Sequence 2 postcondition failed: ${actual}.`);
    }
      options.faultInjector?.("before_sequence_2_commit");
    }
  );
}

function verifyLegacyV1Fingerprint(db: DatabaseSync): void {
  if (userVersion(db) !== 1) throw migrationBlocked("Legacy adoption requires user_version=1.");
  const actual = computeSchemaHash(db, 1);
  if (actual !== LEGACY_V1_SCHEMA_HASH) {
    throw migrationBlocked(`Legacy schema fingerprint mismatch: ${actual}.`);
  }
  const rows = db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all() as Array<
    Record<string, unknown>
  >;
  if (
    rows.length !== 1 ||
    Number(rows[0]?.version) !== 1 ||
    !Number.isSafeInteger(Number(rows[0]?.applied_at))
  ) {
    throw migrationBlocked("Legacy schema_migrations prefix is not exactly [1].");
  }
}

interface LaterMigrationAttemptSnapshot {
  attemptId: string;
  databaseId: string;
  targetManifestHash: Sha256;
  targetSequence: number;
  startSequence: number;
  nextSequence: number;
  ownerToken: string;
  leaseGeneration: number;
  leaseExpiresAt: number;
  status: "backed_up" | "applying";
  activeMigrationId: string | null;
  backupEvidenceId: string;
}

interface LaterMigrationBackupOwner {
  schemaVersion: "later_migration_backup_owner.v1";
  databaseId: string;
  attemptId: string;
  backupEvidenceId: string;
  targetManifestHash: Sha256;
  fromUserVersion: number;
  backupRelativePath: string;
  createdAt: string;
  ownerHash: Sha256;
}

interface VerifiedMigrationPlanState {
  databaseId: string;
  currentSequence: number;
  currentUserVersion: number;
  activeAttempt: LaterMigrationAttemptSnapshot | null;
}

function verifyReadyDatabase(db: DatabaseSync, dataDir: string): void {
  const verified = verifyDatabaseForPlan(db, dataDir, BOOTSTRAP_MIGRATION_PLAN);
  if (verified.currentSequence !== 2 || verified.activeAttempt !== null) {
    throw migrationBlocked("Ready database is not the exact frozen bootstrap manifest.");
  }
}

function verifyDatabaseForPlan(
  db: DatabaseSync,
  dataDir: string,
  plan: ValidatedStorageMigrationPlan,
  recoveryIdentity?: MigrationForeignKeyCheckIdentityV1
): VerifiedMigrationPlanState {
  db.exec("BEGIN;");
  try {
    const verified = verifyDatabaseForPlanSnapshot(
      db,
      dataDir,
      plan,
      recoveryIdentity
    );
    db.exec("COMMIT;");
    return verified;
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Preserve the verification failure if SQLite already ended the snapshot.
    }
    throw error;
  }
}

function verifyDatabaseForPlanSnapshot(
  db: DatabaseSync,
  dataDir: string,
  plan: ValidatedStorageMigrationPlan,
  recoveryIdentity?: MigrationForeignKeyCheckIdentityV1
): VerifiedMigrationPlanState {
  const currentUserVersion = userVersion(db);
  if (currentUserVersion < 2) {
    throw migrationBlocked("Audited migration evidence requires bootstrap sequence 2.");
  }
  const rows = db.prepare(`
    SELECT sequence, schema_version, database_id, migration_id, sql_checksum,
           from_user_version, to_user_version, precondition_schema_hash,
           postcondition_schema_hash, manifest_hash, application_id, applied_at
    FROM applied_migrations ORDER BY sequence
  `).all() as Array<Record<string, unknown>>;
  if (rows.length < 2 || rows.length > plan.entries.length) {
    throw migrationBlocked("Applied migration prefix is outside the validated manifest.");
  }
  const currentSequence = rows.length;
  const currentEntry = plan.entries[currentSequence - 1]!.manifestEntry;
  if (currentUserVersion !== currentEntry.toUserVersion) {
    throw migrationBlocked("PRAGMA user_version does not match the applied migration prefix.");
  }
  const currentSchemaHash = computeSchemaHash(db, currentUserVersion);
  if (currentSchemaHash !== currentEntry.postconditionSchemaHash) {
    throw migrationBlocked(
      `Migration sequence ${currentSequence} schema fingerprint mismatch: ${currentSchemaHash}.`
    );
  }
  const databaseId = String(rows[0]?.database_id ?? "");
  if (!databaseId || rows.some((row) => String(row.database_id) !== databaseId)) {
    throw migrationBlocked("Applied migrations do not share one stable database ID.");
  }
  rows.forEach((row, index) => {
    const entry = plan.entries[index]!.manifestEntry;
    const rowManifestHash = String(row.manifest_hash) as Sha256;
    const targetSequence = plan.prefixSequenceByHash.get(rowManifestHash);
    const expectedManifestBinding =
      entry.sequence <= 2
        ? rowManifestHash === (EXPECTED_MANIFEST_HASH as Sha256)
        : targetSequence !== undefined &&
          targetSequence >= entry.sequence &&
          targetSequence >= 3;
    if (
      Number(row.sequence) !== entry.sequence ||
      row.schema_version !== "applied_migration.v1" ||
      row.migration_id !== entry.migrationId ||
      row.sql_checksum !== entry.sqlChecksum ||
      Number(row.from_user_version) !== entry.fromUserVersion ||
      Number(row.to_user_version) !== entry.toUserVersion ||
      row.precondition_schema_hash !== entry.preconditionSchemaHash ||
      row.postcondition_schema_hash !== entry.postconditionSchemaHash ||
      !expectedManifestBinding ||
      typeof row.application_id !== "string" ||
      row.application_id.length === 0 ||
      !Number.isSafeInteger(Number(row.applied_at))
    ) {
      throw migrationBlocked(
        `Applied migration sequence ${entry.sequence} does not match its validated manifest history.`
      );
    }
  });

  const schemaVersions = db.prepare(
    "SELECT version, applied_at FROM schema_migrations ORDER BY version"
  ).all() as Array<Record<string, unknown>>;
  if (
    schemaVersions.length !== currentSequence ||
    schemaVersions.some((row, index) => {
      const entry = plan.entries[index]!.manifestEntry;
      return (
        Number(row.version) !== entry.toUserVersion ||
        !Number.isSafeInteger(Number(row.applied_at))
      );
    })
  ) {
    throw migrationBlocked("schema_migrations and the applied manifest prefix are not aligned.");
  }

  const states = db.prepare(`
    SELECT schema_version, database_id, manifest_hash, current_user_version,
           last_applied_sequence, status, blocked_reason
    FROM migration_state
  `).all() as Array<Record<string, unknown>>;
  const state = states[0];
  const recoveryStateBlocked =
    recoveryIdentity !== undefined &&
    state?.status === "blocked" &&
    state.blocked_reason === "postcondition_failed";
  if (state?.status === "blocked" && !recoveryStateBlocked) {
    throw migrationBlocked(
      `Migration state is durably blocked: ${String(state.blocked_reason ?? "unknown")}.`
    );
  }
  if (
    states.length !== 1 ||
    !state ||
    state.schema_version !== "migration_state.v1" ||
    state.database_id !== databaseId ||
    state.manifest_hash !== plan.prefixHashes[currentSequence - 1] ||
    Number(state.current_user_version) !== currentUserVersion ||
    Number(state.last_applied_sequence) !== currentSequence ||
    (recoveryStateBlocked
      ? state.status !== "blocked" ||
        state.blocked_reason !== "postcondition_failed"
      : state.status !== "ready" || state.blocked_reason !== null)
  ) {
    throw migrationBlocked("Migration state is not a ready exact manifest prefix.");
  }

  const latestJournal = readLatestValidJournal(dataDir);
  if (!latestJournal) {
    throw migrationBlocked("Ready migration state has no durable bootstrap journal.");
  }
  const adoption = db.prepare(`
    SELECT schema_version, database_id, adopted_sequence, legacy_user_version,
           legacy_schema_migration_version, legacy_schema_migration_applied_at,
           attested_schema_hash, bootstrap_sql_checksum,
           bootstrap_journal_relative_path, bootstrap_journal_hash, adopted_at
    FROM legacy_migration_adoptions
  `).all() as Array<Record<string, unknown>>;
  const adopted = adoption[0];
  if (
    adoption.length !== 1 ||
    !adopted ||
    adopted.schema_version !== "legacy_migration_adoption.v1" ||
    adopted.database_id !== databaseId ||
    Number(adopted.adopted_sequence) !== 1 ||
    Number(adopted.legacy_user_version) !== 1 ||
    Number(adopted.legacy_schema_migration_version) !== 1 ||
    !Number.isSafeInteger(Number(adopted.legacy_schema_migration_applied_at)) ||
    adopted.attested_schema_hash !== LEGACY_V1_SCHEMA_HASH ||
    adopted.bootstrap_sql_checksum !== ENTRIES[0]!.sqlChecksum ||
    adopted.bootstrap_journal_relative_path !== latestJournal.relativePath ||
    adopted.bootstrap_journal_hash !== latestJournal.journalHash ||
    Number(adopted.legacy_schema_migration_applied_at) !==
      Number(schemaVersions[0]?.applied_at) ||
    Number(schemaVersions[1]?.applied_at) !== Number(rows[1]?.applied_at) ||
    !Number.isSafeInteger(Number(adopted.adopted_at))
  ) {
    throw migrationBlocked("Migration adoption is not bound to the latest valid bootstrap journal.");
  }

  const backups = db.prepare(`
    SELECT schema_version, backup_evidence_id, database_id, from_user_version, manifest_hash,
           source_database_hash, backup_hash, backup_relative_path, created_at
    FROM migration_backup_evidence ORDER BY created_at, backup_evidence_id
  `).all() as Array<Record<string, unknown>>;
  const backupById = new Map(
    backups.map((backup) => [String(backup.backup_evidence_id), backup])
  );
  if (backupById.size !== backups.length) {
    throw migrationBlocked("Migration backup evidence contains duplicate identities.");
  }
  const bootstrapBackup = backupById.get(
    latestJournal.backupEvidence.backupEvidenceId
  );
  if (
    !bootstrapBackup ||
    bootstrapBackup.schema_version !== "migration_backup_evidence.v1" ||
    bootstrapBackup.database_id !== latestJournal.databaseId ||
    Number(bootstrapBackup.from_user_version) !==
      latestJournal.backupEvidence.fromUserVersion ||
    bootstrapBackup.manifest_hash !== latestJournal.backupEvidence.manifestHash ||
    bootstrapBackup.source_database_hash !==
      latestJournal.backupEvidence.sourceDatabaseHash ||
    bootstrapBackup.backup_hash !== latestJournal.backupEvidence.backupHash ||
    bootstrapBackup.backup_relative_path !==
      latestJournal.backupEvidence.backupRelativePath ||
    Number(bootstrapBackup.created_at) !==
      Date.parse(latestJournal.backupEvidence.createdAt)
  ) {
    throw migrationBlocked("Bootstrap backup evidence does not match its journal.");
  }

  const attempts = db.prepare(`
    SELECT schema_version, attempt_id, database_id, target_manifest_hash,
           backup_evidence_id, next_sequence, owner_token, lease_generation,
           lease_expires_at, status, active_migration_id, started_at, updated_at,
           completed_at
    FROM migration_attempts ORDER BY started_at, attempt_id
  `).all() as Array<Record<string, unknown>>;
  const bootstrapAttempts = attempts.filter(
    (attempt) =>
      attempt.backup_evidence_id === latestJournal.backupEvidence.backupEvidenceId
  );
  const bootstrapAttempt = bootstrapAttempts[0];
  if (
    bootstrapAttempts.length !== 1 ||
    !bootstrapAttempt ||
    bootstrapAttempt.schema_version !== "migration_attempt.v1" ||
    typeof bootstrapAttempt.attempt_id !== "string" ||
    bootstrapAttempt.attempt_id.length === 0 ||
    bootstrapAttempt.database_id !== databaseId ||
    bootstrapAttempt.target_manifest_hash !== EXPECTED_MANIFEST_HASH ||
    Number(bootstrapAttempt.next_sequence) !== 3 ||
    bootstrapAttempt.owner_token !== latestJournal.ownerToken ||
    Number(bootstrapAttempt.lease_generation) !== latestJournal.leaseGeneration ||
    Number(bootstrapAttempt.lease_expires_at) !==
      Date.parse(latestJournal.leaseExpiresAt) ||
    bootstrapAttempt.status !== "completed" ||
    bootstrapAttempt.active_migration_id !== ENTRIES[1]!.migrationId ||
    Number(bootstrapAttempt.started_at) !==
      Date.parse(latestJournal.attemptStartedAt) ||
    !Number.isSafeInteger(Number(bootstrapAttempt.updated_at)) ||
    !Number.isSafeInteger(Number(bootstrapAttempt.completed_at))
  ) {
    throw migrationBlocked("Bootstrap migration attempt is incomplete or not fenced to its journal.");
  }

  const referencedBackupIds = new Set<string>([
    latestJournal.backupEvidence.backupEvidenceId
  ]);
  const seenTargetHashes = new Set<Sha256>();
  const laterAttempts: Array<
    LaterMigrationAttemptSnapshot & { appliedThroughSequence: number }
  > = [];
  for (const attempt of attempts) {
    if (attempt === bootstrapAttempt) continue;
    const attemptId = String(attempt.attempt_id ?? "");
    const targetManifestHash = String(attempt.target_manifest_hash) as Sha256;
    const targetSequence = plan.prefixSequenceByHash.get(targetManifestHash);
    const backupEvidenceId = String(attempt.backup_evidence_id ?? "");
    const backup = backupById.get(backupEvidenceId);
    const nextSequence = Number(attempt.next_sequence);
    const status = String(attempt.status);
    const isRecoveryBlockedAttempt =
      recoveryStateBlocked &&
      status === "blocked" &&
      attemptId === recoveryIdentity!.attemptId &&
      attempt.database_id === recoveryIdentity!.databaseId &&
      targetManifestHash === recoveryIdentity!.targetManifestHash &&
      nextSequence === recoveryIdentity!.sequence &&
      attempt.owner_token === recoveryIdentity!.fenceOwnerToken &&
      Number(attempt.lease_generation) ===
        recoveryIdentity!.fenceLeaseGeneration &&
      attempt.active_migration_id === recoveryIdentity!.migrationId;
    const appliedForAttempt = rows.filter(
      (row) =>
        Number(row.sequence) >= 3 &&
        row.manifest_hash === targetManifestHash
    );
    const startSequence =
      appliedForAttempt.length > 0
        ? Math.min(...appliedForAttempt.map((row) => Number(row.sequence)))
        : nextSequence;
    if (
      attempt.schema_version !== "migration_attempt.v1" ||
      !attemptId ||
      attempt.database_id !== databaseId ||
      targetSequence === undefined ||
      targetSequence < 3 ||
      seenTargetHashes.has(targetManifestHash) ||
      !backup ||
      !backupEvidenceId ||
      referencedBackupIds.has(backupEvidenceId) ||
      !Number.isSafeInteger(nextSequence) ||
      !Number.isSafeInteger(startSequence) ||
      startSequence < 3 ||
      startSequence > targetSequence ||
      typeof attempt.owner_token !== "string" ||
      attempt.owner_token.length === 0 ||
      !Number.isSafeInteger(Number(attempt.lease_generation)) ||
      Number(attempt.lease_generation) < 1 ||
      !Number.isSafeInteger(Number(attempt.lease_expires_at)) ||
      !Number.isSafeInteger(Number(attempt.started_at)) ||
      !Number.isSafeInteger(Number(attempt.updated_at))
    ) {
      throw migrationBlocked(`Later migration attempt ${attemptId || "<missing>"} is invalid.`);
    }
    if (status === "blocked" && !isRecoveryBlockedAttempt) {
      throw migrationBlocked(`Later migration attempt ${attemptId} is durably blocked.`);
    }
    if (
      status !== "backed_up" &&
      status !== "applying" &&
      status !== "completed" &&
      !isRecoveryBlockedAttempt
    ) {
      throw migrationBlocked(`Later migration attempt ${attemptId} has an invalid status.`);
    }
    seenTargetHashes.add(targetManifestHash);
    referencedBackupIds.add(backupEvidenceId);
    const expectedFromVersion =
      plan.entries[startSequence - 2]!.manifestEntry.toUserVersion;
    if (
      backup.schema_version !== "migration_backup_evidence.v1" ||
      backup.database_id !== databaseId ||
      Number(backup.from_user_version) !== expectedFromVersion ||
      backup.manifest_hash !== targetManifestHash ||
      typeof backup.source_database_hash !== "string" ||
      backup.source_database_hash !== backup.backup_hash ||
      typeof backup.backup_relative_path !== "string" ||
      !Number.isSafeInteger(Number(backup.created_at))
    ) {
      throw migrationBlocked(`Later migration backup ${backupEvidenceId} is not bound to its attempt.`);
    }
    verifyLaterBackupEvidence(
      dataDir,
      {
        databaseId,
        fromUserVersion: expectedFromVersion,
        targetManifestHash,
        sourceDatabaseHash: String(backup.source_database_hash) as Sha256,
        backupHash: String(backup.backup_hash) as Sha256,
        backupRelativePath: String(backup.backup_relative_path)
      },
      plan.entries[startSequence - 1]!.manifestEntry.preconditionSchemaHash
    );
    const expectedAppliedEnd =
      status === "completed" ? targetSequence : nextSequence - 1;
    const expectedAppliedSequences = Array.from(
      { length: Math.max(0, expectedAppliedEnd - startSequence + 1) },
      (_, index) => startSequence + index
    );
    if (
      appliedForAttempt.length !== expectedAppliedSequences.length ||
      expectedAppliedSequences.some(
        (sequence, index) =>
          Number(appliedForAttempt[index]?.sequence) !== sequence
      )
    ) {
      throw migrationBlocked(`Later migration attempt ${attemptId} has a non-contiguous application history.`);
    }
    if (status === "completed") {
      if (
        nextSequence !== targetSequence + 1 ||
        attempt.active_migration_id !==
          plan.entries[targetSequence - 1]!.manifestEntry.migrationId ||
        !Number.isSafeInteger(Number(attempt.completed_at))
      ) {
        throw migrationBlocked(`Completed migration attempt ${attemptId} is not terminally aligned.`);
      }
    } else if (
      nextSequence < startSequence ||
      nextSequence > targetSequence ||
      attempt.completed_at !== null ||
      (status === "backed_up" && attempt.active_migration_id !== null) ||
      ((status === "applying" || isRecoveryBlockedAttempt) &&
        attempt.active_migration_id !==
          plan.entries[nextSequence - 1]!.manifestEntry.migrationId)
    ) {
      throw migrationBlocked(`Active migration attempt ${attemptId} is not aligned to its next sequence.`);
    }
    laterAttempts.push({
      attemptId,
      databaseId,
      targetManifestHash,
      targetSequence,
      startSequence,
      nextSequence,
      ownerToken: String(attempt.owner_token),
      leaseGeneration: Number(attempt.lease_generation),
      leaseExpiresAt: Number(attempt.lease_expires_at),
      status: status === "backed_up" ? "backed_up" : "applying",
      activeMigrationId:
        attempt.active_migration_id === null
          ? null
          : String(attempt.active_migration_id),
      backupEvidenceId,
      appliedThroughSequence: expectedAppliedEnd
    });
  }
  if (
    referencedBackupIds.size !== backups.length ||
    backups.some((backup) => backup.database_id !== databaseId)
  ) {
    throw migrationBlocked("Migration backup evidence contains an orphan or foreign row.");
  }

  laterAttempts.sort(
    (left, right) => left.startSequence - right.startSequence
  );
  let expectedStartSequence = 3;
  let activeAttempt: LaterMigrationAttemptSnapshot | null = null;
  for (const attempt of laterAttempts) {
    if (attempt.startSequence !== expectedStartSequence) {
      throw migrationBlocked("Later migration attempts do not form an append-only history.");
    }
    const raw = attempts.find((row) => row.attempt_id === attempt.attemptId)!;
    if (raw.status === "completed") {
      expectedStartSequence = attempt.targetSequence + 1;
      continue;
    }
    if (activeAttempt !== null || attempt.appliedThroughSequence !== currentSequence) {
      throw migrationBlocked("Later migration history has multiple or misaligned active attempts.");
    }
    activeAttempt = attempt;
    expectedStartSequence = attempt.targetSequence + 1;
  }
  if (
    (activeAttempt === null && expectedStartSequence !== currentSequence + 1) ||
    (activeAttempt !== null && activeAttempt.nextSequence !== currentSequence + 1)
  ) {
    throw migrationBlocked("Later migration attempts do not cover the exact applied prefix.");
  }
  if (recoveryStateBlocked) {
    const recoveryAttempt = attempts.find(
      (attempt) => attempt.attempt_id === recoveryIdentity!.attemptId
    );
    if (recoveryAttempt?.status !== "blocked") {
      throw migrationBlocked(
        "Blocked foreign-key recovery state has no exact blocked attempt."
      );
    }
  }

  if (
    plan.planKind === "v2-production" &&
    currentSequence === 3 &&
    activeAttempt === null
  ) {
    verifySequence3ReadyState(db, plan);
  }
  verifyLegacyAttestationCompleteness(db, dataDir);
  verifyRuntimeBackfillCompleteness(db);
  return {
    databaseId,
    currentSequence,
    currentUserVersion,
    activeAttempt
  };
}

function runLaterMigrations(
  db: DatabaseSync,
  dataDir: string,
  options: StorageMigrationOptions,
  plan: ValidatedStorageMigrationPlan
): void {
  const hasPreliminaryRecoveryArtifacts =
    migrationForeignKeyBlockDirectoryHasEntries(dataDir);
  const preliminaryVersion = userVersion(db);
  if (
    !hasPreliminaryRecoveryArtifacts &&
    !plan.entries
      .slice(1)
      .some((entry) => entry.manifestEntry.toUserVersion === preliminaryVersion)
  ) {
    throw migrationBlocked(
      `PRAGMA user_version=${preliminaryVersion} is not an audited manifest boundary.`
    );
  }
  if (
    !hasPreliminaryRecoveryArtifacts &&
    preliminaryVersion === plan.targetUserVersion
  ) {
    const preliminary = verifyDatabaseForPlan(db, dataDir, plan);
    if (
      preliminary.currentSequence === plan.targetSequence &&
      preliminary.activeAttempt === null
    ) {
      return;
    }
  }

  db.exec(
    `PRAGMA busy_timeout = ${positiveInteger(options.busyTimeoutMs, "busyTimeoutMs")};`
  );
  db.exec("PRAGMA locking_mode = EXCLUSIVE;");
  try {
    acquireExclusiveMigrationFence(db, options.busyTimeoutMs);
    options.faultInjector?.("after_admission_fence_acquired");
    const recovery = prepareAndInspectMigrationBlockSidecars(dataDir);
    if (recovery) {
      reconcileMigrationForeignKeyRecovery(
        db,
        dataDir,
        plan,
        recovery,
        options
      );
    }
    for (;;) {
      const verified = verifyDatabaseForPlan(db, dataDir, plan);
      reconcileOwnedLaterBackupDirectories(
        db,
        dataDir,
        verified.databaseId,
        plan
      );
      if (
        verified.currentSequence === plan.targetSequence &&
        verified.activeAttempt === null
      ) {
        return;
      }
      if (verified.currentSequence >= plan.targetSequence) {
        throw migrationBlocked("Migration target is shorter than the durable applied prefix.");
      }

      const timestamp = migrationTimestamp(options.now);
      let attempt = verified.activeAttempt;
      if (attempt) {
        if (attempt.leaseExpiresAt > timestamp.millis) {
          throw new VdtStorageError(
            "MIGRATION_IN_PROGRESS",
            `Migration attempt ${attempt.attemptId} lease generation ${attempt.leaseGeneration} is active.`,
            true
          );
        }
        attempt = takeOverLaterMigrationAttempt(
          db,
          attempt,
          options,
          timestamp
        );
      } else {
        attempt = createLaterMigrationAttempt(
          db,
          dataDir,
          verified,
          plan,
          options,
          timestamp
        );
      }
      applyLaterMigrationAttempt(
        db,
        dataDir,
        attempt,
        plan,
        options
      );
    }
  } finally {
    try {
      db.exec("PRAGMA locking_mode = NORMAL;");
    } catch {
      // Closing the connection releases the exclusive OS lock if SQLite
      // cannot switch locking modes while propagating a migration failure.
    }
  }
}

function reconcileMigrationForeignKeyRecovery(
  db: DatabaseSync,
  dataDir: string,
  plan: ValidatedStorageMigrationPlan,
  recovery: MigrationForeignKeyRecoveryPair,
  options: StorageMigrationOptions
): never {
  const identity = recovery.pending.identity;
  const targetSequence = plan.prefixSequenceByHash.get(
    identity.targetManifestHash
  );
  const entry = plan.entries[identity.sequence - 1]?.manifestEntry;
  if (
    targetSequence === undefined ||
    targetSequence < identity.sequence ||
    !entry ||
    entry.sequence !== identity.sequence ||
    entry.migrationId !== identity.migrationId
  ) {
    throw migrationForeignKeyRecoveryRequired(recovery);
  }

  let verified: VerifiedMigrationPlanState;
  try {
    verified = verifyDatabaseForPlan(db, dataDir, plan, identity);
  } catch {
    throw migrationForeignKeyRecoveryRequired(recovery);
  }
  const attempt = verified.activeAttempt;
  if (
    verified.databaseId !== identity.databaseId ||
    verified.currentSequence !== identity.sequence - 1 ||
    verified.currentUserVersion !== entry.fromUserVersion ||
    !attempt ||
    attempt.attemptId !== identity.attemptId ||
    attempt.databaseId !== identity.databaseId ||
    attempt.targetManifestHash !== identity.targetManifestHash ||
    attempt.targetSequence !== targetSequence ||
    attempt.nextSequence !== identity.sequence ||
    attempt.ownerToken !== identity.fenceOwnerToken ||
    attempt.leaseGeneration !== identity.fenceLeaseGeneration ||
    attempt.activeMigrationId !== identity.migrationId ||
    laterMigrationPreconditionFailure(
      db,
      entry,
      plan.planKind === "v2-production"
    ) !== null
  ) {
    throw migrationForeignKeyRecoveryRequired(recovery);
  }

  const rawAttempt = db.prepare(`
    SELECT status, backup_evidence_id
    FROM migration_attempts
    WHERE attempt_id = ? AND database_id = ? AND target_manifest_hash = ?
  `).get(
    identity.attemptId,
    identity.databaseId,
    identity.targetManifestHash
  ) as Record<string, unknown> | undefined;
  if (
    !rawAttempt ||
    rawAttempt.backup_evidence_id !== attempt.backupEvidenceId
  ) {
    throw migrationForeignKeyRecoveryRequired(recovery);
  }
  if (rawAttempt.status === "blocked") {
    throw migrationForeignKeyRecoveryRequired(recovery);
  }
  if (rawAttempt.status !== "applying") {
    throw migrationForeignKeyRecoveryRequired(recovery);
  }

  const timestamp = migrationTimestamp(options.now);
  const context = laterMigrationFaultContext(
    attempt.attemptId,
    entry,
    attempt.targetSequence,
    attempt.targetManifestHash,
    attempt.leaseGeneration
  );
  try {
    finalizeForeignKeyBlockedAttempt(
      db,
      attempt,
      entry,
      plan,
      timestamp,
      options,
      context
    );
  } catch {
    throw migrationForeignKeyRecoveryRequired(recovery);
  }
  throw migrationForeignKeyRecoveryRequired(recovery);
}

function takeOverLaterMigrationAttempt(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  options: StorageMigrationOptions,
  timestamp: { iso: string; millis: number }
): LaterMigrationAttemptSnapshot {
  const ownerToken = nextLaterMigrationOwnerToken(options, attempt.ownerToken);
  const leaseGeneration = attempt.leaseGeneration + 1;
  const leaseExpiresAt =
    timestamp.millis + effectiveLaterMigrationLeaseMs(options.leaseMs);
  const changes = db.prepare(`
    UPDATE migration_attempts
    SET owner_token = ?, lease_generation = ?, lease_expires_at = ?, updated_at = ?
    WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ?
      AND lease_expires_at = ? AND lease_expires_at <= ?
      AND status IN ('backed_up', 'applying')
  `).run(
    ownerToken,
    leaseGeneration,
    leaseExpiresAt,
    timestamp.millis,
    attempt.attemptId,
    attempt.ownerToken,
    attempt.leaseGeneration,
    attempt.leaseExpiresAt,
    timestamp.millis
  ).changes;
  if (changes !== 1) throw lostMigrationLease(attempt.attemptId);
  return {
    ...attempt,
    ownerToken,
    leaseGeneration,
    leaseExpiresAt
  };
}

function createLaterMigrationAttempt(
  db: DatabaseSync,
  dataDir: string,
  verified: VerifiedMigrationPlanState,
  plan: ValidatedStorageMigrationPlan,
  options: StorageMigrationOptions,
  timestamp: { iso: string; millis: number }
): LaterMigrationAttemptSnapshot {
  const startSequence = verified.currentSequence + 1;
  const startEntry = plan.entries[startSequence - 1]!.manifestEntry;
  const targetManifestHash = plan.prefixHashes[plan.targetSequence - 1]!;
  const attemptId = `migration_attempt_${id(options.idFactory)}`;
  const backupEvidenceId = `migration_backup_${id(options.idFactory)}`;
  const ownerToken = nextLaterMigrationOwnerToken(options);
  const leaseGeneration = 1;
  const leaseExpiresAt =
    timestamp.millis + effectiveLaterMigrationLeaseMs(options.leaseMs);
  const backupDir = path.join(dataDir, "migrations", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const ownedBackupDir = path.join(
    backupDir,
    `.later-owned-${attemptId}`
  );
  assertInside(dataDir, ownedBackupDir);
  fs.mkdirSync(ownedBackupDir, { mode: 0o700 });
  fsyncDirectory(backupDir);
  const backupPath = path.join(ownedBackupDir, "backup.sqlite");
  assertInside(dataDir, backupPath);
  const backupRelativePath = path.relative(dataDir, backupPath);
  const owner = createLaterMigrationBackupOwner({
    databaseId: verified.databaseId,
    attemptId,
    backupEvidenceId,
    targetManifestHash,
    fromUserVersion: verified.currentUserVersion,
    backupRelativePath,
    createdAt: timestamp.iso
  });
  writeExclusiveDurable(
    path.join(ownedBackupDir, "owner.json"),
    Buffer.from(canonicalizeJson(owner as unknown as JsonValue), "utf8")
  );
  const context = laterMigrationFaultContext(
    attemptId,
    startEntry,
    plan.targetSequence,
    targetManifestHash,
    leaseGeneration
  );
  options.faultInjector?.("after_later_backup_owner_fsynced", context);
  db.exec(`VACUUM INTO '${escapeSqlLiteral(backupPath)}';`);
  fsyncFileAndDirectory(backupPath);
  const backupBytes = fs.readFileSync(backupPath);
  const backupHash = hashFramed(
    "vdt-studio/sqlite-backup",
    "sqlite_backup_hash.v1",
    {
      databaseId: verified.databaseId,
      fromUserVersion: verified.currentUserVersion
    },
    backupBytes
  );
  verifyLaterBackupEvidence(
    dataDir,
    {
      databaseId: verified.databaseId,
      fromUserVersion: verified.currentUserVersion,
      targetManifestHash,
      sourceDatabaseHash: backupHash,
      backupHash,
      backupRelativePath
    },
    startEntry.preconditionSchemaHash
  );
  options.faultInjector?.("after_later_backup_fsynced", context);

  transaction(db, () => {
    db.prepare(`
      INSERT INTO migration_backup_evidence
      (backup_evidence_id, schema_version, database_id, from_user_version,
       manifest_hash, source_database_hash, backup_hash, backup_relative_path,
       created_at)
      VALUES (?, 'migration_backup_evidence.v1', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      backupEvidenceId,
      verified.databaseId,
      verified.currentUserVersion,
      targetManifestHash,
      backupHash,
      backupHash,
      backupRelativePath,
      timestamp.millis
    );
    db.prepare(`
      INSERT INTO migration_attempts
      (attempt_id, schema_version, database_id, target_manifest_hash,
       backup_evidence_id, next_sequence, owner_token, lease_generation,
       lease_expires_at, status, active_migration_id, started_at, updated_at,
       completed_at)
      VALUES (?, 'migration_attempt.v1', ?, ?, ?, ?, ?, ?, ?, 'backed_up',
              NULL, ?, ?, NULL)
    `).run(
      attemptId,
      verified.databaseId,
      targetManifestHash,
      backupEvidenceId,
      startSequence,
      ownerToken,
      leaseGeneration,
      leaseExpiresAt,
      timestamp.millis,
      timestamp.millis
    );
  });
  options.faultInjector?.("after_later_attempt_reserved", context);
  return {
    attemptId,
    databaseId: verified.databaseId,
    targetManifestHash,
    targetSequence: plan.targetSequence,
    startSequence,
    nextSequence: startSequence,
    ownerToken,
    leaseGeneration,
    leaseExpiresAt,
    status: "backed_up",
    activeMigrationId: null,
    backupEvidenceId
  };
}

function reconcileOwnedLaterBackupDirectories(
  db: DatabaseSync,
  dataDir: string,
  databaseId: string,
  plan: ValidatedStorageMigrationPlan
): void {
  const backupDir = path.join(dataDir, "migrations", "backups");
  if (!fs.existsSync(backupDir)) return;
  const evidenceRows = db.prepare(`
    SELECT backup_evidence_id, database_id, from_user_version, manifest_hash,
           backup_relative_path
    FROM migration_backup_evidence
  `).all() as Array<Record<string, unknown>>;
  const evidenceByPath = new Map(
    evidenceRows.map((row) => [
      path.normalize(String(row.backup_relative_path)),
      row
    ])
  );
  const attemptRows = db.prepare(`
    SELECT attempt_id, database_id, target_manifest_hash, backup_evidence_id
    FROM migration_attempts
  `).all() as Array<Record<string, unknown>>;
  const attemptByBackupId = new Map(
    attemptRows.map((row) => [String(row.backup_evidence_id), row])
  );
  for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !/^\.later-owned-migration_attempt_[A-Za-z0-9_-]+$/.test(entry.name)
    ) {
      continue;
    }
    const ownedDir = path.join(backupDir, entry.name);
    const owner = readLaterMigrationBackupOwner(ownedDir);
    if (
      !owner ||
      owner.databaseId !== databaseId ||
      plan.prefixSequenceByHash.get(owner.targetManifestHash) === undefined
    ) {
      continue;
    }
    const expectedOwnedDir = `.later-owned-${owner.attemptId}`;
    const expectedBackupPath = path.join(ownedDir, "backup.sqlite");
    const expectedRelativePath = path.normalize(
      path.relative(dataDir, expectedBackupPath)
    );
    const boundaryIsKnown = plan.entries.some(
      ({ manifestEntry }) =>
        manifestEntry.fromUserVersion === owner.fromUserVersion &&
        manifestEntry.sequence <=
          (plan.prefixSequenceByHash.get(owner.targetManifestHash) ?? 0)
    );
    if (
      entry.name !== expectedOwnedDir ||
      path.normalize(owner.backupRelativePath) !== expectedRelativePath ||
      path.isAbsolute(owner.backupRelativePath) ||
      !boundaryIsKnown ||
      !hasExactOwnedBackupContents(ownedDir)
    ) {
      continue;
    }
    const evidence = evidenceByPath.get(expectedRelativePath);
    if (evidence) {
      const attempt = attemptByBackupId.get(owner.backupEvidenceId);
      if (
        evidence.backup_evidence_id !== owner.backupEvidenceId ||
        evidence.database_id !== owner.databaseId ||
        Number(evidence.from_user_version) !== owner.fromUserVersion ||
        evidence.manifest_hash !== owner.targetManifestHash ||
        !attempt ||
        attempt.attempt_id !== owner.attemptId ||
        attempt.database_id !== owner.databaseId ||
        attempt.target_manifest_hash !== owner.targetManifestHash ||
        attempt.backup_evidence_id !== owner.backupEvidenceId
      ) {
        throw migrationBlocked(
          `Owned later migration backup ${owner.attemptId} is not bound to its durable evidence.`
        );
      }
      continue;
    }
    if (attemptByBackupId.has(owner.backupEvidenceId)) {
      throw migrationBlocked(
        `Owned later migration backup ${owner.attemptId} has partial durable evidence.`
      );
    }
    quarantineOwnedLaterBackupDirectory(dataDir, ownedDir);
  }
}

function createLaterMigrationBackupOwner(
  input: Omit<LaterMigrationBackupOwner, "schemaVersion" | "ownerHash">
): LaterMigrationBackupOwner {
  assertCanonicalTimestamp(input.createdAt, "later backup owner createdAt");
  const withoutHash = {
    schemaVersion: "later_migration_backup_owner.v1" as const,
    ...input
  };
  const ownerHash = hashFramed(
    "vdt-studio/later-migration-backup-owner",
    "later_migration_backup_owner_hash.v1",
    withoutHash as unknown as JsonValue
  );
  return { ...withoutHash, ownerHash };
}

function readLaterMigrationBackupOwner(
  ownedDir: string
): LaterMigrationBackupOwner | null {
  const ownerPath = path.join(ownedDir, "owner.json");
  try {
    const stat = fs.lstatSync(ownerPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const raw = fs.readFileSync(ownerPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    assertDensePlainJson(parsed);
    if (!isPlainRecord(parsed)) return null;
    assertExactKeys(
      parsed,
      [
        "schemaVersion",
        "databaseId",
        "attemptId",
        "backupEvidenceId",
        "targetManifestHash",
        "fromUserVersion",
        "backupRelativePath",
        "createdAt",
        "ownerHash"
      ],
      "later migration backup owner"
    );
    if (
      parsed.schemaVersion !== "later_migration_backup_owner.v1" ||
      typeof parsed.databaseId !== "string" ||
      parsed.databaseId.length === 0 ||
      typeof parsed.attemptId !== "string" ||
      !/^migration_attempt_[A-Za-z0-9_-]+$/.test(parsed.attemptId) ||
      typeof parsed.backupEvidenceId !== "string" ||
      !/^migration_backup_[A-Za-z0-9_-]+$/.test(parsed.backupEvidenceId) ||
      !Number.isSafeInteger(parsed.fromUserVersion) ||
      Number(parsed.fromUserVersion) < 2 ||
      typeof parsed.backupRelativePath !== "string" ||
      parsed.backupRelativePath.length === 0 ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    assertSha256(parsed.targetManifestHash, "later backup owner manifest hash");
    assertSha256(parsed.ownerHash, "later backup owner hash");
    assertCanonicalTimestamp(parsed.createdAt, "later backup owner createdAt");
    if (canonicalizeJson(parsed) !== raw) return null;
    const withoutHash = { ...parsed };
    delete withoutHash.ownerHash;
    const ownerHash = hashFramed(
      "vdt-studio/later-migration-backup-owner",
      "later_migration_backup_owner_hash.v1",
      withoutHash
    );
    if (ownerHash !== parsed.ownerHash) return null;
    return {
      schemaVersion: parsed.schemaVersion,
      databaseId: parsed.databaseId,
      attemptId: parsed.attemptId,
      backupEvidenceId: parsed.backupEvidenceId,
      targetManifestHash: parsed.targetManifestHash,
      fromUserVersion: Number(parsed.fromUserVersion),
      backupRelativePath: parsed.backupRelativePath,
      createdAt: parsed.createdAt,
      ownerHash: parsed.ownerHash
    };
  } catch {
    return null;
  }
}

function hasExactOwnedBackupContents(ownedDir: string): boolean {
  const entries = fs.readdirSync(ownedDir, { withFileTypes: true });
  if (
    entries.some(
      (entry) => entry.name !== "owner.json" && entry.name !== "backup.sqlite"
    )
  ) {
    return false;
  }
  const owner = entries.find((entry) => entry.name === "owner.json");
  const backup = entries.find((entry) => entry.name === "backup.sqlite");
  return (
    owner?.isFile() === true &&
    (backup === undefined || backup.isFile())
  );
}

function quarantineOwnedLaterBackupDirectory(
  dataDir: string,
  ownedDir: string
): void {
  const quarantineDir = path.join(
    dataDir,
    "migrations",
    "orphaned-backups"
  );
  const quarantineParent = path.dirname(quarantineDir);
  const quarantineExisted = fs.existsSync(quarantineDir);
  fs.mkdirSync(quarantineDir, { recursive: true });
  if (!quarantineExisted) fsyncDirectory(quarantineParent);
  const destination = path.join(quarantineDir, path.basename(ownedDir));
  assertInside(dataDir, destination);
  if (fs.existsSync(destination)) {
    throw migrationBlocked(
      `Owned later migration backup quarantine already exists: ${path.basename(ownedDir)}.`
    );
  }
  fs.renameSync(ownedDir, destination);
  fsyncDirectory(path.dirname(ownedDir));
  fsyncDirectory(quarantineDir);
}

function applyLaterMigrationAttempt(
  db: DatabaseSync,
  dataDir: string,
  originalAttempt: LaterMigrationAttemptSnapshot,
  plan: ValidatedStorageMigrationPlan,
  options: StorageMigrationOptions
): void {
  let attempt = originalAttempt;
  for (;;) {
    const row = readLaterAttempt(db, attempt.attemptId);
    if (row.status === "completed") return;
    if (
      row.ownerToken !== attempt.ownerToken ||
      row.leaseGeneration !== attempt.leaseGeneration ||
      row.leaseExpiresAt !== attempt.leaseExpiresAt ||
      row.nextSequence !== attempt.nextSequence ||
      row.status !== attempt.status ||
      row.activeMigrationId !== attempt.activeMigrationId
    ) {
      throw lostMigrationLease(attempt.attemptId);
    }
    attempt = {
      ...attempt,
      ...row,
      status: row.status as "backed_up" | "applying"
    };
    const entry = plan.entries[attempt.nextSequence - 1]?.manifestEntry;
    if (!entry || attempt.nextSequence > attempt.targetSequence) {
      throw migrationBlocked(
        `Migration attempt ${attempt.attemptId} has no validated next entry.`
      );
    }
    const applyingTimestamp = migrationTimestamp(options.now);
    attempt = ensureLaterMigrationLease(
      db,
      attempt,
      options,
      applyingTimestamp
    );
    let context = laterMigrationFaultContext(
      attempt.attemptId,
      entry,
      attempt.targetSequence,
      attempt.targetManifestHash,
      attempt.leaseGeneration
    );
    if (attempt.status === "backed_up") {
      const changes = db.prepare(`
        UPDATE migration_attempts
        SET status = 'applying', active_migration_id = ?, updated_at = ?
        WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ?
          AND lease_expires_at = ? AND lease_expires_at > ?
          AND status = 'backed_up'
          AND next_sequence = ?
      `).run(
        entry.migrationId,
        applyingTimestamp.millis,
        attempt.attemptId,
        attempt.ownerToken,
        attempt.leaseGeneration,
        attempt.leaseExpiresAt,
        applyingTimestamp.millis,
        entry.sequence
      ).changes;
      if (changes !== 1) throw lostMigrationLease(attempt.attemptId);
      attempt = {
        ...attempt,
        status: "applying",
        activeMigrationId: entry.migrationId
      };
    } else if (
      attempt.status !== "applying" ||
      attempt.activeMigrationId !== entry.migrationId
    ) {
      throw migrationBlocked(
        `Migration attempt ${attempt.attemptId} is not applying ${entry.migrationId}.`
      );
    }
    options.faultInjector?.("after_later_applying_persisted", context);

    const preconditionFailure = laterMigrationPreconditionFailure(
      db,
      entry,
      plan.planKind === "v2-production"
    );
    if (preconditionFailure) {
      durablyBlockLaterMigrationAttempt(
        db,
        attempt,
        preconditionFailure.blockedReason,
        options
      );
      if (plan.planKind === "v2-production") {
        throw migrationRecoveryRequired(
          "Sequence 3 precondition did not match the accepted version-2 prefix."
        );
      }
      throw migrationBlocked(preconditionFailure.diagnostic);
    }
    const finalRenewalTimestamp = migrationTimestamp(options.now);
    attempt = ensureLaterMigrationLease(
      db,
      attempt,
      options,
      finalRenewalTimestamp
    );
    const commitTimestamp = migrationTimestamp(options.now);
    if (attempt.leaseExpiresAt <= commitTimestamp.millis) {
      throw lostMigrationLease(attempt.attemptId);
    }
    context = laterMigrationFaultContext(
      attempt.attemptId,
      entry,
      attempt.targetSequence,
      attempt.targetManifestHash,
      attempt.leaseGeneration
    );
    try {
      migrationApplicationTransaction(
        db,
        dataDir,
        migrationForeignKeyCheckIdentity({
          databaseId: attempt.databaseId,
          attemptId: attempt.attemptId,
          fenceOwnerToken: attempt.ownerToken,
          fenceLeaseGeneration: attempt.leaseGeneration,
          targetManifestHash: attempt.targetManifestHash,
          entry
        }),
        commitTimestamp.iso,
        options,
        () => {
          assertLaterAttemptFence(
            db,
            attempt,
            entry,
            commitTimestamp.millis
          );
          if (plan.planKind === "v2-production") {
            applySequence3InsideTransaction(
              db,
              attempt,
              entry,
              plan,
              commitTimestamp,
              options,
              context
            );
          } else {
            applyGenericLaterMigrationInsideTransaction(
              db,
              attempt,
              entry,
              plan,
              commitTimestamp,
              options,
              context
            );
          }
        },
        context
      );
    } catch (error) {
      const stateBlockReason =
        error instanceof Error ? migrationBlockReason(error) : undefined;
      if (stateBlockReason === "postcondition_failed") {
        finalizeForeignKeyBlockedAttempt(
          db,
          attempt,
          entry,
          plan,
          commitTimestamp,
          options,
          context
        );
      } else if (
        error instanceof Error &&
        error.name === "StorageMigrationBlockedError"
      ) {
        durablyBlockLaterMigrationAttempt(
          db,
          attempt,
          "postcondition_failed",
          options
        );
      }
      throw error;
    }
    if (plan.planKind !== "v2-production") {
      options.faultInjector?.("after_later_migration_committed", context);
    }
    if (entry.sequence === attempt.targetSequence) return;
    attempt = {
      ...attempt,
      nextSequence: entry.sequence + 1,
      status: "applying",
      activeMigrationId:
        plan.entries[entry.sequence]!.manifestEntry.migrationId
    };
  }
}

function applyGenericLaterMigrationInsideTransaction(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  entry: StorageMigrationManifestEntryV1,
  plan: ValidatedStorageMigrationTestPlan,
  commitTimestamp: { iso: string; millis: number },
  options: StorageMigrationOptions,
  context: StorageMigrationFaultContext
): void {
  try {
    db.exec(plan.entries[entry.sequence - 1]!.sqlBytes.toString("utf8"));
  } catch (error) {
    if (isSqliteBusy(error)) throw error;
    throw migrationBlocked(
      `Migration ${entry.migrationId} SQL failed: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
  db.prepare(`
    INSERT INTO applied_migrations
    (sequence, schema_version, database_id, migration_id, sql_checksum,
     from_user_version, to_user_version, precondition_schema_hash,
     postcondition_schema_hash, manifest_hash, application_id, applied_at)
    VALUES (?, 'applied_migration.v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.sequence,
    attempt.databaseId,
    entry.migrationId,
    entry.sqlChecksum,
    entry.fromUserVersion,
    entry.toUserVersion,
    entry.preconditionSchemaHash,
    entry.postconditionSchemaHash,
    attempt.targetManifestHash,
    `migration_application_${id(options.idFactory)}`,
    commitTimestamp.millis
  );
  db.prepare(
    "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)"
  ).run(entry.toUserVersion, commitTimestamp.millis);
  db.exec(`PRAGMA user_version = ${entry.toUserVersion};`);
  const postcondition = computeSchemaHash(db, entry.toUserVersion);
  if (postcondition !== entry.postconditionSchemaHash) {
    throw migrationBlocked(
      `Migration ${entry.migrationId} postcondition failed: ${postcondition}.`
    );
  }
  advanceLaterMigrationStateAndAttempt(
    db,
    attempt,
    entry,
    plan,
    commitTimestamp
  );
  options.faultInjector?.("before_later_migration_commit", context);
}

function applySequence3InsideTransaction(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  entry: StorageMigrationManifestEntryV1,
  plan: ValidatedStorageProductionPlanV2,
  commitTimestamp: { iso: string; millis: number },
  options: StorageMigrationOptions,
  context: StorageMigrationFaultContext
): void {
  if (
    entry.sequence !== 3 ||
    entry.migrationId !== SEQUENCE_3_MIGRATION_ID ||
    entry.sqlChecksum !== plan.sequence3Assets.sqlChecksum ||
    attempt.targetManifestHash !== plan.targetManifestHash ||
    plan.targetSequence !== 3
  ) {
    throw sequence3PostconditionFailure(
      "Sequence 3 closed transform dispatch rejected a non-frozen migration."
    );
  }
  const identity = sequence3MigrationIdentity(attempt, plan.sequence3Assets);
  const applicationId = sequence3MigrationApplicationId(identity);
  options.faultInjector?.("sequence3_before_sql", context);
  try {
    db.exec(plan.sequence3Assets.sqlText);
  } catch (error) {
    if (isSqliteBusy(error)) throw error;
    throw sequence3PostconditionFailure(
      `Sequence 3 SQL failed: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
  options.faultInjector?.("sequence3_after_sql", context);
  options.faultInjector?.("sequence3_before_transform_invocation", context);
  const transformed = validateLegacyAgentRunsForSequence3(
    db,
    identity,
    commitTimestamp.iso
  );
  if (transformed.outcome === "blocked") {
    throw sequence3PostconditionFailure(
      `Sequence 3 legacy adoption validation failed with ${transformed.code}.`
    );
  }
  if (transformed.migrationApplicationId !== applicationId) {
    throw sequence3PostconditionFailure(
      "Sequence 3 transform returned a mismatched migration application ID."
    );
  }
  const inputLegacyRunCount = transformed.adoptionCanonicalJson.length;
  if (
    transformed.legacyRowHashes.length !== inputLegacyRunCount ||
    !Number.isSafeInteger(inputLegacyRunCount)
  ) {
    throw sequence3PostconditionFailure(
      "Sequence 3 transform returned inconsistent adoption cardinalities."
    );
  }
  const transformContext = sequence3FaultContext(context, {
    inputLegacyRunCount
  });
  options.faultInjector?.(
    "sequence3_after_transform_invocation",
    transformContext
  );
  const expectedRunIds: string[] = [];
  transformed.adoptionCanonicalJson.forEach((canonicalEvidence, adoptionIndex) => {
    const adoption = parseSequence3AdoptionEvidence(
      canonicalEvidence,
      identity,
      transformed,
      adoptionIndex,
      commitTimestamp
    );
    expectedRunIds.push(adoption.runId);
    const rowContext = sequence3FaultContext(context, {
      adoptionIndex,
      inputLegacyRunCount,
      runId: adoption.runId
    });
    options.faultInjector?.(
      "sequence3_before_adoption_row_insert",
      rowContext
    );
    insertSequence3Adoption(db, adoption);
    options.faultInjector?.(
      "sequence3_after_adoption_row_insert",
      rowContext
    );
  });
  const adoptionSummary = readAndVerifySequence3Adoptions(
    db,
    identity.databaseId,
    applicationId,
    commitTimestamp.millis
  );
  if (
    adoptionSummary.length !== inputLegacyRunCount ||
    adoptionSummary.some(
      (row, index) =>
        row.runId !== expectedRunIds[index] ||
        row.legacyRowHash !== transformed.legacyRowHashes[index]
    )
  ) {
    throw sequence3PostconditionFailure(
      "Sequence 3 inserted adoption evidence did not match transform output."
    );
  }
  options.faultInjector?.(
    "sequence3_after_all_adoptions_verified",
    transformContext
  );
  options.faultInjector?.(
    "sequence3_before_transform_application_insert",
    transformContext
  );
  insertSequence3TransformApplication(
    db,
    identity,
    transformed,
    inputLegacyRunCount,
    commitTimestamp.millis
  );
  assertSequence3TransformApplicationInserted(
    db,
    identity,
    transformed,
    inputLegacyRunCount,
    commitTimestamp.millis
  );
  options.faultInjector?.(
    "sequence3_after_transform_application_insert",
    transformContext
  );
  options.faultInjector?.(
    "sequence3_before_applied_migration_insert",
    transformContext
  );
  insertAppliedMigration(
    db,
    attempt,
    entry,
    applicationId,
    commitTimestamp.millis
  );
  options.faultInjector?.(
    "sequence3_after_applied_migration_insert",
    transformContext
  );
  options.faultInjector?.(
    "sequence3_before_schema_migration_insert",
    transformContext
  );
  db.prepare(
    "INSERT INTO schema_migrations(version, applied_at) VALUES(3, ?)"
  ).run(commitTimestamp.millis);
  options.faultInjector?.(
    "sequence3_after_schema_migration_insert",
    transformContext
  );
  options.faultInjector?.(
    "sequence3_before_user_version_set",
    transformContext
  );
  db.exec("PRAGMA user_version = 3;");
  options.faultInjector?.(
    "sequence3_after_user_version_set",
    transformContext
  );
  const postcondition = computeSchemaHash(db, 3);
  if (postcondition !== entry.postconditionSchemaHash) {
    throw sequence3PostconditionFailure(
      `Sequence 3 postcondition failed: ${postcondition}.`
    );
  }
  options.faultInjector?.(
    "sequence3_after_postcondition_verified",
    transformContext
  );
  advanceLaterMigrationState(
    db,
    attempt,
    entry,
    plan
  );
  options.faultInjector?.(
    "sequence3_after_migration_state_advanced",
    transformContext
  );
  completeLaterMigrationAttempt(
    db,
    attempt,
    entry,
    commitTimestamp
  );
  options.faultInjector?.(
    "sequence3_after_attempt_completed",
    transformContext
  );
  options.faultInjector?.("before_later_migration_commit", transformContext);
}

function advanceLaterMigrationStateAndAttempt(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  entry: StorageMigrationManifestEntryV1,
  plan: ValidatedStorageMigrationTestPlan,
  commitTimestamp: { iso: string; millis: number }
): void {
  advanceLaterMigrationState(db, attempt, entry, plan);
  completeLaterMigrationAttempt(db, attempt, entry, commitTimestamp, plan);
}

function advanceLaterMigrationState(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  entry: StorageMigrationManifestEntryV1,
  plan: ValidatedStorageMigrationPlan
): void {
  const stateChanges =
    plan.planKind === "v2-production"
      ? db.prepare(`
          UPDATE migration_state
          SET manifest_hash = ?, current_user_version = 3,
              last_applied_sequence = 3, status = 'ready',
              blocked_reason = NULL
          WHERE database_id = ? AND manifest_hash = ?
            AND current_user_version = 2 AND last_applied_sequence = 2
            AND status = 'ready' AND blocked_reason IS NULL
        `).run(
          plan.targetManifestHash,
          attempt.databaseId,
          plan.historicalPrefixManifestHash
        ).changes
      : db.prepare(`
          UPDATE migration_state
          SET manifest_hash = ?, current_user_version = ?,
              last_applied_sequence = ?, status = 'ready',
              blocked_reason = NULL
          WHERE database_id = ? AND status = 'ready'
        `).run(
          plan.prefixHashes[entry.sequence - 1]!,
          entry.toUserVersion,
          entry.sequence,
          attempt.databaseId
        ).changes;
  if (stateChanges !== 1) {
    if (plan.planKind === "v2-production") {
      throw sequence3PostconditionFailure(
        "Sequence 3 could not advance its fenced migration state row."
      );
    }
    throw migrationBlocked(
      `Migration ${entry.migrationId} could not advance its fenced state row.`
    );
  }
}

function completeLaterMigrationAttempt(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  entry: StorageMigrationManifestEntryV1,
  commitTimestamp: { iso: string; millis: number },
  plan?: ValidatedStorageMigrationPlan
): void {
  const completed = entry.sequence === attempt.targetSequence;
  const nextSequence = entry.sequence + 1;
  const nextMigrationId = completed
    ? entry.migrationId
    : plan!.entries[nextSequence - 1]!.manifestEntry.migrationId;
  const changes = db.prepare(`
    UPDATE migration_attempts
    SET next_sequence = ?, status = ?,
        active_migration_id = ?, updated_at = ?, completed_at = ?
    WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ?
      AND lease_expires_at = ? AND lease_expires_at > ?
      AND status = 'applying'
      AND next_sequence = ? AND active_migration_id = ?
  `).run(
    nextSequence,
    completed ? "completed" : "applying",
    nextMigrationId,
    commitTimestamp.millis,
    completed ? commitTimestamp.millis : null,
    attempt.attemptId,
    attempt.ownerToken,
    attempt.leaseGeneration,
    attempt.leaseExpiresAt,
    commitTimestamp.millis,
    entry.sequence,
    entry.migrationId
  ).changes;
  if (changes !== 1) throw lostMigrationLease(attempt.attemptId);
}

interface Sequence3JsonAttestation {
  isNull: boolean;
  rawUtf8Hash: Sha256 | null;
  utf8ByteLength: number;
}

interface Sequence3AdoptionEvidence {
  schemaVersion: "legacy_agent_run_adoption.v1";
  databaseId: string;
  migrationApplicationId: string;
  migrationSequence: 3;
  runId: string;
  projectId: string;
  vdtId: string | null;
  conversationId: string | null;
  disposition: "retained_terminal" | "interrupted_nonterminal";
  projectedStatus: "succeeded" | "failed" | "cancelled" | "interrupted_legacy";
  originalStatus:
    | "queued"
    | "running"
    | "needs_user_input"
    | "waiting_approval"
    | "succeeded"
    | "failed"
    | "cancelled";
  originalPhase: string;
  originalPhaseUtf8ByteLength: number;
  originalPhaseRawUtf8Hash: Sha256;
  requestJson: Sequence3JsonAttestation;
  publicSnapshotJson: Sequence3JsonAttestation;
  internalStateJson: Sequence3JsonAttestation;
  originalCreatedAtMillis: number;
  originalUpdatedAtMillis: number;
  originalCompletedAtMillis: number | null;
  legacyRowHash: Sha256;
  adoptedAt: string;
}

function sequence3MigrationIdentity(
  attempt: LaterMigrationAttemptSnapshot,
  assets: VerifiedSequence3Assets
): Sequence3MigrationIdentity {
  assertNonEmptyString(attempt.databaseId, "Sequence 3 databaseId");
  assertNonEmptyString(attempt.attemptId, "Sequence 3 attemptId");
  assertNonEmptyString(
    attempt.backupEvidenceId,
    "Sequence 3 backupEvidenceId"
  );
  assertNonEmptyString(attempt.ownerToken, "Sequence 3 fence owner");
  assertPositiveSafeInteger(
    attempt.leaseGeneration,
    "Sequence 3 fence generation"
  );
  const identity: Sequence3MigrationIdentity = {
    schemaVersion: "migration_application_identity.v1",
    databaseId: attempt.databaseId,
    attemptId: attempt.attemptId,
    backupEvidenceId: attempt.backupEvidenceId,
    fenceOwnerToken: attempt.ownerToken,
    fenceLeaseGeneration: attempt.leaseGeneration,
    targetManifestHash: attempt.targetManifestHash,
    sequence: 3,
    migrationId: SEQUENCE_3_MIGRATION_ID,
    sqlChecksum: assets.sqlChecksum,
    transformId: assets.identity.transformId,
    transformVersion: 1,
    moduleChecksum: assets.moduleChecksum,
    contractChecksum: assets.contractChecksum,
    goldenVectorsChecksum: assets.goldenVectorsChecksum
  };
  for (const [label, value] of [
    ["target manifest", identity.targetManifestHash],
    ["SQL", identity.sqlChecksum],
    ["module", identity.moduleChecksum],
    ["contract", identity.contractChecksum],
    ["golden vectors", identity.goldenVectorsChecksum]
  ] as const) {
    assertSha256(value, `Sequence 3 ${label} checksum`);
  }
  return identity;
}

function sequence3MigrationApplicationId(
  identity: Sequence3MigrationIdentity
): string {
  const identityHash = hashFramed(
    "vdt-studio/migration-application-identity",
    "migration_application_identity_hash.v1",
    identity as unknown as JsonValue
  );
  return `migration_application_${identityHash.slice("sha256:".length)}`;
}

function sequence3FaultContext(
  context: StorageMigrationFaultContext,
  additions: Pick<
    StorageMigrationFaultContext,
    "adoptionIndex" | "inputLegacyRunCount" | "runId"
  >
): StorageMigrationFaultContext {
  return {
    ...context,
    ...(additions.adoptionIndex === undefined
      ? {}
      : { adoptionIndex: additions.adoptionIndex }),
    ...(additions.inputLegacyRunCount === undefined
      ? {}
      : { inputLegacyRunCount: additions.inputLegacyRunCount }),
    ...(additions.runId === undefined ? {} : { runId: additions.runId })
  };
}

function parseSequence3AdoptionEvidence(
  canonicalEvidence: string,
  identity: Sequence3MigrationIdentity,
  transformed: Sequence3TransformAccepted,
  adoptionIndex: number,
  commitTimestamp: { iso: string; millis: number }
): Sequence3AdoptionEvidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalEvidence);
  } catch {
    throw sequence3PostconditionFailure(
      "Sequence 3 transform returned invalid canonical adoption JSON."
    );
  }
  try {
    assertDensePlainJson(parsed);
    if (!isPlainRecord(parsed)) throw new TypeError("adoption object");
    assertExactKeys(
      parsed,
      [
        "schemaVersion",
        "databaseId",
        "migrationApplicationId",
        "migrationSequence",
        "runId",
        "projectId",
        "vdtId",
        "conversationId",
        "disposition",
        "projectedStatus",
        "originalStatus",
        "originalPhase",
        "originalPhaseUtf8ByteLength",
        "originalPhaseRawUtf8Hash",
        "requestJson",
        "publicSnapshotJson",
        "internalStateJson",
        "originalCreatedAtMillis",
        "originalUpdatedAtMillis",
        "originalCompletedAtMillis",
        "legacyRowHash",
        "adoptedAt"
      ],
      "Sequence 3 adoption evidence"
    );
    if (canonicalizeJson(parsed) !== canonicalEvidence) {
      throw new TypeError("non-canonical adoption evidence");
    }
    const applicationId = sequence3MigrationApplicationId(identity);
    const evidence: Sequence3AdoptionEvidence = {
      schemaVersion: sequence3Literal(
        parsed.schemaVersion,
        "legacy_agent_run_adoption.v1",
        "adoption schema"
      ),
      databaseId: sequence3String(parsed.databaseId, "adoption database"),
      migrationApplicationId: sequence3String(
        parsed.migrationApplicationId,
        "adoption application"
      ),
      migrationSequence: sequence3Literal(
        parsed.migrationSequence,
        3,
        "adoption sequence"
      ),
      runId: sequence3String(parsed.runId, "adoption run"),
      projectId: sequence3String(parsed.projectId, "adoption project"),
      vdtId: sequence3NullableString(parsed.vdtId, "adoption vdt"),
      conversationId: sequence3NullableString(
        parsed.conversationId,
        "adoption conversation"
      ),
      disposition: sequence3Union(
        parsed.disposition,
        ["retained_terminal", "interrupted_nonterminal"] as const,
        "adoption disposition"
      ),
      projectedStatus: sequence3Union(
        parsed.projectedStatus,
        ["succeeded", "failed", "cancelled", "interrupted_legacy"] as const,
        "adoption projected status"
      ),
      originalStatus: sequence3Union(
        parsed.originalStatus,
        [
          "queued",
          "running",
          "needs_user_input",
          "waiting_approval",
          "succeeded",
          "failed",
          "cancelled"
        ] as const,
        "adoption original status"
      ),
      originalPhase: sequence3String(
        parsed.originalPhase,
        "adoption original phase"
      ),
      originalPhaseUtf8ByteLength: sequence3SafeInteger(
        parsed.originalPhaseUtf8ByteLength,
        "adoption phase byte length"
      ),
      originalPhaseRawUtf8Hash: sequence3Sha256(
        parsed.originalPhaseRawUtf8Hash,
        "adoption phase hash"
      ),
      requestJson: sequence3Attestation(
        parsed.requestJson,
        "adoption request"
      ),
      publicSnapshotJson: sequence3Attestation(
        parsed.publicSnapshotJson,
        "adoption public snapshot"
      ),
      internalStateJson: sequence3Attestation(
        parsed.internalStateJson,
        "adoption internal state"
      ),
      originalCreatedAtMillis: sequence3SafeInteger(
        parsed.originalCreatedAtMillis,
        "adoption createdAt"
      ),
      originalUpdatedAtMillis: sequence3SafeInteger(
        parsed.originalUpdatedAtMillis,
        "adoption updatedAt"
      ),
      originalCompletedAtMillis:
        parsed.originalCompletedAtMillis === null
          ? null
          : sequence3SafeInteger(
              parsed.originalCompletedAtMillis,
              "adoption completedAt"
            ),
      legacyRowHash: sequence3Sha256(
        parsed.legacyRowHash,
        "adoption row hash"
      ),
      adoptedAt: sequence3String(parsed.adoptedAt, "adoption adoptedAt")
    };
    if (
      evidence.databaseId !== identity.databaseId ||
      evidence.migrationApplicationId !== applicationId ||
      evidence.adoptedAt !== commitTimestamp.iso ||
      Date.parse(evidence.adoptedAt) !== commitTimestamp.millis ||
      evidence.legacyRowHash !== transformed.legacyRowHashes[adoptionIndex] ||
      evidence.requestJson.isNull
    ) {
      throw new TypeError("adoption identity mismatch");
    }
    return evidence;
  } catch (error) {
    if (
      error instanceof VdtStorageError &&
      error.code === "MIGRATION_RECOVERY_REQUIRED"
    ) {
      throw error;
    }
    throw sequence3PostconditionFailure(
      `Sequence 3 adoption evidence was invalid: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
}

function insertSequence3Adoption(
  db: DatabaseSync,
  adoption: Sequence3AdoptionEvidence
): void {
  try {
    db.prepare(`
      INSERT INTO legacy_agent_run_adoptions_v1
      (run_id, schema_version, database_id, migration_application_id,
       migration_sequence, project_id, vdt_id, conversation_id,
       original_status, original_phase, original_phase_utf8_byte_length,
       original_phase_raw_utf8_hash, request_json_is_null,
       request_json_utf8_byte_length, request_json_raw_utf8_hash,
       public_snapshot_json_is_null, public_snapshot_json_utf8_byte_length,
       public_snapshot_json_raw_utf8_hash, internal_state_json_is_null,
       internal_state_json_utf8_byte_length, internal_state_json_raw_utf8_hash,
       original_created_at_millis, original_updated_at_millis,
       original_completed_at_millis, disposition, projected_status,
       legacy_row_hash, adopted_at)
      VALUES (?, 'legacy_agent_run_adoption.v1', ?, ?, 3, ?, ?, ?, ?, ?, ?, ?,
              0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      adoption.runId,
      adoption.databaseId,
      adoption.migrationApplicationId,
      adoption.projectId,
      adoption.vdtId,
      adoption.conversationId,
      adoption.originalStatus,
      adoption.originalPhase,
      adoption.originalPhaseUtf8ByteLength,
      adoption.originalPhaseRawUtf8Hash,
      adoption.requestJson.utf8ByteLength,
      adoption.requestJson.rawUtf8Hash,
      adoption.publicSnapshotJson.isNull ? 1 : 0,
      adoption.publicSnapshotJson.utf8ByteLength,
      adoption.publicSnapshotJson.rawUtf8Hash,
      adoption.internalStateJson.isNull ? 1 : 0,
      adoption.internalStateJson.utf8ByteLength,
      adoption.internalStateJson.rawUtf8Hash,
      adoption.originalCreatedAtMillis,
      adoption.originalUpdatedAtMillis,
      adoption.originalCompletedAtMillis,
      adoption.disposition,
      adoption.projectedStatus,
      adoption.legacyRowHash,
      Date.parse(adoption.adoptedAt)
    );
  } catch (error) {
    if (isSqliteBusy(error)) throw error;
    throw sequence3PostconditionFailure(
      `Sequence 3 adoption insert failed: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
}

function insertSequence3TransformApplication(
  db: DatabaseSync,
  identity: Sequence3MigrationIdentity,
  transformed: Sequence3TransformAccepted,
  inputLegacyRunCount: number,
  appliedAt: number
): void {
  try {
    db.prepare(`
      INSERT INTO migration_transform_applications_v1
      (database_id, migration_application_id, sequence, schema_version,
       migration_id, transform_id, transform_version, artifact_format,
       abi_version, module_checksum, contract_checksum,
       golden_vectors_checksum, input_legacy_run_count,
       inserted_adoption_count, transform_result_hash, applied_at,
       migration_attempt_id, backup_evidence_id, fence_owner_token,
       fence_lease_generation, target_manifest_hash, sql_checksum)
      VALUES (?, ?, 3, 'migration_transform_application.v1',
              '003-durable-agent-run-coordination',
              'legacy-agent-run-adoption-v1', 1, 'wasm32-no-imports-v1',
              'legacy-agent-run-adoption-abi.v1', ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?)
    `).run(
      identity.databaseId,
      transformed.migrationApplicationId,
      identity.moduleChecksum,
      identity.contractChecksum,
      identity.goldenVectorsChecksum,
      inputLegacyRunCount,
      inputLegacyRunCount,
      transformed.transformResultHash,
      appliedAt,
      identity.attemptId,
      identity.backupEvidenceId,
      identity.fenceOwnerToken,
      identity.fenceLeaseGeneration,
      identity.targetManifestHash,
      identity.sqlChecksum
    );
  } catch (error) {
    if (isSqliteBusy(error)) throw error;
    throw sequence3PostconditionFailure(
      `Sequence 3 transform application insert failed: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
}

function assertSequence3TransformApplicationInserted(
  db: DatabaseSync,
  identity: Sequence3MigrationIdentity,
  transformed: Sequence3TransformAccepted,
  inputLegacyRunCount: number,
  appliedAt: number
): void {
  const row = db.prepare(`
    SELECT database_id, migration_application_id, sequence, schema_version,
           migration_id, transform_id, transform_version, artifact_format,
           abi_version, module_checksum, contract_checksum,
           golden_vectors_checksum, input_legacy_run_count,
           inserted_adoption_count, transform_result_hash, applied_at,
           migration_attempt_id, backup_evidence_id, fence_owner_token,
           fence_lease_generation, target_manifest_hash, sql_checksum
    FROM migration_transform_applications_v1
    WHERE database_id = ? AND migration_application_id = ? AND sequence = 3
  `).get(identity.databaseId, transformed.migrationApplicationId) as
    | Record<string, unknown>
    | undefined;
  if (
    !row ||
    row.database_id !== identity.databaseId ||
    row.migration_application_id !== transformed.migrationApplicationId ||
    Number(row.sequence) !== 3 ||
    row.schema_version !== "migration_transform_application.v1" ||
    row.migration_id !== SEQUENCE_3_MIGRATION_ID ||
    row.transform_id !== "legacy-agent-run-adoption-v1" ||
    Number(row.transform_version) !== 1 ||
    row.artifact_format !== "wasm32-no-imports-v1" ||
    row.abi_version !== "legacy-agent-run-adoption-abi.v1" ||
    row.module_checksum !== identity.moduleChecksum ||
    row.contract_checksum !== identity.contractChecksum ||
    row.golden_vectors_checksum !== identity.goldenVectorsChecksum ||
    Number(row.input_legacy_run_count) !== inputLegacyRunCount ||
    Number(row.inserted_adoption_count) !== inputLegacyRunCount ||
    row.transform_result_hash !== transformed.transformResultHash ||
    Number(row.applied_at) !== appliedAt ||
    row.migration_attempt_id !== identity.attemptId ||
    row.backup_evidence_id !== identity.backupEvidenceId ||
    row.fence_owner_token !== identity.fenceOwnerToken ||
    Number(row.fence_lease_generation) !== identity.fenceLeaseGeneration ||
    row.target_manifest_hash !== identity.targetManifestHash ||
    row.sql_checksum !== identity.sqlChecksum ||
    sequence3MigrationApplicationId(identity) !==
      transformed.migrationApplicationId
  ) {
    throw sequence3PostconditionFailure(
      "Sequence 3 transform application did not retain its exact identity."
    );
  }
}

function insertAppliedMigration(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  entry: StorageMigrationManifestEntryV1,
  applicationId: string,
  appliedAt: number
): void {
  try {
    db.prepare(`
      INSERT INTO applied_migrations
      (sequence, schema_version, database_id, migration_id, sql_checksum,
       from_user_version, to_user_version, precondition_schema_hash,
       postcondition_schema_hash, manifest_hash, application_id, applied_at)
      VALUES (3, 'applied_migration.v1', ?, ?, ?, 2, 3, ?, ?, ?, ?, ?)
    `).run(
      attempt.databaseId,
      entry.migrationId,
      entry.sqlChecksum,
      entry.preconditionSchemaHash,
      entry.postconditionSchemaHash,
      attempt.targetManifestHash,
      applicationId,
      appliedAt
    );
  } catch (error) {
    if (isSqliteBusy(error)) throw error;
    throw sequence3PostconditionFailure(
      `Sequence 3 applied-migration insert failed: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
}

function readAndVerifySequence3Adoptions(
  db: DatabaseSync,
  databaseId: string,
  applicationId: string,
  adoptedAt: number
): Array<{ runId: string; legacyRowHash: Sha256 }> {
  const rows = db.prepare(`
    SELECT run_id, schema_version, database_id, migration_application_id,
           migration_sequence, project_id, vdt_id, conversation_id,
           original_status, original_phase, original_phase_utf8_byte_length,
           original_phase_raw_utf8_hash, request_json_is_null,
           request_json_utf8_byte_length, request_json_raw_utf8_hash,
           public_snapshot_json_is_null, public_snapshot_json_utf8_byte_length,
           public_snapshot_json_raw_utf8_hash, internal_state_json_is_null,
           internal_state_json_utf8_byte_length,
           internal_state_json_raw_utf8_hash, original_created_at_millis,
           original_updated_at_millis, original_completed_at_millis,
           disposition, projected_status, legacy_row_hash, adopted_at
    FROM legacy_agent_run_adoptions_v1
    WHERE database_id = ? AND migration_application_id = ?
      AND migration_sequence = 3
    ORDER BY CAST(run_id AS BLOB) ASC
  `).all(databaseId, applicationId) as Array<Record<string, unknown>>;
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM legacy_agent_run_adoptions_v1
  `);
  total.setReadBigInts(true);
  const totalRow = total.get() as { count?: unknown } | undefined;
  if (
    typeof totalRow?.count !== "bigint" ||
    totalRow.count !== BigInt(rows.length)
  ) {
    throw sequence3PostconditionFailure(
      "Sequence 3 adoption table contains foreign or duplicate evidence."
    );
  }
  let previousRunId: Buffer | undefined;
  return rows.map((row, index) => {
    const runId = sequence3String(row.run_id, "persisted adoption run");
    const rawRunId = Buffer.from(runId, "utf8");
    if (
      previousRunId !== undefined &&
      Buffer.compare(previousRunId, rawRunId) >= 0
    ) {
      throw sequence3PostconditionFailure(
        `Sequence 3 adoption order is invalid at row ${index}.`
      );
    }
    previousRunId = rawRunId;
    const legacyRowHash = sequence3Sha256(
      row.legacy_row_hash,
      "persisted adoption row hash"
    );
    const metadata = {
      schemaVersion: sequence3Literal(
        row.schema_version,
        "legacy_agent_run_adoption.v1",
        "persisted adoption schema"
      ),
      databaseId: sequence3String(
        row.database_id,
        "persisted adoption database"
      ),
      migrationApplicationId: sequence3String(
        row.migration_application_id,
        "persisted adoption application"
      ),
      migrationSequence: sequence3Literal(
        Number(row.migration_sequence),
        3,
        "persisted adoption sequence"
      ),
      runId,
      projectId: sequence3String(
        row.project_id,
        "persisted adoption project"
      ),
      vdtId: sequence3NullableString(
        row.vdt_id,
        "persisted adoption vdt"
      ),
      conversationId: sequence3NullableString(
        row.conversation_id,
        "persisted adoption conversation"
      ),
      disposition: sequence3Union(
        row.disposition,
        ["retained_terminal", "interrupted_nonterminal"] as const,
        "persisted adoption disposition"
      ),
      projectedStatus: sequence3Union(
        row.projected_status,
        ["succeeded", "failed", "cancelled", "interrupted_legacy"] as const,
        "persisted adoption projected status"
      ),
      originalStatus: sequence3Union(
        row.original_status,
        [
          "queued",
          "running",
          "needs_user_input",
          "waiting_approval",
          "succeeded",
          "failed",
          "cancelled"
        ] as const,
        "persisted adoption original status"
      ),
      originalPhase: sequence3String(
        row.original_phase,
        "persisted adoption original phase"
      ),
      originalPhaseUtf8ByteLength: sequence3SafeInteger(
        row.original_phase_utf8_byte_length,
        "persisted adoption phase length"
      ),
      originalPhaseRawUtf8Hash: sequence3Sha256(
        row.original_phase_raw_utf8_hash,
        "persisted adoption phase hash"
      ),
      requestJson: sequence3AttestationFromRow(row, "request_json"),
      publicSnapshotJson: sequence3AttestationFromRow(
        row,
        "public_snapshot_json"
      ),
      internalStateJson: sequence3AttestationFromRow(
        row,
        "internal_state_json"
      ),
      originalCreatedAtMillis: sequence3SafeInteger(
        row.original_created_at_millis,
        "persisted adoption createdAt"
      ),
      originalUpdatedAtMillis: sequence3SafeInteger(
        row.original_updated_at_millis,
        "persisted adoption updatedAt"
      ),
      originalCompletedAtMillis:
        row.original_completed_at_millis === null
          ? null
          : sequence3SafeInteger(
              row.original_completed_at_millis,
              "persisted adoption completedAt"
            )
    };
    if (
      metadata.databaseId !== databaseId ||
      metadata.migrationApplicationId !== applicationId ||
      sequence3SafeInteger(
        row.adopted_at,
        "persisted adoption adoptedAt"
      ) !== adoptedAt ||
      hashFramed(
        "vdt-studio/legacy-agent-run-adoption",
        "legacy_agent_run_adoption_hash.v1",
        metadata as unknown as JsonValue
      ) !== legacyRowHash
    ) {
      throw sequence3PostconditionFailure(
        `Sequence 3 adoption hash or identity mismatch for row ${index}.`
      );
    }
    return { runId, legacyRowHash };
  });
}

function verifySequence3ReadyState(
  db: DatabaseSync,
  plan: ValidatedStorageProductionPlanV2
): void {
  const applications = db.prepare(`
    SELECT database_id, migration_application_id, sequence, schema_version,
           migration_id, transform_id, transform_version, artifact_format,
           abi_version, module_checksum, contract_checksum,
           golden_vectors_checksum, input_legacy_run_count,
           inserted_adoption_count, transform_result_hash, applied_at,
           migration_attempt_id, backup_evidence_id, fence_owner_token,
           fence_lease_generation, target_manifest_hash, sql_checksum
    FROM migration_transform_applications_v1
    ORDER BY database_id, migration_application_id, sequence
  `).all() as Array<Record<string, unknown>>;
  const application = applications[0];
  if (
    applications.length !== 1 ||
    !application ||
    Number(application.sequence) !== 3 ||
    application.schema_version !== "migration_transform_application.v1" ||
    application.migration_id !== SEQUENCE_3_MIGRATION_ID ||
    application.target_manifest_hash !== plan.targetManifestHash ||
    application.sql_checksum !== plan.sequence3Assets.sqlChecksum
  ) {
    throw sequence3AppliedPrefixFailure(
      "Sequence 3 ready state has no exact transform application parent binding."
    );
  }
  if (
    application.transform_id !== plan.sequence3Assets.identity.transformId ||
    Number(application.transform_version) !== 1 ||
    application.artifact_format !==
      plan.sequence3Assets.identity.artifactFormat ||
    application.abi_version !== plan.sequence3Assets.identity.abiVersion ||
    application.module_checksum !== plan.sequence3Assets.moduleChecksum ||
    application.contract_checksum !== plan.sequence3Assets.contractChecksum ||
    application.golden_vectors_checksum !==
      plan.sequence3Assets.goldenVectorsChecksum
  ) {
    throw sequence3PostconditionFailure(
      "Sequence 3 ready transform identity or artifact binding is invalid."
    );
  }
  const identity: Sequence3MigrationIdentity = {
    schemaVersion: "migration_application_identity.v1",
    databaseId: sequence3String(
      application.database_id,
      "ready application database"
    ),
    attemptId: sequence3String(
      application.migration_attempt_id,
      "ready application attempt"
    ),
    backupEvidenceId: sequence3String(
      application.backup_evidence_id,
      "ready application backup"
    ),
    fenceOwnerToken: sequence3String(
      application.fence_owner_token,
      "ready application owner"
    ),
    fenceLeaseGeneration: sequence3SafeInteger(
      application.fence_lease_generation,
      "ready application generation"
    ),
    targetManifestHash: sequence3Sha256(
      application.target_manifest_hash,
      "ready target manifest"
    ),
    sequence: 3,
    migrationId: SEQUENCE_3_MIGRATION_ID,
    sqlChecksum: sequence3Sha256(
      application.sql_checksum,
      "ready SQL checksum"
    ),
    transformId: "legacy-agent-run-adoption-v1",
    transformVersion: 1,
    moduleChecksum: sequence3Sha256(
      application.module_checksum,
      "ready module checksum"
    ),
    contractChecksum: sequence3Sha256(
      application.contract_checksum,
      "ready contract checksum"
    ),
    goldenVectorsChecksum: sequence3Sha256(
      application.golden_vectors_checksum,
      "ready vector checksum"
    )
  };
  const applicationId = sequence3String(
    application.migration_application_id,
    "ready migration application"
  );
  const inputCount = sequence3SafeInteger(
    application.input_legacy_run_count,
    "ready input count"
  );
  const insertedCount = sequence3SafeInteger(
    application.inserted_adoption_count,
    "ready adoption count"
  );
  const appliedAt = sequence3SafeInteger(
    application.applied_at,
    "ready application timestamp"
  );
  if (
    identity.fenceLeaseGeneration < 1 ||
    sequence3MigrationApplicationId(identity) !== applicationId
  ) {
    throw sequence3AppliedPrefixFailure(
      "Sequence 3 ready application identity is invalid."
    );
  }
  if (insertedCount !== inputCount) {
    throw sequence3PostconditionFailure(
      "Sequence 3 ready application count is invalid."
    );
  }
  const adoptions = readAndVerifySequence3Adoptions(
    db,
    identity.databaseId,
    applicationId,
    appliedAt
  );
  if (adoptions.length !== inputCount) {
    throw sequence3PostconditionFailure(
      "Sequence 3 ready adoption cardinality is invalid."
    );
  }
  const sourceStatement = db.prepare(`
    SELECT CAST(r.id AS BLOB) AS id_bytes
    FROM legacy_agent_run_adoptions_v1 a
    JOIN agent_runs r ON r.id = a.run_id
    WHERE a.database_id = ? AND a.migration_application_id = ?
      AND a.migration_sequence = 3
    ORDER BY CAST(r.id AS BLOB) ASC
  `);
  const sourceRows = sourceStatement.all(
    identity.databaseId,
    applicationId
  ) as Array<{ id_bytes?: unknown }>;
  if (
    sourceRows.length !== inputCount ||
    sourceRows.some(
      (row, index) =>
        !(row.id_bytes instanceof Uint8Array) ||
        !Buffer.from(row.id_bytes).equals(
          Buffer.from(adoptions[index]!.runId, "utf8")
        )
    )
  ) {
    throw sequence3PostconditionFailure(
      "Sequence 3 ready adoption set does not match legacy source rows."
    );
  }
  const expectedResultHash = hashFramed(
    "vdt-studio/migration-transform-result",
    "migration_transform_result_hash.v1",
    {
      databaseId: identity.databaseId,
      migrationApplicationId: applicationId,
      sequence: 3,
      transformId: plan.sequence3Assets.identity.transformId,
      transformVersion: 1,
      artifactFormat: plan.sequence3Assets.identity.artifactFormat,
      abiVersion: plan.sequence3Assets.identity.abiVersion,
      moduleChecksum: identity.moduleChecksum,
      contractChecksum: identity.contractChecksum,
      goldenVectorsChecksum: identity.goldenVectorsChecksum,
      inputLegacyRunCount: inputCount,
      insertedAdoptionCount: insertedCount,
      sortedAdoptions: adoptions
    } as unknown as JsonValue
  );
  if (
    application.transform_result_hash !== expectedResultHash
  ) {
    throw sequence3PostconditionFailure(
      "Sequence 3 ready transform result hash is invalid."
    );
  }
  const parent = db.prepare(`
    SELECT database_id, application_id, sequence, migration_id, sql_checksum,
           manifest_hash, applied_at
    FROM applied_migrations WHERE sequence = 3
  `).get() as Record<string, unknown> | undefined;
  const schema = db.prepare(`
    SELECT version, applied_at FROM schema_migrations WHERE version = 3
  `).get() as Record<string, unknown> | undefined;
  const attempt = db.prepare(`
    SELECT database_id, attempt_id, backup_evidence_id, target_manifest_hash,
           owner_token, lease_generation, next_sequence, status,
           active_migration_id, updated_at, completed_at
    FROM migration_attempts WHERE attempt_id = ?
  `).get(identity.attemptId) as Record<string, unknown> | undefined;
  const backup = db.prepare(`
    SELECT database_id, backup_evidence_id, manifest_hash
    FROM migration_backup_evidence WHERE backup_evidence_id = ?
  `).get(identity.backupEvidenceId) as Record<string, unknown> | undefined;
  if (
    !parent ||
    parent.database_id !== identity.databaseId ||
    parent.application_id !== applicationId ||
    Number(parent.sequence) !== 3 ||
    parent.migration_id !== SEQUENCE_3_MIGRATION_ID ||
    parent.sql_checksum !== identity.sqlChecksum ||
    parent.manifest_hash !== identity.targetManifestHash ||
    Number(parent.applied_at) !== appliedAt ||
    !schema ||
    Number(schema.version) !== 3 ||
    Number(schema.applied_at) !== appliedAt ||
    !attempt ||
    attempt.database_id !== identity.databaseId ||
    attempt.attempt_id !== identity.attemptId ||
    attempt.backup_evidence_id !== identity.backupEvidenceId ||
    attempt.target_manifest_hash !== identity.targetManifestHash ||
    attempt.owner_token !== identity.fenceOwnerToken ||
    Number(attempt.lease_generation) !== identity.fenceLeaseGeneration ||
    Number(attempt.next_sequence) !== 4 ||
    attempt.status !== "completed" ||
    attempt.active_migration_id !== SEQUENCE_3_MIGRATION_ID ||
    Number(attempt.updated_at) !== appliedAt ||
    Number(attempt.completed_at) !== appliedAt ||
    !backup ||
    backup.database_id !== identity.databaseId ||
    backup.backup_evidence_id !== identity.backupEvidenceId ||
    backup.manifest_hash !== identity.targetManifestHash
  ) {
    throw sequence3AppliedPrefixFailure(
      "Sequence 3 ready application parent, attempt, backup, or timestamps are invalid."
    );
  }
}

function sequence3AttestationFromRow(
  row: Record<string, unknown>,
  prefix: "request_json" | "public_snapshot_json" | "internal_state_json"
): Sequence3JsonAttestation {
  const isNullValue = sequence3SafeInteger(
    row[`${prefix}_is_null`],
    `${prefix} is-null`
  );
  if (isNullValue !== 0 && isNullValue !== 1) {
    throw sequence3PostconditionFailure(`${prefix} is-null is invalid.`);
  }
  const isNull = isNullValue === 1;
  const rawHash =
    row[`${prefix}_raw_utf8_hash`] === null
      ? null
      : sequence3Sha256(
          row[`${prefix}_raw_utf8_hash`],
          `${prefix} raw hash`
        );
  const utf8ByteLength = sequence3SafeInteger(
    row[`${prefix}_utf8_byte_length`],
    `${prefix} byte length`
  );
  if (
    (isNull && (rawHash !== null || utf8ByteLength !== 0)) ||
    (!isNull && rawHash === null) ||
    (prefix === "request_json" && isNull)
  ) {
    throw sequence3PostconditionFailure(
      `${prefix} attestation is inconsistent.`
    );
  }
  return { isNull, rawUtf8Hash: rawHash, utf8ByteLength };
}

function sequence3Attestation(
  value: unknown,
  label: string
): Sequence3JsonAttestation {
  if (!isPlainRecord(value)) throw new TypeError(`${label} is not an object`);
  assertExactKeys(
    value,
    ["isNull", "rawUtf8Hash", "utf8ByteLength"],
    label
  );
  if (typeof value.isNull !== "boolean") {
    throw new TypeError(`${label}.isNull is invalid`);
  }
  const rawUtf8Hash =
    value.rawUtf8Hash === null
      ? null
      : sequence3Sha256(value.rawUtf8Hash, `${label}.rawUtf8Hash`);
  const utf8ByteLength = sequence3SafeInteger(
    value.utf8ByteLength,
    `${label}.utf8ByteLength`
  );
  if (
    (value.isNull && (rawUtf8Hash !== null || utf8ByteLength !== 0)) ||
    (!value.isNull && rawUtf8Hash === null)
  ) {
    throw new TypeError(`${label} is inconsistent`);
  }
  return {
    isNull: value.isNull,
    rawUtf8Hash,
    utf8ByteLength
  };
}

function sequence3String(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function sequence3NullableString(
  value: unknown,
  label: string
): string | null {
  return value === null ? null : sequence3String(value, label);
}

function sequence3SafeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return parsed;
}

function sequence3Sha256(value: unknown, label: string): Sha256 {
  assertSha256(value, label);
  return value;
}

function sequence3Literal<const T extends string | number>(
  value: unknown,
  expected: T,
  label: string
): T {
  if (value !== expected) throw new TypeError(`${label} is invalid`);
  return expected;
}

function sequence3Union<const T extends readonly string[]>(
  value: unknown,
  accepted: T,
  label: string
): T[number] {
  if (
    typeof value !== "string" ||
    !(accepted as readonly string[]).includes(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T[number];
}

function sequence3PostconditionFailure(
  message: string
): VdtStorageError {
  const error = migrationRecoveryRequired(message) as MigrationBlockedWithEvidence &
    VdtStorageError;
  error.migrationBlockReason = "postcondition_failed";
  return error;
}

function sequence3AppliedPrefixFailure(
  message: string
): VdtStorageError {
  const error = migrationRecoveryRequired(message) as MigrationBlockedWithEvidence &
    VdtStorageError;
  error.migrationBlockReason = "applied_prefix_mismatch";
  return error;
}

function ensureLaterMigrationLease(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  options: StorageMigrationOptions,
  timestamp: { iso: string; millis: number }
): LaterMigrationAttemptSnapshot {
  return attempt.leaseExpiresAt <= timestamp.millis
    ? takeOverLaterMigrationAttempt(db, attempt, options, timestamp)
    : renewLaterMigrationAttempt(db, attempt, options, timestamp);
}

function renewLaterMigrationAttempt(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  options: StorageMigrationOptions,
  timestamp: { iso: string; millis: number }
): LaterMigrationAttemptSnapshot {
  const ownerToken = nextLaterMigrationOwnerToken(options, attempt.ownerToken);
  const leaseGeneration = attempt.leaseGeneration + 1;
  const leaseExpiresAt =
    timestamp.millis + effectiveLaterMigrationLeaseMs(options.leaseMs);
  const changes = db.prepare(`
    UPDATE migration_attempts
    SET owner_token = ?, lease_generation = ?, lease_expires_at = ?,
        updated_at = ?
    WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ?
      AND lease_expires_at = ? AND lease_expires_at > ?
      AND status IN ('backed_up', 'applying')
  `).run(
    ownerToken,
    leaseGeneration,
    leaseExpiresAt,
    timestamp.millis,
    attempt.attemptId,
    attempt.ownerToken,
    attempt.leaseGeneration,
    attempt.leaseExpiresAt,
    timestamp.millis
  ).changes;
  if (changes !== 1) throw lostMigrationLease(attempt.attemptId);
  return {
    ...attempt,
    ownerToken,
    leaseGeneration,
    leaseExpiresAt
  };
}

function nextLaterMigrationOwnerToken(
  options: StorageMigrationOptions,
  previousOwnerToken?: string
): string {
  const candidate =
    options.ownerTokenFactory?.() ?? `migration_owner_${id(options.idFactory)}`;
  if (candidate.length > 0 && candidate !== previousOwnerToken) {
    return candidate;
  }
  return `migration_owner_fence_${id()}`;
}

function readLaterAttempt(
  db: DatabaseSync,
  attemptId: string
):
  | Pick<
      LaterMigrationAttemptSnapshot,
      | "ownerToken"
      | "leaseGeneration"
      | "leaseExpiresAt"
      | "nextSequence"
      | "activeMigrationId"
    > & { status: "backed_up" | "applying" | "completed" } {
  const row = db.prepare(`
    SELECT owner_token, lease_generation, lease_expires_at, next_sequence,
           active_migration_id, status
    FROM migration_attempts WHERE attempt_id = ?
  `).get(attemptId) as Record<string, unknown> | undefined;
  if (
    !row ||
    typeof row.owner_token !== "string" ||
    !Number.isSafeInteger(Number(row.lease_generation)) ||
    !Number.isSafeInteger(Number(row.lease_expires_at)) ||
    !Number.isSafeInteger(Number(row.next_sequence)) ||
    (row.active_migration_id !== null &&
      typeof row.active_migration_id !== "string") ||
    (row.status !== "backed_up" &&
      row.status !== "applying" &&
      row.status !== "completed")
  ) {
    throw migrationBlocked(`Migration attempt ${attemptId} disappeared or became invalid.`);
  }
  return {
    ownerToken: row.owner_token,
    leaseGeneration: Number(row.lease_generation),
    leaseExpiresAt: Number(row.lease_expires_at),
    nextSequence: Number(row.next_sequence),
    activeMigrationId: row.active_migration_id,
    status: row.status
  };
}

function laterMigrationPreconditionFailure(
  db: DatabaseSync,
  entry: StorageMigrationManifestEntryV1,
  requireSequence3Encoding = false
): LaterMigrationPreconditionFailure | null {
  if (userVersion(db) !== entry.fromUserVersion) {
    return {
      diagnostic:
        `Migration ${entry.migrationId} expected user_version=` +
        `${entry.fromUserVersion}.`,
      blockedReason: "applied_prefix_mismatch"
    };
  }
  const schemaHash = computeSchemaHash(db, entry.fromUserVersion);
  if (schemaHash !== entry.preconditionSchemaHash) {
    return {
      diagnostic:
        `Migration ${entry.migrationId} precondition failed: ${schemaHash}.`,
      blockedReason: "precondition_failed"
    };
  }
  if (requireSequence3Encoding) {
    const encoding = db.prepare("PRAGMA encoding").get() as
      | Record<string, unknown>
      | undefined;
    if (encoding?.encoding !== "UTF-8") {
      return {
        diagnostic: `Migration ${entry.migrationId} requires UTF-8 encoding.`,
        blockedReason: "precondition_failed"
      };
    }
  }
  const application = db.prepare(
    "SELECT sequence, migration_id, sql_checksum FROM applied_migrations WHERE sequence = ? OR migration_id = ?"
  ).all(entry.sequence, entry.migrationId);
  if (application.length !== 0) {
    return {
      diagnostic:
        `Migration ${entry.migrationId} already has ambiguous application evidence.`,
      blockedReason: "applied_prefix_mismatch"
    };
  }
  return null;
}

function assertLaterAttemptFence(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  entry: StorageMigrationManifestEntryV1,
  now: number
): void {
  const row = db.prepare(`
    SELECT owner_token, lease_generation, lease_expires_at, status,
           next_sequence, active_migration_id
    FROM migration_attempts WHERE attempt_id = ?
  `).get(attempt.attemptId) as Record<string, unknown> | undefined;
  if (
    !row ||
    row.owner_token !== attempt.ownerToken ||
    Number(row.lease_generation) !== attempt.leaseGeneration ||
    Number(row.lease_expires_at) !== attempt.leaseExpiresAt ||
    Number(row.lease_expires_at) <= now ||
    row.status !== "applying" ||
    Number(row.next_sequence) !== entry.sequence ||
    row.active_migration_id !== entry.migrationId
  ) {
    throw lostMigrationLease(attempt.attemptId);
  }
}

function finalizeForeignKeyBlockedAttempt(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  entry: StorageMigrationManifestEntryV1,
  plan: ValidatedStorageMigrationPlan,
  timestamp: { iso: string; millis: number },
  options: StorageMigrationOptions,
  context?: StorageMigrationFaultContext
): void {
  transaction(db, () => {
    if (
      userVersion(db) !== entry.fromUserVersion ||
      computeSchemaHash(db, entry.fromUserVersion) !==
        entry.preconditionSchemaHash
    ) {
      throw migrationRecoveryRequired(
        "Foreign-key block finalization lost its schema precondition."
      );
    }
    const installed = db.prepare(`
      SELECT COUNT(*) AS count
      FROM applied_migrations
      WHERE sequence = ? OR migration_id = ?
    `).get(entry.sequence, entry.migrationId) as
      | Record<string, unknown>
      | undefined;
    if (Number(installed?.count) !== 0) {
      throw migrationRecoveryRequired(
        "Foreign-key block finalization found an applied migration."
      );
    }
    const attemptChanges = db.prepare(`
      UPDATE migration_attempts
      SET status = 'blocked', updated_at = ?, completed_at = NULL
      WHERE attempt_id = ? AND database_id = ?
        AND target_manifest_hash = ? AND backup_evidence_id = ?
        AND owner_token = ? AND lease_generation = ?
        AND next_sequence = ? AND active_migration_id = ?
        AND status = 'applying'
    `).run(
      timestamp.millis,
      attempt.attemptId,
      attempt.databaseId,
      attempt.targetManifestHash,
      attempt.backupEvidenceId,
      attempt.ownerToken,
      attempt.leaseGeneration,
      entry.sequence,
      entry.migrationId
    ).changes;
    if (attemptChanges !== 1) {
      throw migrationRecoveryRequired(
        "Foreign-key block finalization lost its exact attempt fence."
      );
    }
    const stateChanges = db.prepare(`
      UPDATE migration_state
      SET status = 'blocked', blocked_reason = 'postcondition_failed'
      WHERE database_id = ? AND manifest_hash = ?
        AND current_user_version = ? AND last_applied_sequence = ?
        AND status = 'ready' AND blocked_reason IS NULL
    `).run(
      attempt.databaseId,
      plan.prefixHashes[entry.sequence - 2]!,
      entry.fromUserVersion,
      entry.sequence - 1
    ).changes;
    if (stateChanges !== 1) {
      throw migrationRecoveryRequired(
        "Foreign-key block finalization lost its exact state prefix."
      );
    }
    const stillAbsent = db.prepare(`
      SELECT COUNT(*) AS count
      FROM applied_migrations
      WHERE sequence = ? OR migration_id = ?
    `).get(entry.sequence, entry.migrationId) as
      | Record<string, unknown>
      | undefined;
    if (Number(stillAbsent?.count) !== 0) {
      throw migrationRecoveryRequired(
        "Foreign-key block finalization application appeared during CAS."
      );
    }
    options.faultInjector?.("before_foreign_key_block_commit", context);
  });
  options.faultInjector?.("after_foreign_key_block_committed", context);
}

function durablyBlockLaterMigrationAttempt(
  db: DatabaseSync,
  attempt: LaterMigrationAttemptSnapshot,
  reason: MigrationStateBlockedReasonV1,
  options: StorageMigrationOptions
): void {
  const timestamp = migrationTimestamp(options.now);
  const row = readLaterAttempt(db, attempt.attemptId);
  const sameFence =
    row.ownerToken === attempt.ownerToken &&
    row.leaseGeneration === attempt.leaseGeneration &&
    row.leaseExpiresAt === attempt.leaseExpiresAt &&
    row.nextSequence === attempt.nextSequence &&
    row.status === attempt.status &&
    row.activeMigrationId === attempt.activeMigrationId;
  if (!sameFence && row.leaseExpiresAt > timestamp.millis) {
    throw lostMigrationLease(attempt.attemptId);
  }
  let blockingAttempt: LaterMigrationAttemptSnapshot = {
    ...attempt,
    ...row,
    status: row.status as "backed_up" | "applying"
  };
  blockingAttempt = ensureLaterMigrationLease(
    db,
    blockingAttempt,
    options,
    timestamp
  );
  transaction(db, () => {
    const changes = db.prepare(`
      UPDATE migration_attempts
      SET status = 'blocked', updated_at = ?, completed_at = NULL
      WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ?
        AND lease_expires_at = ? AND lease_expires_at > ?
        AND status IN ('backed_up', 'applying')
    `).run(
      timestamp.millis,
      blockingAttempt.attemptId,
      blockingAttempt.ownerToken,
      blockingAttempt.leaseGeneration,
      blockingAttempt.leaseExpiresAt,
      timestamp.millis
    ).changes;
    if (changes !== 1) throw lostMigrationLease(blockingAttempt.attemptId);
    const stateChanges = db.prepare(`
      UPDATE migration_state
      SET status = 'blocked', blocked_reason = ?
      WHERE database_id = ? AND status = 'ready' AND blocked_reason IS NULL
    `).run(reason, blockingAttempt.databaseId).changes;
    if (stateChanges !== 1) {
      throw migrationBlocked(
        `Migration ${blockingAttempt.activeMigrationId ?? blockingAttempt.nextSequence} could not durably block its fenced state row.`
      );
    }
  });
}

function laterMigrationFaultContext(
  attemptId: string,
  entry: StorageMigrationManifestEntryV1,
  targetSequence: number,
  targetManifestHash: Sha256,
  leaseGeneration: number
): StorageMigrationFaultContext {
  return {
    attemptId,
    sequence: entry.sequence,
    migrationId: entry.migrationId,
    targetSequence,
    targetManifestHash,
    leaseGeneration
  };
}

function migrationTimestamp(now: () => string): {
  iso: string;
  millis: number;
} {
  const iso = now();
  assertCanonicalTimestamp(iso, "migration now");
  return { iso, millis: Date.parse(iso) };
}

function effectiveLaterMigrationLeaseMs(configuredLeaseMs: number): number {
  return Math.max(1, positiveInteger(configuredLeaseMs, "migrationLeaseMs"));
}

function lostMigrationLease(attemptId: string): VdtStorageError {
  return new VdtStorageError(
    "MIGRATION_IN_PROGRESS",
    `Migration attempt ${attemptId} no longer owns its fenced lease.`,
    true
  );
}

function verifyLaterBackupEvidence(
  dataDir: string,
  evidence: {
    databaseId: string;
    fromUserVersion: number;
    targetManifestHash: Sha256;
    sourceDatabaseHash: Sha256;
    backupHash: Sha256;
    backupRelativePath: string;
  },
  expectedSchemaHash: Sha256
): void {
  assertSha256(evidence.targetManifestHash, "later backup target manifest hash");
  assertSha256(evidence.sourceDatabaseHash, "later backup source database hash");
  assertSha256(evidence.backupHash, "later backup hash");
  const backupPath = path.resolve(dataDir, evidence.backupRelativePath);
  assertInside(dataDir, backupPath);
  if (
    path.isAbsolute(evidence.backupRelativePath) ||
    !fs.existsSync(backupPath)
  ) {
    throw migrationBlocked(
      `Later migration backup is missing: ${evidence.backupRelativePath}.`
    );
  }
  const stat = fs.lstatSync(backupPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw migrationBlocked(
      `Later migration backup is not a regular file: ${evidence.backupRelativePath}.`
    );
  }
  fsyncFileAndDirectory(backupPath);
  const bytes = fs.readFileSync(backupPath);
  const actualHash = hashFramed(
    "vdt-studio/sqlite-backup",
    "sqlite_backup_hash.v1",
    {
      databaseId: evidence.databaseId,
      fromUserVersion: evidence.fromUserVersion
    },
    bytes
  );
  if (
    actualHash !== evidence.backupHash ||
    actualHash !== evidence.sourceDatabaseHash
  ) {
    throw migrationBlocked(
      `Later migration backup hash mismatch: ${evidence.backupRelativePath}.`
    );
  }
  let backupDb: DatabaseSync | undefined;
  try {
    backupDb = new DatabaseSync(backupPath, { readOnly: true, timeout: 5_000 });
    enableAndVerifyForeignKeyEnforcement(backupDb);
    const integrity = backupDb.prepare("PRAGMA integrity_check").get() as Record<
      string,
      unknown
    >;
    if (integrity.integrity_check !== "ok") {
      throw migrationBlocked(
        `Later migration backup integrity check failed: ${String(
          integrity.integrity_check
        )}.`
      );
    }
    if (
      userVersion(backupDb) !== evidence.fromUserVersion ||
      computeSchemaHash(backupDb, evidence.fromUserVersion) !==
        expectedSchemaHash
    ) {
      throw migrationBlocked(
        "Later migration backup does not match its exact manifest precondition."
      );
    }
    verifyNoForeignKeyViolations(backupDb);
  } catch (error) {
    if (isSqliteBusy(error)) throw error;
    if (
      error instanceof Error &&
      error.name === "StorageMigrationBlockedError"
    ) {
      throw error;
    }
    throw migrationBlocked(
      `Later migration backup could not be reopened and verified: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  } finally {
    backupDb?.close();
  }
}

function verifyLegacyAttestationCompleteness(db: DatabaseSync, dataDir: string): void {
  const legacyRows = db.prepare(`
    SELECT r.id AS revision_id, r.vdt_id, r.revision_no, r.file_path, r.graph_hash,
           v.project_id, a.schema_version, a.project_id AS attested_project_id,
           a.vdt_id AS attested_vdt_id, a.revision_no AS attested_revision_no,
           a.file_relative_path, a.content_scheme, a.content_hash,
           a.payload_byte_length, a.verified_at
    FROM vdt_revisions r
    JOIN vdts v ON v.id = r.vdt_id
    LEFT JOIN revision_commit_records c
      ON c.revision_id = r.id AND c.state = 'committed'
    LEFT JOIN legacy_revision_attestations a ON a.revision_id = r.id
    WHERE c.revision_id IS NULL
    ORDER BY r.id
  `).all() as Array<Record<string, unknown>>;
  const attestationCount = Number(
    (
      db.prepare("SELECT COUNT(*) AS count FROM legacy_revision_attestations").get() as
        Record<string, unknown>
    ).count
  );
  if (attestationCount !== legacyRows.length) {
    throw migrationBlocked("Legacy revision attestation count is incomplete.");
  }
  for (const row of legacyRows) {
    const relativePath = String(row.file_path);
    const absolutePath = path.resolve(dataDir, relativePath);
    assertInside(dataDir, absolutePath);
    if (!fs.existsSync(absolutePath)) {
      throw migrationBlocked(`Attested legacy revision file is missing: ${relativePath}.`);
    }
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw migrationBlocked(`Attested legacy revision is not a regular file: ${relativePath}.`);
    }
    const bytes = fs.readFileSync(absolutePath);
    const rawHash = createHash("sha256").update(bytes).digest("hex");
    if (
      row.schema_version !== "legacy_revision_attestation.v1" ||
      row.attested_project_id !== row.project_id ||
      row.attested_vdt_id !== row.vdt_id ||
      Number(row.attested_revision_no) !== Number(row.revision_no) ||
      row.file_relative_path !== row.file_path ||
      row.content_scheme !== "legacy_graph_sha256" ||
      row.content_hash !== `sha256:${String(row.graph_hash)}` ||
      Number(row.payload_byte_length) !== bytes.byteLength ||
      !Number.isSafeInteger(Number(row.verified_at)) ||
      rawHash !== row.graph_hash
    ) {
      throw migrationBlocked(`Legacy revision attestation mismatch: ${String(row.revision_id)}.`);
    }
  }
}

function verifyRuntimeBackfillCompleteness(db: DatabaseSync): void {
  const projectRows = db.prepare(`
    SELECT p.id AS project_id, s.project_id AS state_project_id, s.schema_version,
           s.runtime_generation, s.generation_version, s.migration_state,
           s.write_state, s.updated_at
    FROM projects p
    LEFT JOIN project_runtime_states s ON s.project_id = p.id
    ORDER BY p.id
  `).all() as Array<Record<string, unknown>>;
  const orphanProjectStates = Number(
    (
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM project_runtime_states s
        LEFT JOIN projects p ON p.id = s.project_id
        WHERE p.id IS NULL
      `).get() as Record<string, unknown>
    ).count
  );
  if (orphanProjectStates !== 0) {
    throw migrationBlocked("Project runtime state contains an orphan row.");
  }
  for (const row of projectRows) {
    const validRuntimeState =
      (row.runtime_generation === "v1" &&
        row.migration_state === "not_started" &&
        row.write_state === "disabled") ||
      (row.runtime_generation === "v1" &&
        row.migration_state === "shadow_ready" &&
        (row.write_state === "enabled" || row.write_state === "disabled")) ||
      (row.runtime_generation === "v1" &&
        row.migration_state === "migrating" &&
        row.write_state === "disabled") ||
      (row.runtime_generation === "v2" &&
        row.migration_state === "v2_active" &&
        (row.write_state === "enabled" || row.write_state === "disabled")) ||
      (row.runtime_generation === "v2" &&
        row.migration_state === "rollback_readonly" &&
        row.write_state === "disabled");
    if (
      row.state_project_id !== row.project_id ||
      row.schema_version !== "project_runtime_state.v1" ||
      !Number.isSafeInteger(Number(row.generation_version)) ||
      Number(row.generation_version) < 0 ||
      !validRuntimeState ||
      !Number.isSafeInteger(Number(row.updated_at))
    ) {
      throw migrationBlocked(
        `Project runtime state is incomplete or non-writable: ${String(row.project_id)}.`
      );
    }
  }

  const vdtRows = db.prepare(`
    SELECT v.id AS vdt_id, v.project_id, v.active_revision_id AS vdt_active_revision_id,
           h.vdt_id AS head_vdt_id, h.schema_version AS head_schema_version,
           h.project_id AS head_project_id, h.active_revision_id,
           h.active_content_scheme, h.active_content_hash, h.pending_revision_id,
           h.commit_generation, l.vdt_id AS lifecycle_vdt_id,
           l.project_id AS lifecycle_project_id, l.state AS lifecycle_state,
           l.initial_attempt_id, l.updated_at AS lifecycle_updated_at
    FROM vdts v
    LEFT JOIN vdt_revision_heads h ON h.vdt_id = v.id
    LEFT JOIN vdt_storage_lifecycles l ON l.vdt_id = v.id
    ORDER BY v.id
  `).all() as Array<Record<string, unknown>>;
  const orphanVdtState = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM vdt_revision_heads h
       LEFT JOIN vdts v ON v.id = h.vdt_id WHERE v.id IS NULL) AS orphan_heads,
      (SELECT COUNT(*) FROM vdt_storage_lifecycles l
       LEFT JOIN vdts v ON v.id = l.vdt_id WHERE v.id IS NULL) AS orphan_lifecycles
  `).get() as Record<string, unknown>;
  if (
    Number(orphanVdtState.orphan_heads) !== 0 ||
    Number(orphanVdtState.orphan_lifecycles) !== 0
  ) {
    throw migrationBlocked("VDT runtime state contains an orphan row.");
  }

  const maxRevision = db.prepare(`
    SELECT COALESCE(MAX(revision_no), 0) AS revision_no
    FROM vdt_revisions WHERE vdt_id = ?
  `);
  const activeEvidence = db.prepare(`
    SELECT r.id, c.state AS commit_state, c.payload_content_scheme,
           c.payload_content_hash, a.schema_version AS attestation_schema_version,
           a.content_scheme AS attestation_content_scheme,
           a.content_hash AS attestation_content_hash
    FROM vdt_revisions r
    LEFT JOIN revision_commit_records c
      ON c.revision_id = r.id AND c.vdt_id = r.vdt_id
    LEFT JOIN legacy_revision_attestations a
      ON a.revision_id = r.id AND a.vdt_id = r.vdt_id
    WHERE r.id = ? AND r.vdt_id = ?
  `);
  const pendingEvidence = db.prepare(`
    SELECT c.state AS commit_state, c.project_id, c.vdt_id,
           a.operation, a.state AS attempt_state
    FROM revision_commit_records c
    JOIN revision_commit_attempts a ON a.attempt_id = c.attempt_id
    WHERE c.revision_id = ?
  `);
  const lifecycleAttempt = db.prepare(`
    SELECT operation, project_id, vdt_id, state
    FROM revision_commit_attempts WHERE attempt_id = ?
  `);

  for (const row of vdtRows) {
    const commitGeneration = Number(row.commit_generation);
    const expectedGeneration = Number(
      (maxRevision.get(String(row.vdt_id)) as Record<string, unknown>).revision_no
    );
    if (
      row.head_vdt_id !== row.vdt_id ||
      row.head_schema_version !== "vdt_revision_head.v2" ||
      row.head_project_id !== row.project_id ||
      row.lifecycle_vdt_id !== row.vdt_id ||
      row.lifecycle_project_id !== row.project_id ||
      row.vdt_active_revision_id !== row.active_revision_id ||
      !Number.isSafeInteger(commitGeneration) ||
      commitGeneration < 0 ||
      commitGeneration !== expectedGeneration ||
      !Number.isSafeInteger(Number(row.lifecycle_updated_at))
    ) {
      throw migrationBlocked(
        `VDT runtime head/lifecycle binding is invalid: ${String(row.vdt_id)}.`
      );
    }

    if (row.active_revision_id === null) {
      if (row.active_content_scheme !== null || row.active_content_hash !== null) {
        throw migrationBlocked(
          `Empty VDT head has a non-empty content identity: ${String(row.vdt_id)}.`
        );
      }
    } else {
      const evidence = activeEvidence.get(
        String(row.active_revision_id),
        String(row.vdt_id)
      ) as Record<string, unknown> | undefined;
      const expectedScheme =
        evidence?.commit_state === "committed"
          ? evidence.payload_content_scheme
          : evidence?.attestation_schema_version === "legacy_revision_attestation.v1"
            ? evidence.attestation_content_scheme
            : undefined;
      const expectedHash =
        evidence?.commit_state === "committed"
          ? evidence.payload_content_hash
          : evidence?.attestation_schema_version === "legacy_revision_attestation.v1"
            ? evidence.attestation_content_hash
            : undefined;
      if (
        !evidence ||
        row.active_content_scheme !== expectedScheme ||
        row.active_content_hash !== expectedHash ||
        (expectedScheme !== "legacy_graph_sha256" &&
          expectedScheme !== "vdt_revision_payload_hash.v1") ||
        typeof expectedHash !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(expectedHash)
      ) {
        throw migrationBlocked(
          `Active VDT head is not bound to tagged revision evidence: ${String(row.vdt_id)}.`
        );
      }
    }

    if (row.pending_revision_id !== null) {
      const pending = pendingEvidence.get(
        String(row.pending_revision_id)
      ) as Record<string, unknown> | undefined;
      if (
        !pending ||
        pending.commit_state !== "pending" ||
        pending.project_id !== row.project_id ||
        pending.vdt_id !== row.vdt_id ||
        (pending.operation !== "revision.commit" &&
          pending.operation !== "vdt.create_with_initial") ||
        (pending.attempt_state !== "head_reserved" &&
          pending.attempt_state !== "published")
      ) {
        throw migrationBlocked(
          `Pending VDT head is not bound to a recoverable attempt: ${String(row.vdt_id)}.`
        );
      }
    }

    if (row.lifecycle_state === "ready") {
      if (row.initial_attempt_id !== null) {
        const initial = lifecycleAttempt.get(
          String(row.initial_attempt_id)
        ) as Record<string, unknown> | undefined;
        if (
          !initial ||
          initial.operation !== "vdt.create_with_initial" ||
          initial.project_id !== row.project_id ||
          initial.vdt_id !== row.vdt_id ||
          initial.state !== "completed"
        ) {
          throw migrationBlocked(
            `Ready VDT lifecycle is not bound to its completed initial attempt: ${String(row.vdt_id)}.`
          );
        }
      }
    } else if (row.lifecycle_state === "creating") {
      const initial =
        typeof row.initial_attempt_id === "string"
          ? (lifecycleAttempt.get(row.initial_attempt_id) as
              | Record<string, unknown>
              | undefined)
          : undefined;
      if (
        !initial ||
        initial.operation !== "vdt.create_with_initial" ||
        initial.project_id !== row.project_id ||
        initial.vdt_id !== row.vdt_id ||
        !["reserved", "staged", "head_reserved", "published"].includes(
          String(initial.state)
        )
      ) {
        throw migrationBlocked(
          `Creating VDT lifecycle is not bound to a recoverable initial attempt: ${String(row.vdt_id)}.`
        );
      }
    } else {
      throw migrationBlocked(`VDT lifecycle state is invalid: ${String(row.vdt_id)}.`);
    }
  }
}

function verifyLegacyRevisionState(
  db: DatabaseSync,
  dataDir: string
): { revisions: LegacyRevisionEvidence[]; vdts: LegacyVdtEvidence[] } {
  const revisionRows = db.prepare(`
    SELECT r.id, r.vdt_id, r.revision_no, r.file_path, r.graph_hash, v.project_id
    FROM vdt_revisions r
    LEFT JOIN vdts v ON v.id = r.vdt_id
    ORDER BY r.vdt_id, r.revision_no, r.id
  `).all() as Array<Record<string, unknown>>;
  const revisions: LegacyRevisionEvidence[] = [];
  const byId = new Map<string, LegacyRevisionEvidence>();
  for (const row of revisionRows) {
    if (row.project_id === null || row.project_id === undefined) {
      throw migrationBlocked(
        `Legacy revision ${String(row.id)} is orphaned from its owning VDT/project.`
      );
    }
    const relativePath = String(row.file_path);
    const absolutePath = path.resolve(dataDir, relativePath);
    assertInside(dataDir, absolutePath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw migrationBlocked(`Legacy revision is not an in-root regular file: ${relativePath}.`);
    }
    const bytes = fs.readFileSync(absolutePath);
    const storedHash = String(row.graph_hash);
    if (!/^[0-9a-f]{64}$/.test(storedHash)) {
      throw migrationBlocked(`Legacy revision ${String(row.id)} has a non-canonical graph hash.`);
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== storedHash) {
      throw migrationBlocked(`Legacy revision ${String(row.id)} failed byte hash verification.`);
    }
    const evidence: LegacyRevisionEvidence = {
      projectId: String(row.project_id),
      vdtId: String(row.vdt_id),
      revisionId: String(row.id),
      revisionNo: Number(row.revision_no),
      fileRelativePath: relativePath,
      rawGraphHash: storedHash,
      payloadByteLength: bytes.byteLength
    };
    revisions.push(evidence);
    byId.set(evidence.revisionId, evidence);
  }

  const vdtRows = db.prepare(`
    SELECT id, project_id, active_revision_id
    FROM vdts ORDER BY id
  `).all() as Array<Record<string, unknown>>;
  const vdts = vdtRows.map((row): LegacyVdtEvidence => {
    const vdtId = String(row.id);
    const own = revisions.filter((revision) => revision.vdtId === vdtId);
    const activeRevisionId = row.active_revision_id === null ? null : String(row.active_revision_id);
    if (own.length > 0 && activeRevisionId === null) {
      throw migrationBlocked(`Legacy VDT ${vdtId} has revisions but no active pointer.`);
    }
    if (own.length === 0 && activeRevisionId !== null) {
      throw migrationBlocked(`Legacy VDT ${vdtId} has an active pointer but no revisions.`);
    }
    const active = activeRevisionId === null ? undefined : byId.get(activeRevisionId);
    if (activeRevisionId !== null && (!active || active.vdtId !== vdtId)) {
      throw migrationBlocked(`Legacy VDT ${vdtId} has an invalid active revision pointer.`);
    }
    return {
      projectId: String(row.project_id),
      vdtId,
      activeRevisionId,
      activeGraphHash: active?.rawGraphHash ?? null,
      commitGeneration: own.reduce((max, revision) => Math.max(max, revision.revisionNo), 0)
    };
  });
  return { revisions, vdts };
}

function verifyNoForeignKeyViolations(db: DatabaseSync): void {
  const violations = readMigrationForeignKeyViolations(db);
  if (violations.length > 0) {
    const first = violations[0]!;
    throw migrationBlocked(
      `Foreign-key violation in ${first.table} row ${String(first.rowIdDecimal)}.`
    );
  }
}

function readMigrationForeignKeyViolations(
  db: DatabaseSync
): MigrationForeignKeyViolationV1[] {
  const statement = db.prepare("PRAGMA foreign_key_check");
  statement.setReadBigInts(true);
  const rows = statement.all() as Array<Record<string, unknown>>;
  const violations = rows.map((row): MigrationForeignKeyViolationV1 => {
    const rowIdDecimal =
      row.rowid === null
        ? null
        : canonicalSqliteInt64Decimal(row.rowid, "foreign-key rowid");
    const foreignKeyIndex =
      typeof row.fkid === "bigint" &&
      row.fkid >= 0n &&
      row.fkid <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(row.fkid)
        : Number.NaN;
    if (
      typeof row.table !== "string" ||
      typeof row.parent !== "string" ||
      !Number.isSafeInteger(foreignKeyIndex) ||
      foreignKeyIndex < 0
    ) {
      throw migrationRecoveryRequired(
        "PRAGMA foreign_key_check returned a non-canonical violation row."
      );
    }
    try {
      assertBoundedUnicodeString(
        row.table,
        "foreign-key violation table",
        1_024
      );
      assertBoundedUnicodeString(
        row.parent,
        "foreign-key violation parent",
        1_024
      );
    } catch (error) {
      throw migrationRecoveryRequired(
        `PRAGMA foreign_key_check returned an invalid bounded string: ${
          error instanceof Error ? error.message : String(error)
        }.`
      );
    }
    return {
      table: row.table,
      rowIdDecimal,
      parent: row.parent,
      foreignKeyIndex
    };
  });
  violations.sort(compareMigrationForeignKeyViolations);
  return violations;
}

function compareMigrationForeignKeyViolations(
  left: MigrationForeignKeyViolationV1,
  right: MigrationForeignKeyViolationV1
): number {
  const tableOrder = compareUtf8Strings(left.table, right.table);
  if (tableOrder !== 0) return tableOrder;
  const parentOrder = compareUtf8Strings(left.parent, right.parent);
  if (parentOrder !== 0) return parentOrder;
  if (left.foreignKeyIndex !== right.foreignKeyIndex) {
    return left.foreignKeyIndex - right.foreignKeyIndex;
  }
  if (left.rowIdDecimal === right.rowIdDecimal) return 0;
  if (left.rowIdDecimal === null) return -1;
  if (right.rowIdDecimal === null) return 1;
  const leftRowId = BigInt(left.rowIdDecimal);
  const rightRowId = BigInt(right.rowIdDecimal);
  return leftRowId < rightRowId ? -1 : leftRowId > rightRowId ? 1 : 0;
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareUtf8Strings(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalSqliteInt64Decimal(
  value: unknown,
  label: string
): string {
  if (typeof value !== "bigint") {
    throw migrationRecoveryRequired(`${label} is not an exact SQLite integer.`);
  }
  if (
    value < -9_223_372_036_854_775_808n ||
    value > 9_223_372_036_854_775_807n
  ) {
    throw migrationRecoveryRequired(`${label} is outside signed int64.`);
  }
  return value.toString(10);
}

function enableAndVerifyForeignKeyEnforcement(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON;");
  assertForeignKeyEnforcement(db);
}

function assertForeignKeyEnforcement(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA foreign_keys").get() as
    | Record<string, unknown>
    | undefined;
  if (Number(row?.foreign_keys) !== 1) {
    throw migrationBlocked(
      "SQLite foreign-key enforcement could not be enabled outside a transaction."
    );
  }
}

function migrationForeignKeyCheckIdentity(input: {
  databaseId: string;
  attemptId: string;
  fenceOwnerToken: string;
  fenceLeaseGeneration: number;
  targetManifestHash: Sha256;
  entry: StorageMigrationManifestEntryV1;
}): MigrationForeignKeyCheckIdentityV1 {
  const identity: MigrationForeignKeyCheckIdentityV1 = {
    schemaVersion: "migration_foreign_key_check_identity.v1",
    databaseId: input.databaseId,
    attemptId: input.attemptId,
    fenceOwnerToken: input.fenceOwnerToken,
    fenceLeaseGeneration: input.fenceLeaseGeneration,
    targetManifestHash: input.targetManifestHash,
    sequence: input.entry.sequence,
    migrationId: input.entry.migrationId
  };
  validateMigrationForeignKeyCheckIdentity(identity);
  return identity;
}

function prepareMigrationForeignKeyPendingLatch(
  dataDir: string,
  identity: MigrationForeignKeyCheckIdentityV1,
  createdAt: string
): PreparedMigrationForeignKeyPendingLatch {
  assertCanonicalTimestamp(createdAt, "foreign-key pending latch createdAt");
  validateMigrationForeignKeyCheckIdentity(identity);
  const identityHash = hashFramed(
    "vdt-studio/migration-foreign-key-check-identity",
    "migration_foreign_key_check_identity_hash.v1",
    {},
    Buffer.from(canonicalizeJson(identity as unknown as JsonValue), "utf8")
  );
  const withoutHash = {
    schemaVersion: "migration_foreign_key_pending_latch.v1" as const,
    identity,
    identityHash,
    createdAt
  };
  const pendingLatchHash = hashFramed(
    "vdt-studio/migration-foreign-key-pending-latch",
    "migration_foreign_key_pending_latch_hash.v1",
    {},
    Buffer.from(
      canonicalizeJson(withoutHash as unknown as JsonValue),
      "utf8"
    )
  );
  const latch: MigrationForeignKeyPendingLatchV1 = {
    ...withoutHash,
    pendingLatchHash
  };
  const blockDir = migrationForeignKeyBlockDirectory(dataDir);
  const latchPath = path.join(
    blockDir,
    `${identityHash.slice("sha256:".length)}.pending.json`
  );
  assertInside(dataDir, latchPath);
  return { latch, path: latchPath };
}

function persistMigrationForeignKeyBlockEvidence(
  directory: MigrationForeignKeyBlockDirectoryHandle,
  pending: PreparedMigrationForeignKeyPendingLatch,
  violations: readonly MigrationForeignKeyViolationV1[],
  options: StorageMigrationOptions,
  context?: StorageMigrationFaultContext
): Error {
  if (violations.length === 0) {
    throw new TypeError(
      "Foreign-key block evidence requires at least one violation."
    );
  }
  try {
    const expectedPending = canonicalizeJson(
      pending.latch as unknown as JsonValue
    );
    const actualPending = readMigrationForeignKeyArtifact(
      directory,
      pending.path
    );
    if (actualPending !== expectedPending) {
      throw new TypeError(
        "foreign-key pending latch changed before evidence persistence"
      );
    }
    const timestamp = migrationTimestamp(options.now);
    const boundedViolations = violations.slice(0, 50);
    const withoutHash = {
      schemaVersion: "migration_foreign_key_check_evidence.v1" as const,
      identity: pending.latch.identity,
      identityHash: pending.latch.identityHash,
      pendingLatchHash: pending.latch.pendingLatchHash,
      violationCount: violations.length,
      violations: [...boundedViolations],
      truncated: violations.length > boundedViolations.length,
      createdAt: timestamp.iso
    };
    const evidenceHash = hashFramed(
      "vdt-studio/migration-foreign-key-check",
      "migration_foreign_key_check_evidence_hash.v1",
      {},
      Buffer.from(
        canonicalizeJson(withoutHash as unknown as JsonValue),
        "utf8"
      )
    );
    const evidence: MigrationForeignKeyCheckEvidenceV1 = {
      ...withoutHash,
      evidenceHash
    };
    const evidencePath = pending.path.replace(
      /\.pending\.json$/,
      ".evidence.json"
    );
    writeMigrationForeignKeyArtifactDurable(
      directory,
      evidencePath,
      Buffer.from(
        canonicalizeJson(evidence as unknown as JsonValue),
        "utf8"
      ),
      options,
      context,
      {
        created: "after_foreign_key_evidence_created",
        fileFsynced: "after_foreign_key_evidence_file_fsynced",
        directoryFsynced: "after_foreign_key_evidence_fsynced"
      }
    );
    const error = migrationRecoveryRequired(
      `foreign_key_check_failed:${evidence.identity.migrationId}:` +
        `${evidence.violationCount}:${evidence.evidenceHash}`
    ) as MigrationBlockedWithEvidence;
    error.migrationBlockReason = "postcondition_failed";
    return error;
  } catch (error) {
    const recovery = migrationRecoveryRequired(
      `Foreign-key block evidence persistence failed: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
    throw recovery;
  }
}

function prepareAndInspectMigrationBlockSidecars(
  dataDir: string
): MigrationForeignKeyRecoveryPair | null {
  let directory: MigrationForeignKeyBlockDirectoryHandle | undefined;
  try {
    directory = openMigrationForeignKeyBlockDirectory(dataDir);
    return inspectMigrationBlockSidecars(directory, dataDir);
  } catch (error) {
    if (
      error instanceof VdtStorageError &&
      error.code === "MIGRATION_RECOVERY_REQUIRED"
    ) {
      throw error;
    }
    throw migrationRecoveryRequired(
      `Migration block sidecar validation failed: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  } finally {
    if (directory) fs.closeSync(directory.descriptor);
  }
}

function inspectMigrationBlockSidecars(
  directory: MigrationForeignKeyBlockDirectoryHandle,
  dataDir: string
): MigrationForeignKeyRecoveryPair | null {
  validateMigrationForeignKeyBlockDirectory(directory);
  const byIdentity = new Map<
    string,
    {
      pending?: MigrationForeignKeyPendingLatchV1;
      evidence?: MigrationForeignKeyCheckEvidenceV1;
    }
  >();
  const entries = fs
    .readdirSync(directory.path, { withFileTypes: true })
    .sort((left, right) => compareUtf8Strings(left.name, right.name));
  validateMigrationForeignKeyBlockDirectory(directory);
  for (const entry of entries) {
    const match =
      /^([0-9a-f]{64})\.(pending|evidence)\.json$/.exec(entry.name);
    if (!match || !entry.isFile() || entry.isSymbolicLink()) {
      throw new TypeError(
        `migration block artifact has an unknown or non-regular entry: ${entry.name}`
      );
    }
    const identityHex = match[1]!;
    const artifactPath = path.join(directory.path, entry.name);
    assertInside(dataDir, artifactPath);
    const raw = readMigrationForeignKeyArtifact(
      directory,
      artifactPath
    );
    const group = byIdentity.get(identityHex) ?? {};
    if (match[2] === "pending") {
      if (group.pending) {
        throw new TypeError(
          `duplicate pending latch for identity ${identityHex}`
        );
      }
      group.pending = parseMigrationForeignKeyPendingLatch(
        raw,
        identityHex
      );
    } else {
      if (group.evidence) {
        throw new TypeError(
          `duplicate final evidence for identity ${identityHex}`
        );
      }
      group.evidence = parseMigrationForeignKeyCheckEvidence(
        raw,
        identityHex
      );
    }
    byIdentity.set(identityHex, group);
  }
  validateMigrationForeignKeyBlockDirectory(directory);
  if (byIdentity.size === 0) return null;
  if (byIdentity.size !== 1) {
    throw new TypeError(
      "multiple foreign-key recovery identities are present"
    );
  }
  const [identityHex, group] = [...byIdentity.entries()][0]!;
  if (!group.pending) {
    throw new TypeError(
      `final evidence ${identityHex} has no matching pending latch`
    );
  }
  if (!group.evidence) {
    throw migrationRecoveryRequired(
      `Foreign-key pending latch ${identityHex} requires explicit recovery.`
    );
  }
  if (
    canonicalizeJson(group.pending.identity as unknown as JsonValue) !==
      canonicalizeJson(group.evidence.identity as unknown as JsonValue) ||
    group.pending.identityHash !== group.evidence.identityHash ||
    group.pending.pendingLatchHash !== group.evidence.pendingLatchHash
  ) {
    throw new TypeError(
      `foreign-key evidence pair ${identityHex} is not exactly linked`
    );
  }
  return { pending: group.pending, evidence: group.evidence };
}

function parseMigrationForeignKeyPendingLatch(
  raw: string,
  identityHex: string
): MigrationForeignKeyPendingLatchV1 {
  const parsed: unknown = JSON.parse(raw);
  assertDensePlainJson(parsed);
  if (!isPlainRecord(parsed)) {
    throw new TypeError("pending latch root must be an object");
  }
  assertExactKeys(
    parsed,
    [
      "schemaVersion",
      "identity",
      "identityHash",
      "createdAt",
      "pendingLatchHash"
    ],
    "migration foreign-key pending latch"
  );
  if (
    parsed.schemaVersion !== "migration_foreign_key_pending_latch.v1" ||
    typeof parsed.createdAt !== "string"
  ) {
    throw new TypeError("pending latch fields are invalid");
  }
  const identity = parseMigrationForeignKeyCheckIdentity(parsed.identity);
  assertSha256(parsed.identityHash, "foreign-key identity hash");
  assertSha256(parsed.pendingLatchHash, "foreign-key pending latch hash");
  assertCanonicalTimestamp(
    parsed.createdAt,
    "foreign-key pending latch createdAt"
  );
  const identityHash = migrationForeignKeyIdentityHash(identity);
  const withoutHash = { ...parsed };
  delete withoutHash.pendingLatchHash;
  const pendingLatchHash = hashFramed(
    "vdt-studio/migration-foreign-key-pending-latch",
    "migration_foreign_key_pending_latch_hash.v1",
    {},
    Buffer.from(canonicalizeJson(withoutHash), "utf8")
  );
  if (
    parsed.identityHash !== identityHash ||
    identityHex !== identityHash.slice("sha256:".length) ||
    parsed.pendingLatchHash !== pendingLatchHash ||
    canonicalizeJson(parsed) !== raw
  ) {
    throw new TypeError(
      "pending latch path/hash/canonical JSON does not match"
    );
  }
  return {
    schemaVersion: parsed.schemaVersion,
    identity,
    identityHash: parsed.identityHash,
    createdAt: parsed.createdAt,
    pendingLatchHash: parsed.pendingLatchHash
  };
}

function parseMigrationForeignKeyCheckEvidence(
  raw: string,
  identityHex: string
): MigrationForeignKeyCheckEvidenceV1 {
  const parsed: unknown = JSON.parse(raw);
  assertDensePlainJson(parsed);
  if (!isPlainRecord(parsed)) {
    throw new TypeError("foreign-key evidence root must be an object");
  }
  assertExactKeys(
    parsed,
    [
      "schemaVersion",
      "identity",
      "identityHash",
      "pendingLatchHash",
      "violationCount",
      "violations",
      "truncated",
      "createdAt",
      "evidenceHash"
    ],
    "migration foreign-key evidence"
  );
  if (
    parsed.schemaVersion !== "migration_foreign_key_check_evidence.v1" ||
    !Number.isSafeInteger(parsed.violationCount) ||
    Number(parsed.violationCount) <= 0 ||
    !Array.isArray(parsed.violations) ||
    parsed.violations.length === 0 ||
    parsed.violations.length > 50 ||
    typeof parsed.truncated !== "boolean" ||
    typeof parsed.createdAt !== "string"
  ) {
    throw new TypeError("foreign-key evidence fields are invalid");
  }
  const identity = parseMigrationForeignKeyCheckIdentity(parsed.identity);
  assertSha256(parsed.identityHash, "foreign-key evidence identity hash");
  assertSha256(
    parsed.pendingLatchHash,
    "foreign-key evidence pending latch hash"
  );
  assertSha256(parsed.evidenceHash, "foreign-key evidence hash");
  assertCanonicalTimestamp(parsed.createdAt, "foreign-key evidence createdAt");
  const violations = parsed.violations.map(
    (value, index): MigrationForeignKeyViolationV1 =>
      parseMigrationForeignKeyViolation(value, index)
  );
  const violationCount = Number(parsed.violationCount);
  if (
    violations.length !== Math.min(violationCount, 50) ||
    parsed.truncated !== (violationCount > 50) ||
    violations.some(
      (violation, index) =>
        index > 0 &&
        compareMigrationForeignKeyViolations(
          violations[index - 1]!,
          violation
        ) > 0
    )
  ) {
    throw new TypeError(
      "foreign-key evidence ordering or truncation is invalid"
    );
  }
  const identityHash = migrationForeignKeyIdentityHash(identity);
  const withoutHash = { ...parsed };
  delete withoutHash.evidenceHash;
  const evidenceHash = hashFramed(
    "vdt-studio/migration-foreign-key-check",
    "migration_foreign_key_check_evidence_hash.v1",
    {},
    Buffer.from(canonicalizeJson(withoutHash), "utf8")
  );
  if (
    parsed.identityHash !== identityHash ||
    identityHex !== identityHash.slice("sha256:".length) ||
    parsed.evidenceHash !== evidenceHash ||
    canonicalizeJson(parsed) !== raw
  ) {
    throw new TypeError(
      "foreign-key evidence path/hash/canonical JSON does not match"
    );
  }
  return {
    schemaVersion: parsed.schemaVersion,
    identity,
    identityHash: parsed.identityHash,
    pendingLatchHash: parsed.pendingLatchHash,
    violationCount,
    violations,
    truncated: parsed.truncated,
    createdAt: parsed.createdAt,
    evidenceHash: parsed.evidenceHash
  };
}

function parseMigrationForeignKeyCheckIdentity(
  value: unknown
): MigrationForeignKeyCheckIdentityV1 {
  if (!isPlainRecord(value)) {
    throw new TypeError("foreign-key identity must be an object");
  }
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "databaseId",
      "attemptId",
      "fenceOwnerToken",
      "fenceLeaseGeneration",
      "targetManifestHash",
      "sequence",
      "migrationId"
    ],
    "migration foreign-key identity"
  );
  const identity = value as unknown as MigrationForeignKeyCheckIdentityV1;
  validateMigrationForeignKeyCheckIdentity(identity);
  return { ...identity };
}

function validateMigrationForeignKeyCheckIdentity(
  identity: MigrationForeignKeyCheckIdentityV1
): void {
  if (
    identity.schemaVersion !== "migration_foreign_key_check_identity.v1" ||
    !Number.isSafeInteger(identity.fenceLeaseGeneration) ||
    identity.fenceLeaseGeneration <= 0 ||
    !Number.isSafeInteger(identity.sequence) ||
    identity.sequence <= 0 ||
    typeof identity.targetManifestHash !== "string"
  ) {
    throw new TypeError("foreign-key identity fields are invalid");
  }
  assertBoundedUnicodeString(
    identity.databaseId,
    "foreign-key identity databaseId",
    256
  );
  assertBoundedUnicodeString(
    identity.attemptId,
    "foreign-key identity attemptId",
    256
  );
  assertBoundedUnicodeString(
    identity.fenceOwnerToken,
    "foreign-key identity fenceOwnerToken",
    256
  );
  assertBoundedUnicodeString(
    identity.migrationId,
    "foreign-key identity migrationId",
    256
  );
  assertSha256(
    identity.targetManifestHash,
    "foreign-key identity target manifest hash"
  );
}

function migrationForeignKeyIdentityHash(
  identity: MigrationForeignKeyCheckIdentityV1
): Sha256 {
  return hashFramed(
    "vdt-studio/migration-foreign-key-check-identity",
    "migration_foreign_key_check_identity_hash.v1",
    {},
    Buffer.from(canonicalizeJson(identity as unknown as JsonValue), "utf8")
  );
}

function parseMigrationForeignKeyViolation(
  value: unknown,
  index: number
): MigrationForeignKeyViolationV1 {
  if (!isPlainRecord(value)) {
    throw new TypeError(`foreign-key violation ${index} must be an object`);
  }
  assertExactKeys(
    value,
    ["table", "rowIdDecimal", "parent", "foreignKeyIndex"],
    `migration foreign-key violation ${index}`
  );
  if (
    !Number.isSafeInteger(value.foreignKeyIndex) ||
    Number(value.foreignKeyIndex) < 0 ||
    (value.rowIdDecimal !== null &&
      typeof value.rowIdDecimal !== "string")
  ) {
    throw new TypeError(`foreign-key violation ${index} is invalid`);
  }
  assertBoundedUnicodeString(
    value.table,
    `foreign-key violation ${index} table`,
    1_024
  );
  assertBoundedUnicodeString(
    value.parent,
    `foreign-key violation ${index} parent`,
    1_024
  );
  if (typeof value.rowIdDecimal === "string") {
    if (!/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(value.rowIdDecimal)) {
      throw new TypeError(
        `foreign-key violation ${index} rowid is not canonical decimal`
      );
    }
    const rowId = BigInt(value.rowIdDecimal);
    if (
      rowId < -9_223_372_036_854_775_808n ||
      rowId > 9_223_372_036_854_775_807n
    ) {
      throw new TypeError(
        `foreign-key violation ${index} rowid is outside signed int64`
      );
    }
  }
  return {
    table: value.table,
    rowIdDecimal: value.rowIdDecimal,
    parent: value.parent,
    foreignKeyIndex: Number(value.foreignKeyIndex)
  };
}

function migrationForeignKeyBlockDirectory(dataDir: string): string {
  const blockDir = path.join(dataDir, "migrations", "migration-blocks");
  assertInside(dataDir, blockDir);
  return blockDir;
}

function migrationForeignKeyBlockDirectoryHasEntries(
  dataDir: string
): boolean {
  let directory: MigrationForeignKeyBlockDirectoryHandle | undefined;
  try {
    directory = openMigrationForeignKeyBlockDirectory(dataDir);
    validateMigrationForeignKeyBlockDirectory(directory);
    const entries = fs.readdirSync(directory.path);
    validateMigrationForeignKeyBlockDirectory(directory);
    return entries.length > 0;
  } catch (error) {
    if (
      error instanceof VdtStorageError &&
      error.code === "MIGRATION_RECOVERY_REQUIRED"
    ) {
      throw error;
    }
    throw migrationRecoveryRequired(
      `Migration block directory validation failed: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  } finally {
    if (directory) fs.closeSync(directory.descriptor);
  }
}

function openMigrationForeignKeyBlockDirectory(
  dataDir: string
): MigrationForeignKeyBlockDirectoryHandle {
  const effectiveUid = migrationForeignKeyEffectiveUid();
  const { directoryFlag, noFollowFlag } =
    requiredMigrationForeignKeyOpenFlags();
  const migrationDir = path.join(dataDir, "migrations");
  const blockDir = migrationForeignKeyBlockDirectory(dataDir);
  const dataStat = assertOwnedMigrationDirectory(
    dataDir,
    effectiveUid,
    undefined
  );
  validateOpenedMigrationDirectory(
    dataDir,
    dataStat,
    effectiveUid,
    undefined
  );
  assertLocalMigrationFileSystem(dataDir);
  const realDataDir = fs.realpathSync(dataDir);
  const migrationCreated = ensureOwnedMigrationDirectory(
    migrationDir,
    effectiveUid,
    0o700
  );
  const migrationStat = assertOwnedMigrationDirectory(
    migrationDir,
    effectiveUid,
    migrationCreated ? 0o700 : undefined
  );
  if (migrationStat.dev !== dataStat.dev) {
    throw new TypeError(
      "migration sidecar parent crosses the dataDir filesystem"
    );
  }
  validateOpenedMigrationDirectory(
    migrationDir,
    migrationStat,
    effectiveUid,
    migrationCreated ? 0o700 : undefined
  );
  if (migrationCreated) {
    fsyncOwnedMigrationDirectory(migrationDir, effectiveUid);
    fsyncOwnedMigrationDirectory(dataDir, effectiveUid);
  }
  const blockCreated = ensureOwnedMigrationDirectory(
    blockDir,
    effectiveUid,
    0o700
  );
  const blockPathStat = assertOwnedMigrationDirectory(
    blockDir,
    effectiveUid,
    0o700
  );
  if (blockPathStat.dev !== dataStat.dev) {
    throw new TypeError(
      "migration block directory crosses the dataDir filesystem"
    );
  }
  if (blockCreated) {
    fsyncOwnedMigrationDirectory(blockDir, effectiveUid, 0o700);
    fsyncOwnedMigrationDirectory(migrationDir, effectiveUid);
  }
  const realBlockDir = fs.realpathSync(blockDir);
  assertInside(realDataDir, realBlockDir);
  const descriptor = fs.openSync(
    blockDir,
    fs.constants.O_RDONLY | directoryFlag | noFollowFlag
  );
  try {
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    assertMatchingMigrationDirectoryStats(
      blockPathStat,
      descriptorStat,
      effectiveUid,
      0o700
    );
    if (
      descriptorStat.dev !== dataStat.dev ||
      descriptorStat.dev !== migrationStat.dev
    ) {
      throw new TypeError(
        "migration block directory does not share its parent filesystem device"
      );
    }
    const identity = migrationForeignKeyFilesystemIdentity(descriptorStat);
    if (identity.device <= 0n || identity.inode <= 0n) {
      throw new TypeError(
        "migration block directory has no reliable device/inode identity"
      );
    }
    const handle = {
      path: blockDir,
      descriptor,
      effectiveUid,
      identity
    };
    validateMigrationForeignKeyBlockDirectory(handle);
    fs.fsyncSync(descriptor);
    validateMigrationForeignKeyBlockDirectory(handle);
    return handle;
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function validateOpenedMigrationDirectory(
  directoryPath: string,
  pathStat: fs.BigIntStats,
  effectiveUid: bigint,
  exactMode: number | undefined
): void {
  const { directoryFlag, noFollowFlag } =
    requiredMigrationForeignKeyOpenFlags();
  const descriptor = fs.openSync(
    directoryPath,
    fs.constants.O_RDONLY | directoryFlag | noFollowFlag
  );
  try {
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    assertMatchingMigrationDirectoryStats(
      pathStat,
      descriptorStat,
      effectiveUid,
      exactMode
    );
    const afterOpenPathStat = assertOwnedMigrationDirectory(
      directoryPath,
      effectiveUid,
      exactMode
    );
    assertMatchingMigrationDirectoryStats(
      afterOpenPathStat,
      descriptorStat,
      effectiveUid,
      exactMode
    );
  } finally {
    fs.closeSync(descriptor);
  }
}

function ensureOwnedMigrationDirectory(
  directoryPath: string,
  effectiveUid: bigint,
  createMode: number
): boolean {
  try {
    fs.mkdirSync(directoryPath, { mode: createMode });
    const created = assertOwnedMigrationDirectory(
      directoryPath,
      effectiveUid,
      createMode
    );
    if (!created.isDirectory()) {
      throw new TypeError(
        `new migration path is not a directory: ${directoryPath}`
      );
    }
    return true;
  } catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
  }
  assertOwnedMigrationDirectory(directoryPath, effectiveUid, undefined);
  return false;
}

function assertOwnedMigrationDirectory(
  directoryPath: string,
  effectiveUid: bigint,
  exactMode: number | undefined
): fs.BigIntStats {
  const stat = fs.lstatSync(directoryPath, { bigint: true });
  const permissions = stat.mode & 0o777n;
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    stat.uid !== effectiveUid ||
    stat.dev <= 0n ||
    stat.ino <= 0n ||
    (permissions & 0o700n) !== 0o700n ||
    (permissions & 0o022n) !== 0n
  ) {
    throw new TypeError(
      `migration sidecar path is not a private owned real directory: ${directoryPath}`
    );
  }
  if (
    exactMode !== undefined &&
    permissions !== BigInt(exactMode)
  ) {
    throw new TypeError(
      `migration directory permissions are not 0o${exactMode.toString(8)}: ${directoryPath}`
    );
  }
  return stat;
}

function fsyncOwnedMigrationDirectory(
  directoryPath: string,
  effectiveUid: bigint,
  exactMode?: number
): void {
  const { directoryFlag, noFollowFlag } =
    requiredMigrationForeignKeyOpenFlags();
  const before = assertOwnedMigrationDirectory(
    directoryPath,
    effectiveUid,
    exactMode
  );
  const descriptor = fs.openSync(
    directoryPath,
    fs.constants.O_RDONLY | directoryFlag | noFollowFlag
  );
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    assertMatchingMigrationDirectoryStats(
      before,
      opened,
      effectiveUid,
      exactMode
    );
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    assertMatchingMigrationDirectoryStats(
      before,
      after,
      effectiveUid,
      exactMode
    );
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateMigrationForeignKeyBlockDirectory(
  directory: MigrationForeignKeyBlockDirectoryHandle
): void {
  const pathStat = fs.lstatSync(directory.path, { bigint: true });
  const descriptorStat = fs.fstatSync(directory.descriptor, {
    bigint: true
  });
  assertFrozenMigrationDirectoryStat(directory, pathStat);
  assertFrozenMigrationDirectoryStat(directory, descriptorStat);
}

function assertFrozenMigrationDirectoryStat(
  directory: MigrationForeignKeyBlockDirectoryHandle,
  stat: fs.BigIntStats
): void {
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.dev !== directory.identity.device ||
    stat.ino !== directory.identity.inode ||
    stat.uid !== directory.identity.owner ||
    stat.uid !== directory.effectiveUid ||
    (stat.mode & 0o777n) !== directory.identity.mode ||
    directory.identity.mode !== 0o700n
  ) {
    throw new TypeError(
      "migration block directory identity changed during operation"
    );
  }
}

function assertMatchingMigrationDirectoryStats(
  pathStat: fs.BigIntStats,
  descriptorStat: fs.BigIntStats,
  effectiveUid: bigint,
  exactMode?: number
): void {
  const expectedMode =
    exactMode === undefined
      ? pathStat.mode & 0o777n
      : BigInt(exactMode);
  if (
    pathStat.isSymbolicLink() ||
    !pathStat.isDirectory() ||
    !descriptorStat.isDirectory() ||
    pathStat.dev !== descriptorStat.dev ||
    pathStat.ino !== descriptorStat.ino ||
    pathStat.uid !== descriptorStat.uid ||
    pathStat.uid !== effectiveUid ||
    (pathStat.mode & 0o777n) !== expectedMode ||
    (descriptorStat.mode & 0o777n) !== expectedMode ||
    pathStat.dev <= 0n ||
    pathStat.ino <= 0n
  ) {
    throw new TypeError(
      "migration directory path and descriptor identities do not match"
    );
  }
}

function readMigrationForeignKeyArtifact(
  directory: MigrationForeignKeyBlockDirectoryHandle,
  filePath: string
): string {
  assertMigrationForeignKeyArtifactChild(directory, filePath);
  validateMigrationForeignKeyBlockDirectory(directory);
  const lstat = fs.lstatSync(filePath, { bigint: true });
  const maximumBytes = filePath.endsWith(".pending.json")
    ? 32_768n
    : 1_048_576n;
  if (
    lstat.isSymbolicLink() ||
    !lstat.isFile() ||
    lstat.nlink !== 1n ||
    lstat.uid !== directory.effectiveUid ||
    (lstat.mode & 0o777n) !== 0o600n ||
    lstat.dev !== directory.identity.device ||
    lstat.dev <= 0n ||
    lstat.ino <= 0n ||
    lstat.size < 1n ||
    lstat.size > maximumBytes
  ) {
    throw new TypeError(
      `migration block artifact type/link/size is invalid: ${path.basename(filePath)}`
    );
  }
  const { noFollowFlag } = requiredMigrationForeignKeyOpenFlags();
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | noFollowFlag
  );
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (
      !stat.isFile() ||
      stat.nlink !== 1n ||
      stat.uid !== directory.effectiveUid ||
      (stat.mode & 0o777n) !== 0o600n ||
      stat.size !== lstat.size ||
      stat.dev !== lstat.dev ||
      stat.ino !== lstat.ino
    ) {
      throw new TypeError(
        `migration block artifact permissions/type are invalid: ${path.basename(filePath)}`
      );
    }
    validateMigrationForeignKeyBlockDirectory(directory);
    const declaredSize = Number(stat.size);
    const bytes = Buffer.allocUnsafe(declaredSize + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = fs.readSync(
        descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
        null
      );
      if (count === 0) break;
      offset += count;
    }
    const afterRead = fs.fstatSync(descriptor, { bigint: true });
    if (
      offset !== declaredSize ||
      !afterRead.isFile() ||
      afterRead.nlink !== 1n ||
      afterRead.size !== stat.size ||
      afterRead.dev !== stat.dev ||
      afterRead.ino !== stat.ino ||
      afterRead.uid !== stat.uid ||
      (afterRead.mode & 0o777n) !== 0o600n
    ) {
      throw new TypeError(
        `migration block artifact changed during bounded read: ${path.basename(filePath)}`
      );
    }
    validateMigrationForeignKeyBlockDirectory(directory);
    const exactBytes = bytes.subarray(0, declaredSize);
    if (
      exactBytes.length >= 3 &&
      exactBytes[0] === 0xef &&
      exactBytes[1] === 0xbb &&
      exactBytes[2] === 0xbf
    ) {
      throw new TypeError(
        `migration block artifact has a UTF-8 BOM: ${path.basename(filePath)}`
      );
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(exactBytes);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeMigrationForeignKeyArtifactDurable(
  directory: MigrationForeignKeyBlockDirectoryHandle,
  filePath: string,
  bytes: Buffer,
  options: StorageMigrationOptions,
  context: StorageMigrationFaultContext | undefined,
  faultPoints: {
    created: StorageMigrationFaultPoint;
    fileFsynced: StorageMigrationFaultPoint;
    directoryFsynced: StorageMigrationFaultPoint;
  }
): MigrationForeignKeyFilesystemIdentity {
  assertMigrationForeignKeyArtifactChild(directory, filePath);
  const maximumBytes = filePath.endsWith(".pending.json")
    ? 32_768
    : 1_048_576;
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    throw new TypeError(
      `migration block artifact exceeds its byte bound: ${path.basename(filePath)}`
    );
  }
  let descriptor: number | undefined;
  const { noFollowFlag } = requiredMigrationForeignKeyOpenFlags();
  try {
    validateMigrationForeignKeyBlockDirectory(directory);
    if (context?.sequence === 3) {
      options.faultInjector?.(
        filePath.endsWith(".pending.json")
          ? "sequence3_before_foreign_key_pending_create"
          : "sequence3_before_foreign_key_evidence_create",
        context
      );
    }
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        noFollowFlag,
      0o600
    );
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (
      !stat.isFile() ||
      stat.nlink !== 1n ||
      stat.uid !== directory.effectiveUid ||
      (stat.mode & 0o777n) !== 0o600n ||
      stat.dev !== directory.identity.device ||
      stat.dev <= 0n ||
      stat.ino <= 0n
    ) {
      throw new TypeError(
        `new migration block artifact is not a regular file: ${path.basename(filePath)}`
      );
    }
    options.faultInjector?.(faultPoints.created, context);
    writeAll(descriptor, bytes);
    if (context?.sequence === 3) {
      options.faultInjector?.(
        filePath.endsWith(".pending.json")
          ? "sequence3_before_foreign_key_pending_file_fsync"
          : "sequence3_before_foreign_key_evidence_file_fsync",
        context
      );
    }
    fs.fsyncSync(descriptor);
    const afterWrite = fs.fstatSync(descriptor, { bigint: true });
    if (
      !afterWrite.isFile() ||
      afterWrite.dev !== stat.dev ||
      afterWrite.ino !== stat.ino ||
      afterWrite.uid !== stat.uid ||
      afterWrite.nlink !== 1n ||
      (afterWrite.mode & 0o777n) !== 0o600n ||
      afterWrite.size !== BigInt(bytes.byteLength)
    ) {
      throw new TypeError(
        `new migration block artifact changed while writing: ${path.basename(filePath)}`
      );
    }
    options.faultInjector?.(faultPoints.fileFsynced, context);
    validateMigrationForeignKeyBlockDirectory(directory);
    if (context?.sequence === 3) {
      options.faultInjector?.(
        filePath.endsWith(".pending.json")
          ? "sequence3_before_foreign_key_pending_directory_fsync"
          : "sequence3_before_foreign_key_evidence_directory_fsync",
        context
      );
    }
    fs.fsyncSync(directory.descriptor);
    validateMigrationForeignKeyBlockDirectory(directory);
    options.faultInjector?.(faultPoints.directoryFsynced, context);
    return migrationForeignKeyFilesystemIdentity(afterWrite);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function unlinkMigrationForeignKeyPendingLatch(
  directory: MigrationForeignKeyBlockDirectoryHandle,
  pending: PreparedMigrationForeignKeyPendingLatch,
  options: StorageMigrationOptions,
  context?: StorageMigrationFaultContext
): void {
  if (!pending.fileIdentity) {
    throw new TypeError(
      "foreign-key pending latch has no created-file identity"
    );
  }
  validateMigrationForeignKeyBlockDirectory(directory);
  const pathStat = fs.lstatSync(pending.path, { bigint: true });
  assertExactMigrationForeignKeyFileIdentity(
    pathStat,
    pending.fileIdentity,
    directory.effectiveUid
  );
  if (context?.sequence === 3) {
    options.faultInjector?.(
      "sequence3_before_foreign_key_pending_unlink",
      context
    );
  }
  fs.unlinkSync(pending.path);
  options.faultInjector?.("after_foreign_key_pending_unlinked", context);
  validateMigrationForeignKeyBlockDirectory(directory);
  if (context?.sequence === 3) {
    options.faultInjector?.(
      "sequence3_before_foreign_key_pending_unlink_directory_fsync",
      context
    );
  }
  fs.fsyncSync(directory.descriptor);
  validateMigrationForeignKeyBlockDirectory(directory);
  if (context?.sequence === 3) {
    options.faultInjector?.(
      "sequence3_after_foreign_key_pending_unlink_directory_fsynced",
      context
    );
  }
}

function migrationForeignKeyFilesystemIdentity(
  stat: fs.BigIntStats
): MigrationForeignKeyFilesystemIdentity {
  return {
    device: stat.dev,
    inode: stat.ino,
    owner: stat.uid,
    mode: stat.mode & 0o777n,
    size: stat.size,
    linkCount: stat.nlink
  };
}

function assertExactMigrationForeignKeyFileIdentity(
  stat: fs.BigIntStats,
  identity: MigrationForeignKeyFilesystemIdentity,
  effectiveUid: bigint
): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.dev !== identity.device ||
    stat.ino !== identity.inode ||
    stat.uid !== identity.owner ||
    stat.uid !== effectiveUid ||
    (stat.mode & 0o777n) !== identity.mode ||
    stat.size !== identity.size ||
    stat.nlink !== identity.linkCount ||
    identity.mode !== 0o600n ||
    identity.linkCount !== 1n
  ) {
    throw new TypeError(
      "foreign-key pending latch identity changed before unlink"
    );
  }
}

function assertMigrationForeignKeyArtifactChild(
  directory: MigrationForeignKeyBlockDirectoryHandle,
  filePath: string
): void {
  if (
    path.dirname(filePath) !== directory.path ||
    path.basename(filePath) === filePath
  ) {
    throw new TypeError(
      "migration block artifact is not an exact directory child"
    );
  }
}

function migrationForeignKeyEffectiveUid(): bigint {
  if (
    process.platform === "win32" ||
    typeof process.geteuid !== "function"
  ) {
    throw new TypeError(
      "foreign-key migration latches require POSIX effective-UID ownership"
    );
  }
  const uid = process.geteuid();
  if (!Number.isSafeInteger(uid) || uid < 0) {
    throw new TypeError(
      "foreign-key migration latches have no reliable effective UID"
    );
  }
  return BigInt(uid);
}

function requiredMigrationForeignKeyOpenFlags(): {
  directoryFlag: number;
  noFollowFlag: number;
} {
  const directoryFlag = fs.constants.O_DIRECTORY;
  const noFollowFlag = fs.constants.O_NOFOLLOW;
  if (
    typeof directoryFlag !== "number" ||
    directoryFlag === 0 ||
    typeof noFollowFlag !== "number" ||
    noFollowFlag === 0
  ) {
    throw new TypeError(
      "foreign-key migration latches require O_DIRECTORY and O_NOFOLLOW"
    );
  }
  return { directoryFlag, noFollowFlag };
}

function assertLocalMigrationFileSystem(directoryPath: string): void {
  const fileSystem = fs.statfsSync(directoryPath, { bigint: true });
  const localTypes =
    process.platform === "darwin"
      ? new Set([0x1an, 0x4244n])
      : process.platform === "linux"
        ? new Set([
            0xef53n,
            0x58465342n,
            0x9123683en
          ])
        : new Set<bigint>();
  if (!localTypes.has(fileSystem.type)) {
    throw new TypeError(
      `foreign-key migration latches require a reviewed local filesystem (type ${fileSystem.type.toString(16)})`
    );
  }
}

function migrationForeignKeyRecoveryRequired(
  pair: MigrationForeignKeyRecoveryPair
): VdtStorageError {
  return migrationRecoveryRequired(
    `foreign_key_check_failed:${pair.evidence.identity.migrationId}:` +
      `${pair.evidence.violationCount}:${pair.evidence.evidenceHash}`
  );
}

function assertBoundedUnicodeString(
  value: unknown,
  label: string,
  maximumUtf8Bytes: number
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\u0000")
  ) {
    throw new TypeError(`${label} must be a non-empty string without U+0000`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} contains an unpaired surrogate`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(`${label} contains an unpaired surrogate`);
    }
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength < 1 || byteLength > maximumUtf8Bytes) {
    throw new TypeError(
      `${label} must be 1..${maximumUtf8Bytes} UTF-8 bytes`
    );
  }
}

function createBackupAndJournal(
  db: DatabaseSync,
  dataDir: string,
  input: {
    databaseId: string;
    ownerToken: string;
    leaseGeneration: number;
    journalGeneration: number;
    previousJournalHash: Sha256 | null;
    nextSequence: 1 | 2;
    now: string;
    leaseMs: number;
    idFactory?: (() => string) | undefined;
    faultInjector?: ((point: StorageMigrationFaultPoint) => void) | undefined;
  }
): MigrationBootstrapJournal {
  const migrationDir = path.join(dataDir, "migrations");
  const backupDir = path.join(migrationDir, "backups");
  const journalDir = path.join(migrationDir, "bootstrap-journal");
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(journalDir, { recursive: true });
  const backupName = `backup-${input.journalGeneration}-${id(input.idFactory)}.sqlite`;
  const backupPath = path.join(backupDir, backupName);
  assertInside(dataDir, backupPath);
  db.exec(`VACUUM INTO '${escapeSqlLiteral(backupPath)}';`);
  fsyncFileAndDirectory(backupPath);
  input.faultInjector?.("after_backup_fsynced");
  const backupBytes = fs.readFileSync(backupPath);
  const backupHash = hashFramed(
    "vdt-studio/sqlite-backup",
    "sqlite_backup_hash.v1",
    { databaseId: input.databaseId, fromUserVersion: userVersion(db) },
    backupBytes
  );
  const backupRelativePath = path.relative(dataDir, backupPath);
  const backupEvidence = {
    schemaVersion: "migration_backup_evidence.v1" as const,
    backupEvidenceId: `migration_backup_${id(input.idFactory)}`,
    databaseId: input.databaseId,
    fromUserVersion: userVersion(db),
    manifestHash: STORAGE_MIGRATION_MANIFEST.manifestHash,
    sourceDatabaseHash: backupHash,
    backupHash,
    backupRelativePath,
    createdAt: input.now
  };
  const relativePath = path.join(
    "migrations",
    "bootstrap-journal",
    `${String(input.journalGeneration).padStart(8, "0")}-${id(input.idFactory)}.json`
  );
  const journalPath = path.join(dataDir, relativePath);
  assertInside(dataDir, journalPath);
  const withoutHash = {
    schemaVersion: "migration_bootstrap_journal.v1" as const,
    journalId: `migration_journal_${id(input.idFactory)}`,
    journalGeneration: input.journalGeneration,
    previousJournalHash: input.previousJournalHash,
    databaseId: input.databaseId,
    targetManifestHash: STORAGE_MIGRATION_MANIFEST.manifestHash,
    ownerToken: input.ownerToken,
    leaseGeneration: input.leaseGeneration,
    leaseExpiresAt: new Date(Date.parse(input.now) + input.leaseMs).toISOString(),
    nextSequence: input.nextSequence,
    backupEvidence,
    attemptStartedAt: input.now,
    state: "backed_up" as const
  };
  const journalHash = hashFramed(
    "vdt-studio/migration-bootstrap-journal",
    "migration_bootstrap_journal_hash.v1",
    withoutHash as unknown as JsonValue
  );
  const journal: MigrationBootstrapJournal = {
    ...withoutHash,
    journalHash,
    relativePath
  };
  const bytes = Buffer.from(
    canonicalizeJson({ ...withoutHash, journalHash } as unknown as JsonValue),
    "utf8"
  );
  writeExclusiveDurable(journalPath, bytes);
  input.faultInjector?.("after_bootstrap_journal_fsynced");
  return journal;
}

function readLatestValidJournal(dataDir: string): MigrationBootstrapJournal | null {
  const dir = path.join(dataDir, "migrations", "bootstrap-journal");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
  let previous: MigrationBootstrapJournal | null = null;
  for (const file of files) {
    const relativePath = path.join("migrations", "bootstrap-journal", file);
    const absolutePath = path.join(dataDir, relativePath);
    assertInside(dataDir, absolutePath);
    const current = parseBootstrapJournal(
      fs.readFileSync(absolutePath, "utf8"),
      relativePath,
      file,
      previous
    );
    verifyJournalBackup(dataDir, current);
    previous = current;
  }
  return previous;
}

function parseBootstrapJournal(
  raw: string,
  relativePath: string,
  file: string,
  previous: MigrationBootstrapJournal | null
): MigrationBootstrapJournal {
  try {
    const parsed: unknown = JSON.parse(raw);
    assertDensePlainJson(parsed);
    if (!isPlainRecord(parsed)) throw new TypeError("journal root must be an object");
    assertExactKeys(
      parsed,
      [
        "schemaVersion",
        "journalId",
        "journalGeneration",
        "previousJournalHash",
        "journalHash",
        "databaseId",
        "targetManifestHash",
        "ownerToken",
        "leaseGeneration",
        "leaseExpiresAt",
        "nextSequence",
        "backupEvidence",
        "attemptStartedAt",
        "state"
      ],
      "migration bootstrap journal"
    );
    if (canonicalizeJson(parsed) !== raw) {
      throw new TypeError("journal file is not exact canonical JSON");
    }
    if (!isPlainRecord(parsed.backupEvidence)) {
      throw new TypeError("backupEvidence must be an object");
    }
    const backup = parsed.backupEvidence;
    assertExactKeys(
      backup,
      [
        "schemaVersion",
        "backupEvidenceId",
        "databaseId",
        "fromUserVersion",
        "manifestHash",
        "sourceDatabaseHash",
        "backupHash",
        "backupRelativePath",
        "createdAt"
      ],
      "migration backup evidence"
    );
    assertNonEmptyString(parsed.journalId, "journalId");
    assertNonEmptyString(parsed.databaseId, "databaseId");
    assertNonEmptyString(parsed.ownerToken, "ownerToken");
    assertNonEmptyString(backup.backupEvidenceId, "backupEvidenceId");
    assertNonEmptyString(backup.databaseId, "backup databaseId");
    assertNonEmptyString(backup.backupRelativePath, "backupRelativePath");
    if (
      parsed.schemaVersion !== "migration_bootstrap_journal.v1" ||
      parsed.state !== "backed_up" ||
      backup.schemaVersion !== "migration_backup_evidence.v1"
    ) {
      throw new TypeError("journal or backup evidence schema/state is invalid");
    }
    assertSha256(parsed.journalHash, "journalHash");
    assertSha256(parsed.targetManifestHash, "targetManifestHash");
    assertSha256(backup.manifestHash, "backup manifestHash");
    assertSha256(backup.sourceDatabaseHash, "sourceDatabaseHash");
    assertSha256(backup.backupHash, "backupHash");
    if (parsed.previousJournalHash !== null) {
      assertSha256(parsed.previousJournalHash, "previousJournalHash");
    }
    assertPositiveSafeInteger(parsed.journalGeneration, "journalGeneration");
    assertPositiveSafeInteger(parsed.leaseGeneration, "leaseGeneration");
    if (parsed.nextSequence !== 1 && parsed.nextSequence !== 2) {
      throw new TypeError("nextSequence must be 1 or 2");
    }
    if (backup.fromUserVersion !== parsed.nextSequence - 1) {
      throw new TypeError("backup fromUserVersion does not match nextSequence");
    }
    if (
      !Number.isSafeInteger(backup.fromUserVersion) ||
      Number(backup.fromUserVersion) < 0
    ) {
      throw new TypeError("backup fromUserVersion is invalid");
    }
    assertCanonicalTimestamp(String(parsed.leaseExpiresAt), "leaseExpiresAt");
    assertCanonicalTimestamp(String(parsed.attemptStartedAt), "attemptStartedAt");
    assertCanonicalTimestamp(String(backup.createdAt), "backup createdAt");
    if (
      typeof parsed.leaseExpiresAt !== "string" ||
      typeof parsed.attemptStartedAt !== "string" ||
      typeof backup.createdAt !== "string" ||
      Date.parse(parsed.leaseExpiresAt) < Date.parse(parsed.attemptStartedAt) ||
      backup.createdAt !== parsed.attemptStartedAt
    ) {
      throw new TypeError("journal lease/backup timestamps are not consistently bound");
    }
    if (
      parsed.targetManifestHash !== STORAGE_MIGRATION_MANIFEST.manifestHash ||
      backup.manifestHash !== parsed.targetManifestHash ||
      backup.databaseId !== parsed.databaseId ||
      path.isAbsolute(backup.backupRelativePath) ||
      path.basename(file).slice(0, 8) !==
        String(parsed.journalGeneration).padStart(8, "0")
    ) {
      throw new TypeError("journal manifest/database/path binding is invalid");
    }
    if (
      parsed.journalGeneration !== (previous?.journalGeneration ?? 0) + 1 ||
      parsed.leaseGeneration !== (previous?.leaseGeneration ?? 0) + 1 ||
      parsed.previousJournalHash !== (previous?.journalHash ?? null) ||
      (previous !== null && parsed.databaseId !== previous.databaseId) ||
      (previous !== null && parsed.nextSequence < previous.nextSequence)
    ) {
      throw new TypeError("journal generation/hash/database chain is invalid");
    }
    const withoutHash = { ...parsed };
    delete withoutHash.journalHash;
    const actualHash = hashFramed(
      "vdt-studio/migration-bootstrap-journal",
      "migration_bootstrap_journal_hash.v1",
      withoutHash
    );
    if (parsed.journalHash !== actualHash) {
      throw new TypeError("journal hash does not match its canonical body");
    }
    return {
      schemaVersion: "migration_bootstrap_journal.v1",
      journalId: parsed.journalId,
      journalGeneration: parsed.journalGeneration,
      previousJournalHash: parsed.previousJournalHash,
      journalHash: parsed.journalHash,
      databaseId: parsed.databaseId,
      targetManifestHash: parsed.targetManifestHash,
      ownerToken: parsed.ownerToken,
      leaseGeneration: parsed.leaseGeneration,
      leaseExpiresAt: parsed.leaseExpiresAt,
      nextSequence: parsed.nextSequence,
      backupEvidence: {
        schemaVersion: "migration_backup_evidence.v1",
        backupEvidenceId: backup.backupEvidenceId,
        databaseId: backup.databaseId,
        fromUserVersion: backup.fromUserVersion,
        manifestHash: backup.manifestHash,
        sourceDatabaseHash: backup.sourceDatabaseHash,
        backupHash: backup.backupHash,
        backupRelativePath: backup.backupRelativePath,
        createdAt: backup.createdAt
      },
      attemptStartedAt: parsed.attemptStartedAt,
      state: "backed_up",
      relativePath
    };
  } catch (error) {
    if (isSqliteBusy(error)) throw error;
    if (error instanceof Error && error.name === "StorageMigrationBlockedError") throw error;
    throw migrationBlocked(
      `Bootstrap journal is invalid (${file}): ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
}

function verifyJournalBackup(dataDir: string, journal: MigrationBootstrapJournal): void {
  const evidence = journal.backupEvidence;
  if (
    evidence.databaseId !== journal.databaseId ||
    evidence.manifestHash !== journal.targetManifestHash ||
    evidence.manifestHash !== STORAGE_MIGRATION_MANIFEST.manifestHash
  ) {
    throw migrationBlocked("Bootstrap journal backup binding does not match its migration attempt.");
  }
  const backupPath = path.resolve(dataDir, evidence.backupRelativePath);
  assertInside(dataDir, backupPath);
  if (!fs.existsSync(backupPath)) {
    throw migrationBlocked(`Durable migration backup is missing: ${evidence.backupRelativePath}.`);
  }
  const stat = fs.lstatSync(backupPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw migrationBlocked(`Migration backup is not a regular file: ${evidence.backupRelativePath}.`);
  }
  fsyncFileAndDirectory(backupPath);
  const bytes = fs.readFileSync(backupPath);
  const actualHash = hashFramed(
    "vdt-studio/sqlite-backup",
    "sqlite_backup_hash.v1",
    {
      databaseId: evidence.databaseId,
      fromUserVersion: evidence.fromUserVersion
    },
    bytes
  );
  if (
    actualHash !== evidence.backupHash ||
    actualHash !== evidence.sourceDatabaseHash
  ) {
    throw migrationBlocked(`Migration backup hash mismatch: ${evidence.backupRelativePath}.`);
  }

  let backupDb: DatabaseSync | undefined;
  try {
    backupDb = new DatabaseSync(backupPath, { readOnly: true, timeout: 5_000 });
    enableAndVerifyForeignKeyEnforcement(backupDb);
    const integrity = backupDb.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
    if (integrity.integrity_check !== "ok") {
      throw migrationBlocked(`Migration backup integrity check failed: ${String(integrity.integrity_check)}.`);
    }
    if (userVersion(backupDb) !== evidence.fromUserVersion) {
      throw migrationBlocked("Migration backup user_version does not match its evidence.");
    }
    const expectedSchemaHash =
      evidence.fromUserVersion === 0
        ? EMPTY_SCHEMA_HASH
        : evidence.fromUserVersion === 1
          ? LEGACY_V1_SCHEMA_HASH
          : undefined;
    if (
      !expectedSchemaHash ||
      computeSchemaHash(backupDb, evidence.fromUserVersion) !== expectedSchemaHash
    ) {
      throw migrationBlocked("Migration backup schema does not match its frozen precondition.");
    }
  } catch (error) {
    if (isSqliteBusy(error)) throw error;
    if (error instanceof Error && error.name === "StorageMigrationBlockedError") throw error;
    throw migrationBlocked(
      `Migration backup could not be reopened and verified: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  } finally {
    backupDb?.close();
  }
}

function createValidatedMigrationPlan(
  laterEntries: StorageMigrationFixtureEntryV1[],
  expectedManifestHash: Sha256
): ValidatedStorageMigrationTestPlan {
  assertSha256(expectedManifestHash, "expected migration manifest hash");
  const sources: StorageMigrationFixtureEntryV1[] = [
    {
      sequence: 1,
      migrationId: ENTRIES[0]!.migrationId,
      fromUserVersion: ENTRIES[0]!.fromUserVersion,
      toUserVersion: ENTRIES[0]!.toUserVersion,
      preconditionSchemaHash: ENTRIES[0]!.preconditionSchemaHash,
      postconditionSchemaHash: ENTRIES[0]!.postconditionSchemaHash,
      sqlBytes: Buffer.from(SEQUENCE_1_SQL),
      expectedChecksum: ENTRIES[0]!.sqlChecksum
    },
    {
      sequence: 2,
      migrationId: ENTRIES[1]!.migrationId,
      fromUserVersion: ENTRIES[1]!.fromUserVersion,
      toUserVersion: ENTRIES[1]!.toUserVersion,
      preconditionSchemaHash: ENTRIES[1]!.preconditionSchemaHash,
      postconditionSchemaHash: ENTRIES[1]!.postconditionSchemaHash,
      sqlBytes: Buffer.from(SEQUENCE_2_SQL),
      expectedChecksum: ENTRIES[1]!.sqlChecksum
    },
    ...laterEntries.map((entry) => ({ ...entry, sqlBytes: Buffer.from(entry.sqlBytes) }))
  ];
  const migrationIds = new Set<string>();
  const plannedEntries = sources.map((source, index): PlannedMigrationEntry => {
    const expectedSequence = index + 1;
    if (source.sequence !== expectedSequence) {
      throw new TypeError(
        `Migration plan sequence must be contiguous from 1; expected ${expectedSequence}, got ${source.sequence}.`
      );
    }
    if (
      typeof source.migrationId !== "string" ||
      !/^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.migrationId)
    ) {
      throw new TypeError(`Migration ${source.sequence} has an invalid migrationId.`);
    }
    if (migrationIds.has(source.migrationId)) {
      throw new TypeError(`Migration plan contains duplicate ID ${source.migrationId}.`);
    }
    migrationIds.add(source.migrationId);
    if (
      !Number.isSafeInteger(source.fromUserVersion) ||
      !Number.isSafeInteger(source.toUserVersion) ||
      source.fromUserVersion < 0 ||
      source.toUserVersion <= source.fromUserVersion
    ) {
      throw new TypeError(
        `Migration ${source.migrationId} must advance between non-negative safe user versions.`
      );
    }
    assertSha256(source.preconditionSchemaHash, `${source.migrationId} precondition`);
    assertSha256(source.postconditionSchemaHash, `${source.migrationId} postcondition`);
    assertSha256(source.expectedChecksum, `${source.migrationId} checksum`);
    if (!Buffer.isBuffer(source.sqlBytes) || source.sqlBytes.byteLength === 0) {
      throw new TypeError(`Migration ${source.migrationId} SQL must be a non-empty Buffer.`);
    }
    const previous = sources[index - 1];
    if (
      previous &&
      (source.fromUserVersion !== previous.toUserVersion ||
        source.preconditionSchemaHash !== previous.postconditionSchemaHash)
    ) {
      throw new TypeError(
        `Migration ${source.migrationId} is not contiguous with sequence ${previous.sequence}.`
      );
    }
    const entry = manifestEntry({
      sequence: source.sequence,
      migrationId: source.migrationId,
      fromUserVersion: source.fromUserVersion,
      toUserVersion: source.toUserVersion,
      preconditionSchemaHash: source.preconditionSchemaHash,
      postconditionSchemaHash: source.postconditionSchemaHash,
      sqlBytes: source.sqlBytes,
      expectedChecksum: source.expectedChecksum
    });
    if (index < 2) {
      const frozen = ENTRIES[index]!;
      if (
        canonicalizeJson(entry as unknown as JsonValue) !==
          canonicalizeJson(frozen as unknown as JsonValue) ||
        !source.sqlBytes.equals(index === 0 ? SEQUENCE_1_SQL : SEQUENCE_2_SQL)
      ) {
        throw new Error(`Frozen bootstrap migration sequence ${expectedSequence} drifted.`);
      }
    }
    return Object.freeze({
      manifestEntry: entry,
      sqlBytes: Buffer.from(source.sqlBytes)
    });
  });

  const prefixHashes = plannedEntries.map((_, index) =>
    hashMigrationManifestPrefix(
      plannedEntries.slice(0, index + 1).map((entry) => entry.manifestEntry)
    )
  );
  if (prefixHashes[1] !== EXPECTED_MANIFEST_HASH) {
    throw new Error(
      `Frozen bootstrap migration prefix drifted: expected ${EXPECTED_MANIFEST_HASH}, got ${String(
        prefixHashes[1]
      )}.`
    );
  }
  const actualManifestHash = prefixHashes[prefixHashes.length - 1]!;
  if (actualManifestHash !== expectedManifestHash) {
    throw new Error(
      `Migration manifest drifted: expected ${expectedManifestHash}, got ${actualManifestHash}.`
    );
  }
  const prefixSequenceByHash = new Map<Sha256, number>();
  prefixHashes.forEach((hash, index) => {
    if (prefixSequenceByHash.has(hash)) {
      throw new TypeError(`Migration manifest prefix hash repeats at sequence ${index + 1}.`);
    }
    prefixSequenceByHash.set(hash, index + 1);
  });
  const manifestEntries = Object.freeze(
    plannedEntries.map((entry) => entry.manifestEntry)
  ) as unknown as StorageMigrationManifestEntryV1[];
  const manifest =
    plannedEntries.length === 2
      ? STORAGE_MIGRATION_MANIFEST
      : Object.freeze({
          schemaVersion: "migration_manifest.v1" as const,
          manifestVersion: 1,
          manifestHash: actualManifestHash,
          entries: manifestEntries
        });
  const plan: ValidatedStorageMigrationTestPlan = Object.freeze({
    planKind: "v1-test",
    manifest,
    entries: Object.freeze(plannedEntries),
    prefixHashes: Object.freeze(prefixHashes),
    prefixSequenceByHash,
    targetSequence: plannedEntries.length,
    targetUserVersion:
      plannedEntries[plannedEntries.length - 1]!.manifestEntry.toUserVersion
  });
  validatedMigrationPlans.add(plan);
  return plan;
}

function productionMigrationPlan(
  assets: VerifiedSequence3Assets
): ValidatedStorageProductionPlanV2 {
  if (retainedProductionMigrationPlan) {
    if (retainedProductionMigrationPlan.sequence3Assets !== assets) {
      throw migrationRecoveryRequired(
        "Sequence 3 production assets changed after process-local plan validation."
      );
    }
    return retainedProductionMigrationPlan;
  }
  if (
    assets.manifestHash !== EXPECTED_SEQUENCE_3_MANIFEST_HASH ||
    assets.sqlChecksum !== EXPECTED_SEQUENCE_3_CHECKSUM ||
    assets.postconditionSchemaHash !==
      EXPECTED_SEQUENCE_3_POSTCONDITION_SCHEMA_HASH
  ) {
    throw migrationRecoveryRequired(
      "Sequence 3 frozen manifest binding did not match the accepted production plan."
    );
  }
  const sequence3Sql = Buffer.from(assets.sqlText, "utf8");
  const sequence3Entry = manifestEntry({
    sequence: 3,
    migrationId: SEQUENCE_3_MIGRATION_ID,
    fromUserVersion: 2,
    toUserVersion: 3,
    preconditionSchemaHash: ATOMIC_REVISION_SCHEMA_HASH,
    postconditionSchemaHash: EXPECTED_SEQUENCE_3_POSTCONDITION_SCHEMA_HASH,
    sqlBytes: sequence3Sql,
    expectedChecksum: EXPECTED_SEQUENCE_3_CHECKSUM
  });
  const entries = Object.freeze([
    Object.freeze({
      manifestEntry: ENTRIES[0]!,
      sqlBytes: Buffer.from(SEQUENCE_1_SQL)
    }),
    Object.freeze({
      manifestEntry: ENTRIES[1]!,
      sqlBytes: Buffer.from(SEQUENCE_2_SQL)
    }),
    Object.freeze({
      manifestEntry: sequence3Entry,
      sqlBytes: sequence3Sql
    })
  ]);
  const prefixHashes: readonly Sha256[] = Object.freeze([
    hashMigrationManifestPrefix([ENTRIES[0]!]),
    EXPECTED_MANIFEST_HASH as Sha256,
    assets.manifestHash
  ]);
  const prefixSequenceByHash = new Map<Sha256, number>();
  prefixHashes.forEach((hash, index) => {
    if (prefixSequenceByHash.has(hash)) {
      throw migrationRecoveryRequired(
        `Sequence 3 manifest prefix hash repeats at sequence ${index + 1}.`
      );
    }
    prefixSequenceByHash.set(hash, index + 1);
  });
  const plan: ValidatedStorageProductionPlanV2 = Object.freeze({
    planKind: "v2-production",
    targetManifestHash: assets.manifestHash,
    historicalPrefixManifestHash: EXPECTED_MANIFEST_HASH as Sha256,
    sequence3Assets: assets,
    entries,
    prefixHashes,
    prefixSequenceByHash,
    targetSequence: 3,
    targetUserVersion: 3
  });
  retainedProductionMigrationPlan = plan;
  return plan;
}

function hashMigrationManifestPrefix(
  entries: StorageMigrationManifestEntryV1[]
): Sha256 {
  return hashFramed(
    "vdt-studio/migration-manifest",
    "migration_manifest_hash.v1",
    {
      schemaVersion: "migration_manifest.v1",
      manifestVersion: 1,
      entries
    } as unknown as JsonValue
  );
}

function manifestEntry(input: {
  sequence: number;
  migrationId: string;
  fromUserVersion: number;
  toUserVersion: number;
  preconditionSchemaHash: Sha256;
  postconditionSchemaHash: Sha256;
  sqlBytes: Buffer;
  expectedChecksum: Sha256;
}): StorageMigrationManifestEntryV1 {
  const metadata = {
    sequence: input.sequence,
    migrationId: input.migrationId,
    fromUserVersion: input.fromUserVersion,
    toUserVersion: input.toUserVersion,
    preconditionSchemaHash: input.preconditionSchemaHash,
    postconditionSchemaHash: input.postconditionSchemaHash
  };
  const checksum = hashFramed(
    "vdt-studio/sql-migration",
    "sql_migration_hash.v1",
    metadata,
    input.sqlBytes
  );
  if (checksum !== input.expectedChecksum) {
    throw new Error(
      `Immutable migration ${input.migrationId} drifted: expected ${input.expectedChecksum}, got ${checksum}.`
    );
  }
  return Object.freeze({
    ...metadata,
    sqlByteLength: input.sqlBytes.byteLength,
    sqlChecksum: checksum,
    transactional: true as const
  });
}

function transaction(
  db: DatabaseSync,
  fn: () => void
): void {
  db.exec("BEGIN IMMEDIATE;");
  try {
    fn();
    assertForeignKeyEnforcement(db);
    const violations = readMigrationForeignKeyViolations(db);
    if (violations.length > 0) {
      const first = violations[0]!;
      throw migrationBlocked(
        `Foreign-key violation in ${first.table} row ${String(first.rowIdDecimal)}.`
      );
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function migrationApplicationTransaction(
  db: DatabaseSync,
  dataDir: string,
  identity: MigrationForeignKeyCheckIdentityV1,
  pendingCreatedAt: string,
  options: StorageMigrationOptions,
  fn: () => void,
  context?: StorageMigrationFaultContext
): void {
  let directory: MigrationForeignKeyBlockDirectoryHandle | undefined;
  let sqliteCommitted = false;
  try {
    directory = openMigrationForeignKeyBlockDirectory(dataDir);
    const recovery = inspectMigrationBlockSidecars(directory, dataDir);
    if (recovery) throw migrationForeignKeyRecoveryRequired(recovery);
    const pending = prepareMigrationForeignKeyPendingLatch(
      dataDir,
      identity,
      pendingCreatedAt
    );
    db.exec("BEGIN IMMEDIATE;");
    try {
      fn();
      assertForeignKeyEnforcement(db);
      try {
        pending.fileIdentity =
          writeMigrationForeignKeyArtifactDurable(
            directory,
            pending.path,
            Buffer.from(
              canonicalizeJson(pending.latch as unknown as JsonValue),
              "utf8"
            ),
            options,
            context,
            {
              created: "after_foreign_key_pending_created",
              fileFsynced: "after_foreign_key_pending_file_fsynced",
              directoryFsynced: "after_foreign_key_pending_fsynced"
            }
          );
      } catch (error) {
        throw migrationRecoveryRequired(
          `Foreign-key pending latch persistence failed: ${
            error instanceof Error ? error.message : String(error)
          }.`
        );
      }
      if (context?.sequence === 3) {
        options.faultInjector?.(
          "sequence3_before_foreign_key_check",
          context
        );
      }
      const violations = readMigrationForeignKeyViolations(db);
      if (violations.length > 0) {
        throw new MigrationForeignKeyCheckError(violations, pending);
      }
      try {
        options.faultInjector?.(
          "after_foreign_key_check_passed",
          context
        );
        unlinkMigrationForeignKeyPendingLatch(
          directory,
          pending,
          options,
          context
        );
      } catch (error) {
        throw migrationRecoveryRequired(
          `Foreign-key zero-row pending cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }.`
        );
      }
      db.exec("COMMIT;");
      sqliteCommitted = true;
      if (context?.sequence === 3) {
        options.faultInjector?.("after_later_migration_committed", context);
        options.faultInjector?.(
          "sequence3_before_post_commit_cleanup",
          context
        );
        fs.closeSync(directory.descriptor);
        directory = undefined;
        options.faultInjector?.(
          "sequence3_after_post_commit_cleanup",
          context
        );
      }
    } catch (error) {
      let rollbackError: unknown;
      if (!sqliteCommitted) {
        try {
          db.exec("ROLLBACK;");
        } catch (candidate) {
          rollbackError = candidate;
        }
      }
      if (error instanceof MigrationForeignKeyCheckError) {
        if (rollbackError !== undefined) {
          throw migrationRecoveryRequired(
            `Foreign-key violation rollback failed before evidence persistence: ${
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError)
            }.`
          );
        }
        options.faultInjector?.(
          "after_foreign_key_violation_rollback",
          context
        );
        if (!directory) {
          throw migrationRecoveryRequired(
            "Foreign-key evidence persistence lost its retained directory."
          );
        }
        throw persistMigrationForeignKeyBlockEvidence(
          directory,
          error.pending,
          error.violations,
          options,
          context
        );
      }
      throw error;
    }
  } catch (error) {
    if (
      error instanceof VdtStorageError ||
      (error instanceof Error &&
        error.name === "StorageMigrationBlockedError") ||
      isSqliteBusy(error)
    ) {
      throw error;
    }
    throw migrationRecoveryRequired(
      `Foreign-key migration latch operation failed: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  } finally {
    if (directory) fs.closeSync(directory.descriptor);
  }
}

function writeExclusiveDurable(filePath: string, bytes: Buffer): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    writeAll(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(filePath));
}

function fsyncFileAndDirectory(filePath: string): void {
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(filePath));
}

function fsyncDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeAll(descriptor: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    offset += fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
  }
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as Record<string, unknown>;
  return Number(row.user_version);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a safe non-negative integer.`);
  return value;
}

function assertPositiveSafeInteger(
  value: unknown,
  label: string
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
}

function assertNonEmptyString(
  value: unknown,
  label: string
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function id(factory?: (() => string) | undefined): string {
  return (factory?.() ?? randomUUID()).replace(/[^A-Za-z0-9_-]/g, "");
}

function assertCanonicalTimestamp(value: string, label: string): void {
  if (new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp.`);
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function migrationBlocked(message: string): Error {
  const error = new Error(`MIGRATION_BLOCKED: ${message}`);
  error.name = "StorageMigrationBlockedError";
  return error;
}

function migrationRecoveryRequired(message: string): VdtStorageError {
  return new VdtStorageError(
    "MIGRATION_RECOVERY_REQUIRED",
    message,
    false
  );
}

function migrationBlockReason(
  error: Error
): MigrationBlockedWithEvidence["migrationBlockReason"] {
  return (error as MigrationBlockedWithEvidence).migrationBlockReason;
}
