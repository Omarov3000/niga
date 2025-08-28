import { getMimeExtension } from './ufile-utils'
import { getDirPath } from './ufile-utils'
import { nanoid } from 'nanoid'

const uid = () => nanoid()

export interface UFileInfo {
  type: string
  path: string
  readonly size: number

  readonly name: string
  readonly dirPath: string
}

export class UFileStream implements UFileInfo {
  constructor(
    public type: string,
    public path: string,
    public blob: any, // on backend it will be stream (request body)
    public size: number,
    public _ufile?: UFile, // on frontend actual reference to UFile
  ) {}

  get name() {
    return this.path.split('/').pop() || ''
  }

  get dirPath() {
    return getDirPath(this.path)
  }

  moveTo(dirPath: string) {
    this.path = `${dirPath}/${this.path}`
    return this
  }

  async toUFile(onChunk?: (chunk: Uint8Array) => void): Promise<UFile> {
    const reader = this.blob.getReader?.() // for backend only
    if (!reader) {
      if (!this._ufile) throw new Error('Cannot read stream (probably on frontend)')
      return this._ufile // for tests
    }

    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      onChunk?.(value)
    }

    return new UFile(new Blob(chunks, { type: this.type }), { path: this.path })
  }
}

export class UFile implements UFileInfo {
  id = uid() // for query

  path = ''

  file: a

  meta: a

  // file is File, Blob, UFile, object
  constructor(file?: any, opts?: { path?: string; type?: string; meta?: any }) {
    if (!file) this.file = new File([], '')

    if (opts?.path) this.path = opts.path
    else {
      if (file instanceof File) this.path = file.name
      else if (file instanceof Blob) this.path = `${uid()}${getMimeExtension(file.type)}`
      else if (file instanceof UFile) this.path = file.path
      else if (isO(file)) this.path = `${uid()}.json`
    }

    if (file instanceof File) this.file = file
    else if (file instanceof Blob) this.file = new File([file], this.name, { type: file.type })
    else if (file instanceof UFile) this.file = file.file
    else if (file instanceof Uint8Array)
      // @ts-ignore
      this.file = new File([file.buffer], this.name, { type: 'application/octet-stream' })
    // should be last since ArrayBuffer is O
    else if (isO(file)) this.file = new File([oToBlob(file)], this.name, { type: 'application/json' })
    // else // probably undefined

    if (opts?.type) {
      this.file = new File([this.file], this.name, { type: opts.type })
    }

    if (opts?.meta) this.meta = opts.meta
  }

  get dirPath() {
    return getDirPath(this.path)
  }

  set dirPath(dirPath: string) {
    this.path = `${dirPath}/${this.name}`
  }

  setDirPath(dirPath: string) {
    this.dirPath = dirPath
    return this
  }

  setPath(path: string) {
    this.path = path
    return this
  }

  moveTo(dirPath: string) {
    this.path = `${dirPath}/${this.path}`
    return this
  }

  makeNameUnique(id?: string) {
    this.name = `${this.fileNameWithoutExtension}-${id || uid()}.${this.extension}`
    return this
  }

  get name() {
    return this.path.split('/').pop() || ''
  }

  set name(name: string) {
    if (this.dirPath) this.path = `${this.dirPath}/${name}`
    else this.path = name
  }

  setName(name: string) {
    this.name = name
    return this
  }

  get extension() {
    return this.name.split('.').at(-1) || ''
  }

  set extension(ext: string) {
    this.name = `${this.fileNameWithoutExtension}.${ext}`
  }

  get fileNameWithoutExtension() {
    return this.name.split('.').slice(0, -1).join('.')
  }

  get size() {
    return this.file.size
  }

  get type(): string {
    return this.file.type
  }

  get isImage() {
    return this.type.startsWith('image')
  }

  get isVideo() {
    return this.type.startsWith('video')
  }

  get isAudio() {
    return this.type.startsWith('audio')
  }

  getMeta<T>(): T {
    return this.meta as T
  }

  createObjectURL(): string {
    const url = URL as a
    if (!url.createObjectURL) throw new Error('createObjectURL not supported') // on backend
    return url.createObjectURL(this.file)
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.file.arrayBuffer()
  }

  uint8Array(): Promise<Uint8Array> {
    return this.arrayBuffer().then((ab) => new Uint8Array(ab))
  }

  blob(): Blob {
    return this.file
  }

  toStream(): UFileStream {
    return new UFileStream(this.type, this.path, this.file, this.size, this)
  }

  json<T>(): Promise<T> {
    return blobToO(this.file)
  }

  toString() {
    return `UFile(${this.name} ${this.size} ${this.id})`
  }

  clone() {
    return new UFile(this.file, { path: this.path })
  }
}

export type SetUFile = (_: UFile) => void
export type UFiles = UFile[]
export type SetUFiles = (_: UFiles) => void

const oToBlob = (obj: unknown) => new Blob([JSON.stringify(obj)], { type: 'application/json' })
const blobToO = async (blob: Blob) => JSON.parse(await blob.text())

const isO = (obj: unknown) => obj !== null && typeof obj === 'object'

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type a = any
