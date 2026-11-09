import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

// The phone and the Mac talk through a relay that must not be able to read or change what they
// say. Everything here has a twin in the app (`ios/Hopper/Remote/Crypto.swift`, on CryptoKit),
// and test/fixtures/remote-vectors.json checks the two agree byte for byte.
//
// Keys are X25519, raw 32 bytes. A pairing key comes from the Mac's and the phone's long-term keys;
// each connection then swaps fresh keys under it and derives one key per direction. Frames are
// ChaCha20-Poly1305. The plan, with the reasons: planning/saltbark/hopper/ios.md in the meta repo.

export type KeyPair = { publicKey: Buffer; privateKey: Buffer }

// DER wrappers that turn raw X25519 keys into the shapes node:crypto takes.
const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const SPKI = Buffer.from('302a300506032b656e032100', 'hex')

export function newKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(SPKI.length),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(PKCS8.length),
  }
}

export function publicOf(privateKey: Buffer): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8, privateKey]),
    format: 'der',
    type: 'pkcs8',
  })
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(SPKI.length)
}

export function x25519(privateKey: Buffer, publicKey: Buffer): Buffer {
  if (privateKey.length !== 32 || publicKey.length !== 32)
    throw new Error('X25519 keys are 32 bytes')
  return diffieHellman({
    privateKey: createPrivateKey({
      key: Buffer.concat([PKCS8, privateKey]),
      format: 'der',
      type: 'pkcs8',
    }),
    publicKey: createPublicKey({
      key: Buffer.concat([SPKI, publicKey]),
      format: 'der',
      type: 'spki',
    }),
  })
}

const hkdf = (ikm: Buffer, salt: Buffer, info: Buffer, length: number) =>
  Buffer.from(hkdfSync('sha256', ikm, salt, info, length))

const PAIR_INFO = Buffer.from('hopper pair v1')
const SESSION_INFO = Buffer.from('hopper session v1')
const PROOF_LABEL = Buffer.from('hopper pair v1')

// The key a pairing keeps for life. Either side computes it from its own private key and the
// other's public key; the room id salts it, so one phone paired twice gets two keys.
export const pairingKey = (ownPrivate: Buffer, otherPublic: Buffer, room: Buffer) =>
  hkdf(x25519(ownPrivate, otherPublic), room, PAIR_INFO, 32)

// What the phone sends to show it saw the QR code: only it and the Mac know the secret.
export const pairProof = (secret: Buffer, room: Buffer, phonePublic: Buffer) =>
  createHmac('sha256', secret).update(PROOF_LABEL).update(room).update(phonePublic).digest()

export function proofMatches(secret: Buffer, room: Buffer, phonePublic: Buffer, proof: Buffer) {
  const want = pairProof(secret, room, phonePublic)
  return proof.length === want.length && timingSafeEqual(proof, want)
}

// One connection's keys, from both sides' fresh keys, salted with the pairing key so only the
// paired two can arrive at them. Mac to phone, then phone to Mac.
export function sessionKeys(
  ownEphPrivate: Buffer,
  otherEphPublic: Buffer,
  pairKey: Buffer,
  macEph: Buffer,
  phoneEph: Buffer,
): { macToPhone: Buffer; phoneToMac: Buffer } {
  const out = hkdf(
    x25519(ownEphPrivate, otherEphPublic),
    pairKey,
    Buffer.concat([SESSION_INFO, macEph, phoneEph]),
    64,
  )
  return { macToPhone: out.subarray(0, 32), phoneToMac: out.subarray(32) }
}

const TAG = 16

function seal(key: Buffer, nonce: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG })
  c.setAAD(aad, { plaintextLength: plaintext.length })
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()])
}

function open(key: Buffer, nonce: Buffer, box: Buffer, aad: Buffer): Buffer | null {
  if (box.length < TAG) return null
  const d = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG })
  d.setAAD(aad, { plaintextLength: box.length - TAG })
  d.setAuthTag(box.subarray(box.length - TAG))
  try {
    return Buffer.concat([d.update(box.subarray(0, box.length - TAG)), d.final()])
  } catch {
    return null
  }
}

// Sealed with a random nonce carried in front: nonce, ciphertext, tag (CryptoKit's `combined`).
// For the few messages under the pairing key, where both sides share one key.
export function sealBox(
  key: Buffer,
  plaintext: Buffer,
  aad: Buffer,
  nonce: Buffer = randomBytes(12),
) {
  return Buffer.concat([nonce, seal(key, nonce, plaintext, aad)])
}

export function openBox(key: Buffer, box: Buffer, aad: Buffer): Buffer | null {
  if (box.length < 12 + TAG) return null
  return open(key, box.subarray(0, 12), box.subarray(12), aad)
}

// A counter as a nonce: four zero bytes, then the count, big-endian.
export function counterNonce(n: bigint): Buffer {
  const b = Buffer.alloc(12)
  b.writeBigUInt64BE(n, 4)
  return b
}

const NO_AAD = Buffer.alloc(0)

// One direction of a connection. Frames carry no nonce: each side counts, so a frame dropped,
// repeated or reordered fails to open, and the connection starts over.
export class Channel {
  private sent = 0n
  private received = 0n
  constructor(
    private readonly sendKey: Buffer,
    private readonly receiveKey: Buffer,
  ) {}

  seal(plaintext: Buffer): Buffer {
    return seal(this.sendKey, counterNonce(this.sent++), plaintext, NO_AAD)
  }

  open(box: Buffer): Buffer | null {
    const out = open(this.receiveKey, counterNonce(this.received), box, NO_AAD)
    if (out) this.received++
    return out
  }
}

export const b64u = (b: Buffer) => b.toString('base64url')
export function fromB64u(s: string, length?: number): Buffer {
  const b = Buffer.from(s, 'base64url')
  if (length !== undefined && b.length !== length) throw new Error(`expected ${length} bytes`)
  return b
}
