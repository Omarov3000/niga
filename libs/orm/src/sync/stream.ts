/**
 * Binary streaming protocol for transferring table data
 *
 * Stream format:
 * - Type 0: String (1 byte length + UTF-8 data)
 * - Type 1: Uint8Array (4 bytes length + binary data)
 * - Type 255: End marker
 */

export type StreamItem =
  | { type: 'string'; data: string }
  | { type: 'uint8array'; data: Uint8Array }
  | { type: 'end' }

type ParserState =
  | 'WAITING_TYPE'
  | 'WAITING_STRING_LENGTH'
  | 'WAITING_ARRAY_LENGTH'
  | 'READING_STRING_DATA'
  | 'READING_ARRAY_DATA'

export class BinaryStreamParser {
  private buffer: Uint8Array = new Uint8Array(0)
  private state: ParserState = 'WAITING_TYPE'
  private currentItem: any = null
  private bytesNeeded: number = 1

  /**
   * Add incoming binary data chunk and return completed items
   */
  addChunk(chunk: Uint8Array): StreamItem[] {
    // Append new chunk to buffer
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length)
    newBuffer.set(this.buffer)
    newBuffer.set(chunk, this.buffer.length)
    this.buffer = newBuffer

    const completedItems: StreamItem[] = []

    // Process buffer while we have enough data
    while (this.buffer.length >= this.bytesNeeded) {
      const result = this.processState()
      if (result) {
        completedItems.push(result)
        if (result.type === 'end') break
      }
    }

    return completedItems
  }

  private processState(): StreamItem | null {
    switch (this.state) {
      case 'WAITING_TYPE':
        return this.readType()
      case 'WAITING_STRING_LENGTH':
        return this.readStringLength()
      case 'WAITING_ARRAY_LENGTH':
        return this.readArrayLength()
      case 'READING_STRING_DATA':
        return this.readStringData()
      case 'READING_ARRAY_DATA':
        return this.readArrayData()
    }
  }

  private readType(): StreamItem | null {
    const type = this.buffer[0]
    this.consumeBytes(1)

    if (type === 255) {
      return { type: 'end' }
    } else if (type === 0) {
      this.currentItem = { type: 'string' }
      this.state = 'WAITING_STRING_LENGTH'
      this.bytesNeeded = 1
    } else if (type === 1) {
      this.currentItem = { type: 'uint8array' }
      this.state = 'WAITING_ARRAY_LENGTH'
      this.bytesNeeded = 4
    } else {
      throw new Error(`Unknown type marker: ${type}`)
    }
    return null
  }

  private readStringLength(): StreamItem | null {
    const length = this.buffer[0]
    this.consumeBytes(1)

    this.currentItem.length = length
    this.state = 'READING_STRING_DATA'
    this.bytesNeeded = length

    if (length === 0) {
      return this.completeStringItem('')
    }
    return null
  }

  private readArrayLength(): StreamItem | null {
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 4)
    const length = view.getUint32(0, true) // little endian
    this.consumeBytes(4)

    this.currentItem.length = length
    this.state = 'READING_ARRAY_DATA'
    this.bytesNeeded = length

    if (length === 0) {
      return this.completeArrayItem(new Uint8Array(0))
    }
    return null
  }

  private readStringData(): StreamItem | null {
    const stringBytes = this.buffer.slice(0, this.currentItem.length)
    this.consumeBytes(this.currentItem.length)

    const decoder = new TextDecoder()
    const stringData = decoder.decode(stringBytes)

    return this.completeStringItem(stringData)
  }

  private readArrayData(): StreamItem | null {
    const arrayData = new Uint8Array(this.buffer.slice(0, this.currentItem.length))
    this.consumeBytes(this.currentItem.length)

    return this.completeArrayItem(arrayData)
  }

  private completeStringItem(data: string): StreamItem {
    this.resetState()
    return { type: 'string', data }
  }

  private completeArrayItem(data: Uint8Array): StreamItem {
    this.resetState()
    return { type: 'uint8array', data }
  }

  private resetState(): void {
    this.state = 'WAITING_TYPE'
    this.bytesNeeded = 1
    this.currentItem = null
  }

  private consumeBytes(count: number): void {
    this.buffer = this.buffer.slice(count)
  }
}

export class BinaryStreamGenerator {
  /**
   * Serialize a string item to binary chunks
   */
  static serializeString(str: string): Uint8Array[] {
    if (str.length > 255) {
      throw new Error(`String too long: ${str.length} > 255`)
    }

    const chunks: Uint8Array[] = []
    chunks.push(new Uint8Array([0])) // String type marker
    chunks.push(new Uint8Array([str.length])) // Length (1 byte)

    const encoder = new TextEncoder()
    chunks.push(encoder.encode(str)) // UTF-8 data

    return chunks
  }

  /**
   * Serialize a Uint8Array item to binary chunks
   */
  static serializeUint8Array(data: Uint8Array): Uint8Array[] {
    const chunks: Uint8Array[] = []
    chunks.push(new Uint8Array([1])) // Array type marker

    const lengthArray = new Uint32Array([data.length])
    chunks.push(new Uint8Array(lengthArray.buffer)) // Length (4 bytes, little endian)

    chunks.push(data) // Array data

    return chunks
  }

  /**
   * Get end marker
   */
  static getEndMarker(): Uint8Array {
    return new Uint8Array([255])
  }

  /**
   * Combine multiple Uint8Array chunks into one
   */
  static combineChunks(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    return combined
  }
}
