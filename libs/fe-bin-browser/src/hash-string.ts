export const hashString = (str: string, salt = '') =>
  murmurhash2_64_gc(str + salt)
    .toString(16)
    .padStart(16, '0')
export const hashString128 = (str: string, salt = '') => murmurhash2_128_gc(str + salt)
export const hashStringDigits = (str: string, salt = '') => {
  const hash = murmurhash2_128_gc(str + salt)
  // Convert hex hash to digits only by treating each hex char as a number and concatenating
  let digits = ''
  for (let i = 0; i < hash.length; i++) {
    const hexChar = hash[i]
    const value = Number.parseInt(hexChar, 16) // Convert hex char to number (0-15)
    digits += value.toString() // Convert to string and append
  }
  // Ensure minimum 16 characters by padding with the hash of the original hash if needed
  while (digits.length < 16) {
    const additionalHash = murmurhash2_64_gc(digits + str + salt).toString()
    digits += additionalHash
  }
  return digits.slice(0, Math.max(16, digits.length)) // Return at least 16 characters
}

// chose it because of https://softwareengineering.stackexchange.com/questions/49550/which-hashing-algorithm-is-best-for-uniqueness-and-speed/145633#145633
function murmurhash2_64_gc(str: string, seed = 0): bigint {
  const m = BigInt(0xc6a4a7935bd1e995)
  const r = BigInt(47)

  let h = BigInt(seed) ^ (BigInt(str.length) * m)

  const length = str.length
  const remainder = length & 7
  const bytes = length - remainder

  let i = 0
  while (i < bytes) {
    let k =
      BigInt(str.charCodeAt(i++) & 0xff) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(8)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(16)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(24)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(32)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(40)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(48)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(56))

    k = k * m
    k ^= k >> r
    k = k * m

    h ^= k
    h = h * m
  }

  switch (remainder) {
    // @ts-ignore
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
    case 7:
      h ^= BigInt(str.charCodeAt(i + 6) & 0xff) << BigInt(48)
    // @ts-ignore
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
    case 6:
      h ^= BigInt(str.charCodeAt(i + 5) & 0xff) << BigInt(40)
    // @ts-ignore
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
    case 5:
      h ^= BigInt(str.charCodeAt(i + 4) & 0xff) << BigInt(32)
    // @ts-ignore
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
    case 4:
      h ^= BigInt(str.charCodeAt(i + 3) & 0xff) << BigInt(24)
    // @ts-ignore
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
    case 3:
      h ^= BigInt(str.charCodeAt(i + 2) & 0xff) << BigInt(16)
    // @ts-ignore
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
    case 2:
      h ^= BigInt(str.charCodeAt(i + 1) & 0xff) << BigInt(8)
    case 1:
      h ^= BigInt(str.charCodeAt(i) & 0xff)
      h = h * m
  }

  h ^= h >> r
  h = h * m
  h ^= h >> r

  // Ensure it's a positive BigInt
  return h & BigInt('0xFFFFFFFFFFFFFFFF')
}

// ai generated 128-bit version of MurmurHash2
function murmurhash2_128_gc(str: string, seed = 0): string {
  const m = BigInt(0xc6a4a7935bd1e995)
  const r = BigInt(47)

  let h1 = BigInt(seed) ^ (BigInt(str.length) * m)
  let h2 = BigInt(seed + 1) ^ (BigInt(str.length) * m)

  const length = str.length
  const remainder = length & 7
  const bytes = length - remainder

  let i = 0
  while (i < bytes) {
    let k1 =
      BigInt(str.charCodeAt(i++) & 0xff) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(8)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(16)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(24)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(32)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(40)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(48)) |
      (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(56))

    k1 = k1 * m
    k1 ^= k1 >> r
    k1 = k1 * m

    h1 ^= k1
    h1 = h1 * m

    // If we have more characters to process, create a second hash
    if (i < bytes) {
      let k2 =
        BigInt(str.charCodeAt(i++) & 0xff) |
        (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(8)) |
        (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(16)) |
        (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(24)) |
        (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(32)) |
        (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(40)) |
        (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(48)) |
        (BigInt(str.charCodeAt(i++) & 0xff) << BigInt(56))

      k2 = k2 * m
      k2 ^= k2 >> r
      k2 = k2 * m

      h2 ^= k2
      h2 = h2 * m
    }
  }

  // Handle remaining bytes
  if (remainder > 0) {
    let k1 = BigInt(0)
    let shift = BigInt(0)

    // Process up to 7 remaining characters
    const remainingChars = Math.min(remainder, 7)
    for (let j = 0; j < remainingChars; j++) {
      k1 |= BigInt(str.charCodeAt(i + j) & 0xff) << shift
      shift += BigInt(8)
    }

    k1 = k1 * m
    k1 ^= k1 >> r
    k1 = k1 * m

    h1 ^= k1
  }

  h1 ^= h1 >> r
  h1 = h1 * m
  h1 ^= h1 >> r

  h2 ^= h2 >> r
  h2 = h2 * m
  h2 ^= h2 >> r

  // Ensure both are positive BigInts
  h1 = h1 & BigInt('0xFFFFFFFFFFFFFFFF')
  h2 = h2 & BigInt('0xFFFFFFFFFFFFFFFF')

  // Convert to hex string, ensure proper length with padStart
  const h1Str = h1.toString(16).padStart(16, '0')
  const h2Str = h2.toString(16).padStart(16, '0')

  // Return the combined 128-bit hash as a string
  return h1Str + h2Str
}
