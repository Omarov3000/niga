stream string or uint8array data

```ts
// Simple HTTP Binary Stream Parser for String/Uint8Array data
class BinaryStreamParser {
  constructor() {
    this.buffer = new Uint8Array(0);
    this.state = 'WAITING_TYPE';
    this.currentItem = null;
    this.bytesNeeded = 1;
  }

  /**
   * Add incoming binary data chunk and return completed items
   * @param {Uint8Array} chunk - New binary data
   * @returns {Array} Array of completed items
   */
  addChunk(chunk) {
    // Append new chunk to buffer
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    const completedItems = [];

    // Process buffer while we have enough data
    while (this.buffer.length >= this.bytesNeeded) {
      const result = this._processState();
      if (result) {
        completedItems.push(result);
        if (result.type === 'end') break;
      }
    }

    return completedItems;
  }

  _processState() {
    switch (this.state) {
      case 'WAITING_TYPE':
        return this._readType();
      case 'WAITING_STRING_LENGTH':
        return this._readStringLength();
      case 'WAITING_ARRAY_LENGTH':
        return this._readArrayLength();
      case 'READING_STRING_DATA':
        return this._readStringData();
      case 'READING_ARRAY_DATA':
        return this._readArrayData();
    }
  }

  _readType() {
    const type = this.buffer[0];
    this._consumeBytes(1);

    if (type === 255) {
      return { type: 'end' };
    } else if (type === 0) {
      this.currentItem = { type: 'string' };
      this.state = 'WAITING_STRING_LENGTH';
      this.bytesNeeded = 1;
    } else if (type === 1) {
      this.currentItem = { type: 'uint8array' };
      this.state = 'WAITING_ARRAY_LENGTH';
      this.bytesNeeded = 4;
    } else {
      throw new Error(`Unknown type marker: ${type}`);
    }
    return null;
  }

  _readStringLength() {
    const length = this.buffer[0];
    this._consumeBytes(1);

    this.currentItem.length = length;
    this.state = 'READING_STRING_DATA';
    this.bytesNeeded = length;

    if (length === 0) {
      return this._completeStringItem('');
    }
    return null;
  }

  _readArrayLength() {
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 4);
    const length = view.getUint32(0, true); // little endian
    this._consumeBytes(4);

    this.currentItem.length = length;
    this.state = 'READING_ARRAY_DATA';
    this.bytesNeeded = length;

    if (length === 0) {
      return this._completeArrayItem(new Uint8Array(0));
    }
    return null;
  }

  _readStringData() {
    const stringBytes = this.buffer.slice(0, this.currentItem.length);
    this._consumeBytes(this.currentItem.length);

    const decoder = new TextDecoder();
    const stringData = decoder.decode(stringBytes);

    return this._completeStringItem(stringData);
  }

  _readArrayData() {
    const arrayData = new Uint8Array(this.buffer.slice(0, this.currentItem.length));
    this._consumeBytes(this.currentItem.length);

    return this._completeArrayItem(arrayData);
  }

  _completeStringItem(data) {
    const item = { type: 'string', data };
    this._resetState();
    return item;
  }

  _completeArrayItem(data) {
    const item = { type: 'uint8array', data };
    this._resetState();
    return item;
  }

  _resetState() {
    this.state = 'WAITING_TYPE';
    this.bytesNeeded = 1;
    this.currentItem = null;
  }

  _consumeBytes(count) {
    this.buffer = this.buffer.slice(count);
  }
}

// Simple HTTP Binary Streamer
class HTTPBinaryStreamer {
  constructor(url, options = {}) {
    this.url = url;
    this.options = {
      method: 'GET',
      headers: {
        'Accept': 'application/octet-stream',
        ...options.headers
      },
      ...options
    };
    this.parser = new BinaryStreamParser();
  }

  /**
   * Stream items from HTTP endpoint
   * @returns {AsyncGenerator} Yields items as they're parsed
   */
  async *streamItems() {
    const response = await fetch(this.url, this.options);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('ReadableStream not supported');
    }

    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // Parse the chunk and yield completed items
        const items = this.parser.addChunk(value);

        for (const item of items) {
          if (item.type === 'end') {
            return; // Stream complete
          }
          yield item;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get all items at once (buffers everything)
   * @returns {Promise<Array>} All items
   */
  async getAllItems() {
    const items = [];
    for await (const item of this.streamItems()) {
      items.push(item);
    }
    return items;
  }
}

// Server-side helper for generating streams
class BinaryStreamGenerator {
  /**
   * Serialize an item to binary chunks
   * @param {Object} item - {type: 'string'|'uint8array', data: string|Uint8Array}
   * @returns {Array<Uint8Array>} Binary chunks
   */
  static serializeItem(item) {
    const chunks = [];

    if (item.type === 'string') {
      if (item.data.length > 255) {
        throw new Error(`String too long: ${item.data.length} > 255`);
      }

      chunks.push(new Uint8Array([0])); // String type marker
      chunks.push(new Uint8Array([item.data.length])); // Length (1 byte)

      const encoder = new TextEncoder();
      chunks.push(encoder.encode(item.data)); // UTF-8 data

    } else if (item.type === 'uint8array') {
      chunks.push(new Uint8Array([1])); // Array type marker

      const lengthArray = new Uint32Array([item.data.length]);
      chunks.push(new Uint8Array(lengthArray.buffer)); // Length (4 bytes)

      chunks.push(item.data); // Array data

    } else {
      throw new Error(`Unknown type: ${item.type}`);
    }

    return chunks;
  }

  /**
   * Get end marker
   * @returns {Uint8Array} End marker bytes
   */
  static getEndMarker() {
    return new Uint8Array([255]);
  }
}

// Usage Examples
async function basicExample() {
  console.log('=== Basic Streaming ===');

  const streamer = new HTTPBinaryStreamer('/api/data');

  for await (const item of streamer.streamItems()) {
    console.log('Received:', item);
  }

  console.log('Stream complete');
}

async function getAllExample() {
  console.log('=== Get All Items ===');

  const streamer = new HTTPBinaryStreamer('/api/data');
  const items = await streamer.getAllItems();

  console.log('All items:', items);
}

async function postExample() {
  console.log('=== POST Request ===');

  const streamer = new HTTPBinaryStreamer('/api/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'some data' })
  });

  for await (const item of streamer.streamItems()) {
    console.log('Response item:', item);
  }
}

// Manual parsing example
function manualParsingExample() {
  console.log('=== Manual Parsing ===');

  const parser = new BinaryStreamParser();

  // Simulate chunks
  const chunk1 = new Uint8Array([0, 5, 72, 101, 108, 108, 111]); // "Hello"
  const chunk2 = new Uint8Array([1, 3, 0, 0, 0, 10, 20, 30]); // [10,20,30]
  const chunk3 = new Uint8Array([255]); // End marker

  console.log('Chunk 1 items:', parser.addChunk(chunk1));
  console.log('Chunk 2 items:', parser.addChunk(chunk2));
  console.log('Chunk 3 items:', parser.addChunk(chunk3));
}

// Server example (for reference)
/*
// Express.js server example:
app.get('/api/data', (req, res) => {
  res.setHeader('Content-Type', 'application/octet-stream');

  const items = [
    { type: 'string', data: 'Hello World' },
    { type: 'uint8array', data: new Uint8Array([1, 2, 3, 4, 5]) },
    { type: 'string', data: 'Another string' }
  ];

  // Send each item
  for (const item of items) {
    const chunks = BinaryStreamGenerator.serializeItem(item);
    chunks.forEach(chunk => res.write(chunk));
  }

  // Send end marker
  res.write(BinaryStreamGenerator.getEndMarker());
  res.end();
});
*/

// Run example
manualParsingExample();

console.log('Simple HTTP Binary Streaming ready!');
```
