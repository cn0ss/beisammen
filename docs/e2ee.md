# End-to-End Encryption (E2EE)

Beisammen encrypts media client-side so that only circle members can read it —
neither the cloud backend, the S3/R2 bucket, nor a self-hosted server operator
ever see plaintext content or keys. The design follows the Ente model
(per-file keys wrapped by collection keys wrapped per member) rather than MLS:
stored family media needs durable group access, not messaging-style forward
secrecy.

All primitives are libsodium via `@beisammen/crypto` (`packages/crypto`),
which is sodium-implementation-injected: mobile passes
`react-native-libsodium`, web/tests pass `libsodium-wrappers`.

## Key hierarchy

```
recovery code  ──(Argon-free: random 32-byte key, Crockford-base32+checksum)
      │ wraps
master key     ── generated on device, stored in the device keychain
      │            (iOS: iCloud-Keychain-synced — pragmatic device migration;
      │             Android: local Keystore only → recovery code required)
      │ wraps
user X25519 keypair ── public key on server; private key stored only wrapped
      │ opens (crypto_box_seal)
circle key (per epoch) ── sealed per member into `circleKeyGrants`
      │ wraps (secretbox)
file key (per asset)   ── encrypts the media bytes (BSE1 format)
```

Server-side state (`convex/keys.ts`, tables `userKeys`, `circleKeyEpochs`,
`circleKeyGrants`) holds only public keys and ciphertext. Registration is
write-once per user; replacing keys is rejected until an explicit
re-encrypting reset flow exists.

### Epochs and membership

- The first member client to come online initializes epoch 1 with a
  self-grant (`initializeCircleKey`; concurrent initializers lose the race
  and re-read).
- Any member holding the epoch key tops up grants for members without one
  (`listMissingKeyGrants` → `grantCircleKeys`). New joiners therefore get
  access as soon as any key-holding member is online — the server verifies
  membership and that the granter itself holds a grant, and never sees the
  key.
- Removing a member deletes their grants and the remover's client rotates to
  the next epoch (`rotateCircleKey`, owners/admins, must self-grant). Old
  epochs stay stored so old assets remain decryptable; a removed member who
  saved keys can, as in every E2EE system, still read content from epochs
  they legitimately held.

### Recovery UX (pragmatic profile)

Clerk handles auth (OAuth — no password to derive keys from), so the master
key is device-generated. Three recovery paths, in order:

1. iCloud Keychain sync (iOS, automatic).
2. Recovery code (`XXXXX-XXXXX-…`), shown once at key generation and
   re-viewable in settings; redeems `encMasterKeyByRecovery` on a new device.
3. None → media is unrecoverable. This is inherent to E2EE and must be
   communicated at onboarding.

## Media format: BSE1 (`packages/crypto/src/fileEncryption.ts`)

36-byte header (magic `BSE1`, version, algorithm, chunk size, plaintext
length, 16-byte file nonce) followed by fixed-size chunks encrypted with
XChaCha20-Poly1305; chunk nonce = fileNonce ‖ chunk index, AD =
base64(header ‖ final-flag byte) as a UTF-8 string (react-native-libsodium
only implements string AD inputs). Properties:

- Chunks decrypt independently → HTTP range requests can fetch and decrypt
  exactly the chunks a video player asks for. No video duration limit is
  needed; playback streams via a local decrypting proxy instead of
  download-everything-first. R2 has zero egress fees, so ranged streaming
  costs nothing extra.
- The authenticated header (length + final flag) rules out truncation and
  chunk reordering.
- Default chunk size 1 MiB; previews use the same format via
  `encryptBytes`/`decryptBytes`.

## What stays plaintext (deliberate)

- `capturedAt`, dimensions, mimeType, sizes — needed for sorting, limits and
  billing; billing charges the server-observed ciphertext size (HEAD), which
  works unchanged.
- NOT location: GPS metadata moves into the encrypted envelope in the media
  phase. The map/places view is rebuilt client-side from decrypted metadata
  (memories aggregation for places leaves the server).
- Captions/comments/reactions remain plaintext for now (explicitly out of
  scope for the media phase).

## Phasing

- **Phase 0 (done):** `@beisammen/crypto`, key registry (`convex/keys.ts`),
  keychain + bootstrap/recovery logic in
  `apps/mobile/src/features/crypto/`, grant cleanup on member removal /
  leave / account deletion.
- **Phase 1 (done):** encrypt originals + previews in the upload pipeline (BSE1,
  per-asset file key wrapped with the circle-key epoch, stored on
  `assets.encryption`), decrypting media cache on display, encrypted GPS +
  original file name in `encMetadata`, generic upload file names, client-side
  place aggregation. EXIF stripping became unnecessary: originals and
  previews are both ciphertext server-side, and decrypted content is only
  ever visible to circle members.
- **Phase 2 (done):** encrypted video originals stream via a local
  range-decrypting HTTP proxy in the app process
  (`apps/mobile/src/features/media/video-proxy/`): a loopback TCP server
  (react-native-tcp-socket, 127.0.0.1, OS-assigned port) serves
  `/v/<random-token>` URLs to the native player. Seeks map to chunk indexes,
  ciphertext ranges are fetched straight from R2 and decrypted in memory —
  Convex only signs URLs, roughly one `assets.getReadUrl` call per 5-minute
  URL window (refreshed early and on 403). A fully decrypted cache file is
  preferred over the proxy when it exists; images/previews keep the
  decrypted-cache path, and the explicit download/save/share flows keep
  download-then-decrypt (they need a real file). Android release builds allow
  cleartext only for 127.0.0.1/localhost via a network security config
  (`apps/mobile/plugins/with-localhost-cleartext.js`); iOS allows localhost
  through `NSAllowsLocalNetworking`.
- **Phase 3:** E2EE web share links: share key in the URL fragment (never
  sent to the server), browser decrypts via WASM libsodium. Public links
  were removed until this exists.
- **Migration:** existing plaintext assets stay readable; clients re-encrypt
  opportunistically or content is marked "pre-E2EE".
