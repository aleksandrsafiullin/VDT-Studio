# ADR-007: Encrypted local BYOK credential storage

Status: accepted and implemented in the web client, 2026-10-18. Packaged native/WebView qualification remains open.

## Context and decision

BYOK keys were scrubbed from Zustand persistence and project exports, so reloading lost the key. The user requires retention across normal sessions until replacement or deletion, while preserving the prohibition on plaintext keys in localStorage/project data.

- Store BYOK `apiKey` separately in origin-local IndexedDB database `vdt-studio-credentials`, object store `api-keys`. Ordinary preferences, VDTs, exports and durable server records continue to exclude credentials.
- Encrypt each value using Web Crypto AES-256-GCM, a fresh 96-bit random IV and a fresh non-extractable `CryptoKey` per replacement. IndexedDB atomically structured-clones the opaque key, IV, authenticated ciphertext and version. The app never exports raw encryption-key bytes. Authenticate the destination scope as additional data.
- Scope records to BYOK protocol, gateway and effective normalized API URL using the request URL resolver. Model/deployment/limit changes and inactive URL fields do not change scope. Invalid or credential-bearing URLs are not admitted to storage. Destination changes synchronously clear inherited keys and load only the matching record; switching back restores the previous destination's separate key.
- Mount once for the app, independently of Settings. Empty startup hydration reads, never deletes. Existing in-memory keys are saved on mount. Serialize each client's operations and fence stale restore/status results after edits, deletion, scope changes or unmount. Report success only after transaction commit. There is no expiry timer.
- Editing automatically replaces the encrypted record. Clearing the field or **Remove saved API key** deletes both ciphertext and its encryption key, including during startup. Failure reports an error and offers **Retry** without silently resetting unreadable data or using plaintext fallback storage.
- Where supported, a same-origin `BroadcastChannel` carries only the changed scope. Idle tabs refresh it without writing back; pending local edits retain last-committed-write behavior. Notification denial does not fail a committed vault write. Restored keys use ordinary in-memory discovery/connection/agent configuration; restoration itself makes no provider request.
- Local-model keys and pairing/provider tokens retain their session-only behavior. CLI credentials remain owned by the provider tools.

## Protection and retention boundary

This encrypts API-key values in application storage. It is not OS Keychain, a password-unlocked vault, hardware-backed protection or hosted credential authorization. Same-origin JavaScript can ask Web Crypto to decrypt, as the app must for requests. It does not protect against XSS, malicious extensions, a compromised browser/OS or access to the complete profile. Browser/OS implementations own at-rest protection of persisted `CryptoKey` material.

Retention is per browser/WebView profile and origin (scheme, hostname and port). Normal close/reopen preserves records. Private browsing, clearing site data, profile deletion/reinstallation, storage eviction or changing origin can make them unavailable. No cloud backup or credential export is added. The UI distinguishes loading/saving/saved/empty/error; wait for saved status before closing a newly edited key.

Deleting the saved copy does not revoke the vendor key or cancel a previously admitted server run. Server execution/research closures retain existing memory-only admission/expiry rules. Native WebViews and Windows still require release qualification.

## Validation

Synthetic-key checks cover non-extractability, authenticated encryption, corruption/scope rejection, session restoration, replacement/deletion, serialized/stale operations, endpoint isolation and storage failures. Browser checks cover actual IndexedDB structured-cloning and durability across reload/full profile reopen, plus plaintext exclusion and recovery. No real API key or paid inference is needed.
