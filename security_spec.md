# Security Specification — Merlion Kyat Vault

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document in `/vaultConfigs/{userId}`, `/users/{userId}/transactions/{transactionId}`, and `/users/{userId}/holdings/{holdingId}` belongs strictly to the authenticated user whose `request.auth.uid == userId` and `data.ownerId == request.auth.uid`.
2. **Email Verification Mandate**: All write operations (`create`, `update`, `delete`) require `request.auth.token.email_verified == true`.
3. **Master Gate Relational Sync**: Subcollections `/users/{userId}/transactions/{transactionId}` and `/users/{userId}/holdings/{holdingId}` require the parent `/vaultConfigs/{userId}` document to exist and belong to `request.auth.uid`.
4. **Strict Key & Size Boundaries**: Every entity enforces `hasAll` and `hasOnly` on keys during creation, `affectedKeys().hasOnly(...)` during updates, string `.size()` limits matching `firebase-blueprint.json`, and numeric range sanity bounds.
5. **Temporal & Identity Immutability**: `ownerId` and `createdAt` cannot be modified after creation. `createdAt` on create and `updatedAt` on create/update must equal `request.time`.

## 2. The "Dirty Dozen" Payloads
1. **Identity Spoofing**: Creating a transaction under `/users/userA/transactions/tx1` with `ownerId: "userB"`.
2. **Cross-Tenant Read/List**: Querying `/users/userB/transactions` while authenticated as `userA`.
3. **Unverified Email Write**: Creating a holding when `request.auth.token.email_verified == false`.
4. **Shadow Field Injection (Create)**: Creating a `VaultConfig` with an undeclared field `"isAdmin": true`.
5. **Shadow Field Injection (Update)**: Updating a `Transaction` with an undeclared field `"injected": "payload"`.
6. **Path ID Poisoning**: Creating a document with a 200-character or special-character document ID.
7. **Denial-of-Wallet String Overflow**: Sending a `note` field of 10,000 characters on a `Transaction` (limit is 300).
8. **Immutable Field Mutation (`ownerId`)**: Updating `ownerId` on an existing `Holding` document.
9. **Immutable Field Mutation (`createdAt`)**: Updating `createdAt` on an existing `Transaction` document.
10. **Forged Client Timestamp**: Creating a `Holding` where `createdAt` or `updatedAt` does not match `request.time`.
11. **Value Type Poisoning on Update**: Updating `amountSgd` to a string `"1000"` instead of a valid non-negative number.
12. **Orphaned Subcollection Write**: Creating a transaction in `/users/{userId}/transactions/{txId}` when `/vaultConfigs/{userId}` does not exist.
