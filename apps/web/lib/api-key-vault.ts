/** Device/origin-local credentials. Never serialize these records into application state. */
export const API_KEY_VAULT_DATABASE = "vdt-studio-credentials";
export const API_KEY_VAULT_STORE = "api-keys";

export interface EncryptedApiKey {
  version: 1;
  key: CryptoKey;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

export interface ApiKeyVault {
  read(scope: string): Promise<string | undefined>;
  write(scope: string, value: string): Promise<void>;
  remove(scope: string): Promise<void>;
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
  return { version: 1, key, iv: iv.buffer, ciphertext };
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
  constructor(private readonly databaseName = API_KEY_VAULT_DATABASE) {}

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
    const record: EncryptedApiKey | undefined = await this.transact("readonly", (store) => store.get(scope));
    return record === undefined ? undefined : decryptApiKey(scope, record);
  }

  async write(scope: string, value: string): Promise<void> {
    const record = await encryptApiKey(scope, value);
    await this.transact("readwrite", (store) => store.put(record, scope));
  }

  async remove(scope: string): Promise<void> {
    // Deleting the record also deletes its encryption key. Never regenerate or
    // discard unreadable credentials automatically on an error.
    await this.transact("readwrite", (store) => store.delete(scope));
  }
}
