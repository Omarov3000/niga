import { writeFile } from "fs/promises";





export async function saveFileToFS(file: File, outputPath: string = 'output.wav') {
  const arrayBuffer = await file.arrayBuffer();
  await writeFile(outputPath, new Uint8Array(arrayBuffer));
}
