epubToMd(epubBlob)
  const data = parseEpub(epubBlob)
  const { mdast, resources } = convertContentAndExtractResources(data)
  return { mdast, resources }

write a helper function that will read epub by path, transform it to md and stores resulting md and resources in output/epubName/md/

call it in index.ts for test-book.epub
