import { ExportedHandler } from '@cloudflare/workers-types'

export default {
  // @ts-ignore
  fetch() {
    return new Response('')
  },
} satisfies ExportedHandler
