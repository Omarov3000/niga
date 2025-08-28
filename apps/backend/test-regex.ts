// Test the header image removal regex

const testMarkdown = `# SINGLE ADULTS Significant and Growing

---

[![](/Users/ali/Documents/niga/output/test-conversion/resources/images/OEBPS_image133.jpg)](epub:OEBPS/part0004.xhtml#TY99osKST9K5GWNycWwkAw2677)

![](/Users/ali/Documents/niga/output/test-conversion/resources/images/OEBPS_image60.jpg)

I f you're reading this book, chances are you're either single...`;

function removeHeaderImages(markdown: string): string {
  let cleanedMarkdown = markdown;
  
  const headerPattern = /^(# [^\n]+\n\n---\n\n)/;
  const headerMatch = cleanedMarkdown.match(headerPattern);
  
  console.log('Header match:', headerMatch ? 'Found' : 'Not found');
  if (headerMatch) {
    console.log('Header text:', JSON.stringify(headerMatch[1]));
  }
  
  if (headerMatch) {
    const header = headerMatch[1];
    const remaining = cleanedMarkdown.substring(header.length);
    
    console.log('Remaining text start:', JSON.stringify(remaining.substring(0, 100)));
    
    // Remove all consecutive images at the beginning of remaining content
    const imagePattern = /^(?:\[\!\[[^\]]*\]\([^)]+\)\]\([^)]+\)\n\n|\!\[[^\]]*\]\([^)]+\)\n\n)+/;
    const imageMatch = remaining.match(imagePattern);
    
    console.log('Image match:', imageMatch ? 'Found' : 'Not found');
    if (imageMatch) {
      console.log('Matched images:', JSON.stringify(imageMatch[0]));
    }
    
    const cleanedRemaining = remaining.replace(imagePattern, '');
    console.log('Cleaned remaining start:', JSON.stringify(cleanedRemaining.substring(0, 100)));
    
    cleanedMarkdown = header + cleanedRemaining;
  }
  
  return cleanedMarkdown;
}

console.log('=== TESTING HEADER IMAGE REMOVAL ===');
const result = removeHeaderImages(testMarkdown);
console.log('\n=== RESULT ===');
console.log(result.substring(0, 200));