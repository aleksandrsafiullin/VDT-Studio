/** Device/origin-local credentials. Never serialize these records into application state. */
export const API_KEY_VAULT_DATABASE = "vdt-studio-credentials";
export const API_KEY_VAULT_STORE = "api-keys";

export interface EncryptedApiKey {
  version: 1;
  key: CryptoKey;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  /** Opaque public cache invalidation identity, never derived from key bytes. */
  identityEpoch?: string;
}

export interface ApiKeyVault {
  read(scope: string): Promise<string | undefined>;
  write(scope: string, value: string): Promise<void>;
  remove(scope: string): Promise<void>;
  identity?(scope: string, expectedValue?: string): Promise<string>;
}

/** The production adapter uses one IndexedDB read/write transaction for CAS.
 * The injectable port permits deterministic reload/race tests without secrets. */
export interface ApiKeyRecordStorage {
  read(scope: string): Promise<EncryptedApiKey | undefined>;
  compareAndSet(scope: string, expected: EncryptedApiKey | undefined, next: EncryptedApiKey | undefined): Promise<boolean>;
}

function sameEncryptedRecord(a: EncryptedApiKey | undefined, b: EncryptedApiKey | undefined): boolean {
  if (!a || !b) return a === b;
  const sameBytes = (x: ArrayBuffer, y: ArrayBuffer) => x.byteLength === y.byteLength && new Uint8Array(x).every((v, i) => v === new Uint8Array(y)[i]);
  return a.version === b.version && a.identityEpoch === b.identityEpoch && sameBytes(a.iv, b.iv) && sameBytes(a.ciphertext, b.ciphertext);
}

export async function encryptApiKey(scope: string, value: string): Promise<EncryptedApiKey> {
  // A fresh non-exportable key and 96-bit IV for every replacement. Both are
  // structured-cloned by IndexedDB; the app never exports raw encryption key
  // bytes. Browser-profile protection remains the browser/OS's responsibility.
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(scope) },
    key,
    new TextEncoder().encode(value)
  );
  return { version: 1, key, iv: iv.buffer, ciphertext, identityEpoch: crypto.randomUUID() };
}

export async function decryptApiKey(scope: string, record: EncryptedApiKey): Promise<string> {
  if (record.version !== 1 || record.key?.extractable !== false || record.key?.algorithm?.name !== "AES-GCM") {
    throw new Error("Invalid encrypted credential.");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: record.iv, additionalData: new TextEncoder().encode(scope) },
    record.key,
    record.ciphertext
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

export class IndexedDbApiKeyVault implements ApiKeyVault {
  constructor(private readonly databaseName = API_KEY_VAULT_DATABASE, private readonly storage?: ApiKeyRecordStorage) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
        reject(new Error("Encrypted credential storage is unavailable."));
        return;
      }
      const request = indexedDB.open(this.databaseName, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore(API_KEY_VAULT_STORE);
      request.onerror = () => reject(new Error("Could not open encrypted credential storage."));
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Encrypted credential storage is blocked."));
      };
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
    });
  }

  private record(scope: string): Promise<EncryptedApiKey | undefined> {
    return this.storage ? this.storage.read(scope) : this.transact("readonly", store => store.get(scope));
  }

  private async replace(scope: string, expected: EncryptedApiKey | undefined, next: EncryptedApiKey | undefined): Promise<boolean> {
    if (this.storage) return this.storage.compareAndSet(scope, expected, next);
    const database = await this.open();
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const tx = database.transaction(API_KEY_VAULT_STORE, "readwrite"), store = tx.objectStore(API_KEY_VAULT_STORE), request = store.get(scope);
        let replaced = false;
        request.onsuccess = () => {
          if (!sameEncryptedRecord(request.result, expected)) return;
          if (next) store.put(next, scope); else store.delete(scope);
          replaced = true;
        };
        tx.oncomplete = () => resolve(replaced);
        tx.onabort = tx.onerror = () => reject(new Error("Encrypted credential storage failed."));
      });
    } finally { database.close(); }
  }

  private async transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(API_KEY_VAULT_STORE, mode);
        const request = action(transaction.objectStore(API_KEY_VAULT_STORE));
        // Request success alone is not durable success: wait for the commit.
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () => reject(new Error("Encrypted credential storage failed."));
      });
    } finally {
      database.close();
    }
  }

  async read(scope: string): Promise<string | undefined> {
    const record = await this.record(scope);
    return record === undefined ? undefined : decryptApiKey(scope, record);
  }

  async write(scope: string, value: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const previous = await this.record(scope);
      // Passive hydration/hot reattachment of the same retained key preserves
      // its epoch. Replacement or remove→restore gets a fresh opaque epoch.
      if (previous && await decryptApiKey(scope, previous) === value) return;
      const record = await encryptApiKey(scope, value);
      if (await this.replace(scope, previous, record)) return;
    }
    throw new Error("Credential storage changed; retry the selected credential save.");
  }

  async identity(scope: string, expectedValue?: string): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const record = await this.record(scope);
      if (!record || (expectedValue !== undefined && await decryptApiKey(scope, record) !== expectedValue)) throw new Error("Credential persistence is not ready for this selection.");
      if (record.identityEpoch && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.identityEpoch)) return record.identityEpoch;
      // Metadata-only migration cannot resurrect a removed/replaced key.
      const identityEpoch = crypto.randomUUID();
      if (await this.replace(scope, record, { ...record, identityEpoch })) return identityEpoch;
    }
    throw new Error("Credential persistence changed during identity admission.");
  }

  async remove(scope: string): Promise<void> {
    // Deleting the record also deletes its encryption key. Never regenerate or
    // discard unreadable credentials automatically on an error.
    for (let attempt = 0; attempt < 3; attempt++) if (await this.replace(scope, await this.record(scope), undefined)) return;
    throw new Error("Credential persistence changed during removal.");
  }
}
