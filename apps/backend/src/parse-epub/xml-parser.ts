import { XMLParser } from 'fast-xml-parser'

export function parseXml(xmlString: string): any {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    trimValues: true,
    removeNSPrefix: true,
    isArray: (name: string) => {
      const arrayTags = ['item', 'reference', 'itemref', 'navPoint', 'dc:creator', 'dc:subject']
      return arrayTags.includes(name)
    }
  })

  return parser.parse(xmlString)
}
