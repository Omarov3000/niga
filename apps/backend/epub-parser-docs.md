<h1 align="center">
  <a href="https://github.com/hhk-png/lingo-reader">Home Page</a>&nbsp;&nbsp;&nbsp;
  <a href="./README-zh.md">中文</a>
</h1>

The EPUB file format is used to store ebook content, containing both the book's chapter materials and files specifying how these chapters should be sequentially read.

An EPUB file is essentially a `.zip` archive. Its content structure is built using HTML and CSS, and can theoretically include JavaScript as well. By changing the file extension to `.zip` and extracting the contents, you can directly view chapter content by opening the corresponding HTML/XHTML files. However, the chapters will appear in random order. If certain chapters or resources are encrypted, this zip extraction method will fail.

**When parsing EPUB files:**
**(1)** The first step involves parsing files like `container.xml`, `.opf`, and `.ncx`, which contain metadata (title, author, publication date, etc.), resource information (paths to images and other assets within the EPUB), and sequential chapter display information (Spine).

**(2)** The second step handles resource paths within chapters. References to resources in chapter files are only valid internally, so they must be converted to paths usable in the display environment—either as blob URLs in browsers or absolute filesystem paths in Node.js.

**(3).** The encryption information of an EPUB file is stored in the `META-INF/encryption.xml` file. Version `0.3.x` supports parsing encrypted EPUB files, but it requires adherence to a specific encryption scheme and the provision of a private key for decryption. The supported encryption methods are detailed in the `initEpubFile` section.

**(4).** In addition, EPUB files may also include signatures and rights management information, stored in the `signatures.xml` and `rights.xml` files, respectively. Like `container.xml`, these files are located in the `/META-INF/` directory and have fixed filenames. Support for parsing these files will be added in future updates of `@lingo-reader/epub-parser`.

The parser follows the [EPUB 3.3](https://www.w3.org/TR/epub-33/#sec-pkg-metadata) and [Open Packaging Format (OPF) 2.0.1 v1.0](https://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm#Section2.4.1) specifications. Its API aims to expose all available file information comprehensively.

## Install

```shell
pnpm install @lingo-reader/epub-parser
```

## Usage in node

```typescript
import { initEpubFile } from '@lingo-reader/epub-parser'

const epub = await initEpubFile('./example/alice.epub')

const spine = epub.getSpine()
const fileInfo = epub.getFileInfo()

// Load the first chapter:
// - html: Processed chapter HTML string
// - css: Chapter CSS files (absolute paths in Node.js, directly readable)
const { html, css } = epub.loadChapter(spine[0].id)

// ...
```

## Usage in browser

```ts
import { initEpubFile } from '@lingo-reader/epub-parser'

async function initEpub(file: File) {
  const epub = await initEpubFile(file)

  const spine = epub.getSpine()
  const fileInfo = epub.getFileInfo()

  // Load the first chapter:
  // - html: Processed chapter HTML string
  // - css: Chapter CSS files (provided as blob URLs, fetchable)
  const { html, css } = epub.loadChapter(spine[0].id)
}

// ...
```

## initEpubFile

```typescript
import { initEpubFile } from '@lingo-reader/epub-parser'
import type { EpubFile } from '@lingo-reader/epub-parser'
/*
  interface EpubFileOptions {
    rsaPrivateKey?: string | Uint8Array
    aesSymmetricKey?: string | Uint8Array
  }

  type initEpubFile = (epubPath: string | File, resourceSaveDir: string = './images', options: EpubFileOptions = {}): => Promise<EpubFile>
*/

const epub: EpubFile = await initEpubFile(
  file,
  './images', // The default is './images'. If you don't want to change it, you can simply pass undefined.
  {
    // The RSA private key in PKCS#8 format should be provided either as a Base64-encoded string or a Uint8Array.
    rsaPrivateKey: 'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQ......',
    aesSymmetricKey: 'D2wVcst49HU6KqC......',
  }
)
```

The primary API exposed by `@lingo-reader/epub-parser` is `initEpubFile`. When provided with a file path or File object, it returns an initialized `EpubFile` class containing methods to read metadata, Spine information, and other EPUB data.

**Parameters:**

- `epubPath: string | File`: File path or File object.
- `resourceSaveDir?: string`: Optional (Node.js only). Specifies where to save resources like images.
  - `default: './images/'`
- `options?: EpubFileOptions`：Optional. Used to pass in key information。

```typescript
interface EpubFileOptions {
  // The RSA private key in PKCS#8 format should be provided either as a Base64-encoded string or a Uint8Array.
  rsaPrivateKey?: string | Uint8Array
  aesSymmetricKey?: string | Uint8Array
}
```

**Returns:**

- `Promise`: Initialized EpubFile object (Promise).

**Note:** For the `epubPath` parameter, its type differs between environments:

- In the **browser**, it should be of type `File | Uint8Array`. Passing a `string` will result in an error.
- In **Node.js**, it should be of type `string | Uint8Array`. Passing a `File` will result in an error.

The `0.3.x` version of `epub-parser` supports decryption using two encryption schemes:

1. **Hybrid RSA + AES Encryption**
   In this approach, a symmetric AES key is encrypted using the RSA algorithm (asymmetric encryption), and the actual file contents are encrypted with that AES key. During decryption, the AES key is first recovered using an RSA private key, and then the AES key is used to decrypt the content. To enable this, you must provide an RSA private key in **PKCS8** format via the `rsaPrivateKey` option in `EpubFileOptions`.
   This method supports storing multiple AES key entries within the `encryption.xml` file.
2. **Pure AES Encryption**
   This method skips RSA and directly encrypts file contents using a symmetric AES key. In this case, the `aesSymmetricKey` option must be provided for decryption.

The decryption logic is implemented in the `parseEncryption` method within `epub-parser/src/parseFiles.ts`.

Decryption does **not** rely on any third-party libraries—it is built on the native **Web Crypto API** in the browser and **Node's crypto module**, allowing the parser to run in both browser and Node environments.

Note that the browser supports fewer cryptographic algorithms than Node; however, all browser-supported algorithms are also available in Node. Therefore, the set of supported algorithms is aligned with browser compatibility, effectively a subset of Node's capabilities.

**Supported Algorithms:**

- **Asymmetric (RSA)**:
  - `RSA-OAEP`
  - `RSA-OAEP-MGF1P`
- **Symmetric (AES)**:
  - `AES-256-CBC`
  - `AES-256-CTR`
  - `AES-256-GCM`
  - `AES-128-CBC`
  - `AES-128-CTR`
  - `AES-128-GCM`

**AES-192** is not supported in browsers and will throw an error if used to encrypt EPUB content, although it is fully supported in Node.js. The IV used for encryption should be placed at the beginning of the encrypted file. The expected key lengths for AES are:

- **256-bit**: 32 bytes
- **192-bit**: 24 bytes
- **128-bit**: 16 bytes

## EpubFile

The EpubFile class exposes these methods:

```typescript
import { EpubFile } from '@lingo-reader/epub-parser'
import { EBookParser } from '@lingo-reader/shared'

declare class EpubFile implements EBookParser {
  getFileInfo(): EpubFileInfo
  getMetadata(): EpubMetadata
  getManifest(): Record<string, ManifestItem>
  getSpine(): EpubSpine
  getGuide(): GuideReference[]
  getCollection(): CollectionItem[]
  getToc(): EpubToc
  getPageList(): PageList
  getNavList(): NavList
  loadChapter(id: string): Promise<EpubProcessedChapter>
  resolveHref(href: string): EpubResolvedHref | undefined
  destroy(): void
}
```

### getManifest(): Record<string, ManifestItem>

Retrieves all resources contained in the EPUB (HTML files, images, etc.).

```typescript
import { getManifest } from '@lingo-reader/epub-parser'
import type { ManifestItem } from '@lingo-reader/epub-parser'
/*
  type getManifest = () => Record<string, ManifestItem>
*/

// Keys represent resource `id`
const manifest: Record<string, ManifestItem> = epub.getManifest()
```

**Parameters:**

- None

**Returns:**

- `Record` - A dictionary mapping resource `id` to their descriptors:

```typescript
interface ManifestItem {
  // Unique resource identifier
  id: string
  // Path within the EPUB (ZIP) archive
  href: string
  // MIME type (e.g., "application/xhtml+xml")
  mediaType: string
  // Special role (e.g., "cover-image")
  properties?: string
  // Associated media overlay for audio/video
  mediaOverlay?: string
  // Fallback resources when this item cannot be loaded
  fallback?: string[]
}
```

### getSpine(): EpubSpine

Returns the reading order of all content documents in the EPUB.

The `linear` property in `SpineItem` indicates whether the item is part of the primary reading flow (values: "yes" or "no").

```typescript
import { getSpine } from '@lingo-reader/epub-parser'
import type { EpubSpine } from '@lingo-reader/epub-parser'
/*
  type getSpine = () => EpubSpine
*/

const spine: EpubSpine = epub.getSpine()
```

**Parameters:**

- None

**Returns:**

- `EpubSpine` - An ordered array of spine items:

```typescript
type SpineItem = ManifestItem & {
  /**
   * Reading progression flag
   * - "yes": Primary reading content (default)
   * - "no": Supplementary material
   */
  linear?: string
}
type EpubSpine = SpineItem[]
```

### loadChapter(id: string): Promise\<EpubProcessedChapter\>

The `loadChapter` function takes a chapter `id` as parameter and returns a processed chapter object. Returns `undefined` if the chapter doesn't exist.

```typescript
const spine = epub.getSpine()
const fileInfo = epub.getFileInfo()

// Load the first chapter. 'html' is the processed HTML chapter string,
// 'css' is the chapter's CSS file, provided as an absolute path in Node.js,
// which can be directly read.
const { html, css } = epub.loadChapter(spine[0].id)
```

**Parameters:**

- `id: string` - The chapter `id` from spine

**Returns:**

- `Promise<EpubProcessedChapter | undefined>` - Processed chapter content

```typescript
interface EpubCssPart {
  id: string
  href: string
}

interface EpubProcessedChapter {
  css: EpubCssPart[]
  html: string
}
```

In an EPUB ebook file, each chapter is typically an XHTML (or HTML) file. Thus, the processed chapter object consists of two parts: one is the HTML content string under the `<body>` tag, and the other is the CSS. The CSS is parsed from the `<link>` tags in the chapter file and provided here in the form of a blob URL (or as an absolute filesystem path in a Node.js environment), represented by the `href` field in `EpubCssPart`, along with a corresponding `id` for the URL. The CSS blob URL can be directly referenced in a `<link>` tag or fetched via the Fetch API (using the absolute path in Node.js) to obtain the CSS text for further processing.

Internal chapter navigation in EPUBs is handled through `<a>` tags' `href` attributes. To distinguish internal links from external links and facilitate internal navigation logic, internal links are prefixed with `epub:`. These links can be resolved using the `resolveHref` function. The handling of such links is managed at the UI layer, while `epub-parser` only provides the corresponding chapter HTML and selector functionality.

### resolveHref(href: string): EpubResolvedHref | undefined

`resolveHref` parses internal links into a chapter ID and a CSS selector within the book's HTML.

If an external link (e.g., `https://www.example.com`) or an invalid internal link is provided, it returns `undefined`.

```typescript
const toc: EpubToc = epub.getToc()
// 'id' is the chapter ID, 'selector' is a DOM selector (e.g., `[id="ididid"]`)
const { id, selector } = epub.resolveHref(toc[0].href)
```

**Parameters：**

- `href: string`：The internal resource path.

**Returns:**

- `EpubResolvedHref | undefined`：The resolved internal link. Returns `undefined` if the path is invalid.

```typescript
interface EpubResolvedHref {
  id: string
  selector: string
}
```

### getToc(): EpubToc

The `toc` structure corresponds to the `navMap` section of the EPUB's `.ncx` file, which contains the book's navigation hierarchy.

```typescript
import { getToc } from '@lingo-reader/epub-parser'
import type { EpubToc } from '@lingo-reader/epub-parser'
/*
  type getToc = () => EpubToc
*/

const toc: EpubToc = epub.getToc()
```

**Parameters：**

- none

**Returns:**

- `EpubToc`：

```typescript
interface NavPoint {
  // Display text of the table of contents entry
  label: string

  // Resource path within the EPUB file (preprocessed format).
  // Can be resolved using resolveHref()
  href: string

  // Chapter identifier
  id: string

  // Reading order sequence
  playOrder: string

  // Nested sub-entries (optional)
  children?: NavPoint[]
}

/** EPUB table of contents structure (NCX navMap representation) */
type EpubToc = NavPoint[]
```

### destroy(): void

Cleans up generated resources (like blob URLs) created during file parsing
to prevent memory leaks. In Node.js environments, it also deletes corresponding temporary files.

### getFileInfo(): EpubFileInfo

```typescript
import type { EpubFileInfo } from '@lingo-reader/epub-parser'
/*
  type getFileInfo = () => EpubFileInfo
*/

const fileInfo: EpubFileInfo = epub.getFileInfo()
```

EpubFileInfo currently includes two attributes: `fileName` represents the file name, and `mimetype` indicates the file type of the EPUB file, which is read from the `/mimetype` file but is always fixed as `application/epub+zip`.

**Parameters：**

- none

**Returns:**

- `EpubFileInfo`：

```typescript
interface EpubFileInfo {
  fileName: string
  mimetype: string
}
```

### getMetadata(): EpubMetadata

The metadata recorded in the book.

```typescript
import type { EpubMetadata } from '@lingo-reader/epub-parser'
/*
  type getMetadata = () => EpubFileInfo
*/

const metadata: EpubMetadata = epub.getMetadata()
```

**Parameters：**

- none

**Returns:**

- `EpubMetadata`：

```typescript
interface EpubMetadata {
  // Title of the book
  title: string
  // Language of the book
  language: string
  // Description of the book
  description?: string
  // Publisher of the EPUB file
  publisher?: string
  // General type/genre of the book, such as novel, biography, etc.
  type?: string
  // MIME type of the EPUB file
  format?: string
  // Original source of the book content
  source?: string
  // Related external resources
  relation?: string
  // Coverage of the publication content
  coverage?: string
  // Copyright statement
  rights?: string
  // Includes creation time, publication date, update time, etc. of the book
  // Specific fields depend on opf:event, such as modification
  date?: Record<string, string>

  identifier: Identifier
  packageIdentifier: Identifier
  creator?: Contributor[]
  contributor?: Contributor[]
  subject?: Subject[]

  metas?: Record<string, string>
  links?: Link[]
}
```

#### identifier: Identifier

`id` represents the unique identifier of the resource. The `scheme` specifies the system or authority used to generate or assign the identifier, such as ISBN or DOI. `identifierType` indicates the type of identifier used by `id`, which is similar to `scheme`.

```typescript
interface Identifier {
  id: string
  scheme?: string
  identifierType?: string
}
```

#### packageIdentifier: Identifier

It is essentially also an `Identifier`. Typically, within the `<package>` tag, it is referenced using the `unique-identifier` attribute, whose value corresponds to the `id` of the relevant `<identifier>` element.

```xml
<package unique-identifier="id">

<dc:identifier id="id" opf:scheme="URI">uuid:19c0c5cb-002b-476f-baa7-fcf510414f95</dc:identifier>

</package>
```

#### creator?: Contributor[]

Describes the various contributors.

```typescript
interface Contributor {
  // Name of the contributor
  contributor: string
  // Sort-friendly version of the name
  fileAs?: string
  // Role of the contributor
  role?: string

  // The encoding scheme used for role or alternateScript,
  // can also represent a language, such as English or Chinese
  scheme?: string
  // Alternative script or writing system for the contributor's name
  alternateScript?: string
}
```

#### subject?: Subject[]

The subject or theme of the book.

```typescript
interface Subject {
  // Subject, such as fiction, essay, etc.
  subject: string
  // The authority or organization providing the code or identifier
  authority?: string
  // Associated subject code or term
  term?: string
}
```

#### links?: Link[]

Provides additional related resources or external links.

```typescript
interface Link {
  // URL or path to the resource
  href: string
  // Language of the resource
  hreflang?: string
  // id
  id?: string
  // MIME type of the resource (e.g., image/jpeg, application/xml)
  mediaType?: string
  // Additional properties
  properties?: string
  // Purpose or function of the link
  rel: string
}
```

### getGuide(): EpubGuide

The preview chapters of the book, which can also be replaced by the first few chapters from the spine.

```typescript
import { getGuide } from '@lingo-reader/epub-parser'
import type { EpubGuide } from '@lingo-reader/epub-parser'
/*
  type getGuide = () => EpubGuide
*/

const guide: EpubGuide = epub.getGuide()
```

**Parameters：**

- none

**Returns:**

- `EpubGuide`：

```typescript
interface GuideReference {
  title: string
  // The role of the resource, such as toc, loi, cover-image, etc.
  type: string
  // The path to the resource within the EPUB file
  href: string
}

type EpubGuide = GuideReference[]
```

### getCollection(): EpubCollection

The content under the `<collection>` tag in the `.opf` file, used to specify whether an EPUB file belongs to a specific collection, such as a series, category, or a particular group of publications.

```typescript
import { getCollection } from '@lingo-reader/epub-parser'
import type { EpubCollection } from '@lingo-reader/epub-parser'
/*
  type getCollection = () => EpubCollection
*/

const collection: EpubCollection = epub.getCollection()
```

**Parameters：**

- none

**Returns:**

- `EpubCollection`：

```typescript
interface CollectionItem {
  // The role played within the Collection
  role: string
  // Links to related resources
  links: string[]
}

type EpubCollection = CollectionItem[]
```

### getPageList(): PageList

Refer to [https://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm#Section2.4.1.2](https://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm#Section2.4.1.2), where the `correspondId` refers to the resource's ID, and the rest correspond to the specifications.

```typescript
import { getPageList } from '@lingo-reader/epub-parser'
import type { PageList } from '@lingo-reader/epub-parser'
/*
  type getPageList = () => PageList
*/

const pageList: PageList = epub.getPageList()
```

**Parameters：**

- none

**Returns:**

- `PageList`:

```typescript
interface PageTarget {
  label: string
  // Page number
  value: string
  href: string
  playOrder: string
  type: string
  correspondId: string
}
interface PageList {
  label: string
  pageTargets: PageTarget[]
}
```

### getNavList(): NavList

Refer to [https://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm#Section2.4.1.2](https://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm#Section2.4.1.2), where the `correspondId` refers to the resource's ID, `label` corresponds to the content of `navLabel.text`, and `href` is the path to the resource within the EPUB file.

```typescript
import { getNavList } from '@lingo-reader/epub-parser'
import type { NavList } from '@lingo-reader/epub-parser'
/*
  type getNavList = () => NavList
*/

const navList: NavList = epub.getNavList()
```

**Parameters：**

- none

**Returns:**

- `NavList:`

```typescript
interface NavTarget {
  label: string
  href: string
  correspondId: string
}
interface NavList {
  label: string
  navTargets: NavTarget[]
}
```
