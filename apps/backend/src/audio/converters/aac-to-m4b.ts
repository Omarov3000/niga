import { spawn } from 'node:child_process';
import { readdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';

interface Metadata {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  date?: string;
  publisher?: string;
  [key: string]: string | undefined;
}

export async function aacToM4b(
  inputFolder: string,
  outputFile: string,
  metadata: Metadata = {},
  coverImagePath?: string
): Promise<string> {
  // Get sorted .aac files
  const files = await readdir(inputFolder);
  const aacFiles = files
    .filter(file => extname(file).toLowerCase() === '.aac')
    .sort()
    .map(file => resolve(inputFolder, file));

  if (aacFiles.length === 0) {
    throw new Error('No .aac files found');
  }

  // Create temporary file list
  const listFile = join(inputFolder, 'filelist.txt');
  const fileList = aacFiles.map(file => `file '${file}'`).join('\n');
  await writeFile(listFile, fileList);

  try {
    // Build FFmpeg arguments
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile
    ];

    // Add cover image if provided
    if (coverImagePath) {
      args.push('-i', coverImagePath);
    }

    args.push(
      '-c:a', 'aac',
      '-b:a', '64k'
    );

    // Add cover image mapping if provided
    if (coverImagePath) {
      args.push(
        '-c:v', 'mjpeg', // Use MJPEG codec for cover art
        '-map', '0:a', // Map audio from first input
        '-map', '1:v', // Map video (cover art) from second input
        '-disposition:v:0', 'attached_pic' // Set as attached picture/cover art
      );
    }

    // Add metadata
    args.push(
      ...Object.entries(metadata).flatMap(([key, value]) => {
        if (!value) return [];

        // Map common metadata fields to FFmpeg metadata tags
        const metadataMap: { [key: string]: string } = {
          'title': 'title',
          'artist': 'artist',
          'album': 'album',
          'year': 'date',
          'date': 'date',
          'genre': 'genre',
          'publisher': 'publisher'
        };

        const ffmpegKey = metadataMap[key] || key;
        return ['-metadata', `${ffmpegKey}=${value}`];
      }),
      '-f', 'mp4',
      '-movflags', '+faststart',
      '-y',
      outputFile
    );

    console.log(`Converting ${aacFiles.length} files...`);

    // Run FFmpeg
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args);

      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('time=')) {
          process.stdout.write(`\r${output.match(/time=[\d:.]+/)?.[0] || ''}`);
        }
      });

      ffmpeg.on('close', (code) => {
        code === 0 ? resolve() : reject(new Error(`FFmpeg failed: ${code}`));
      });

      ffmpeg.on('error', reject);
    });

    console.log('\nConversion completed!');
    return outputFile;

  } finally {
    // Cleanup
    await unlink(listFile).catch(() => {});
  }
}
