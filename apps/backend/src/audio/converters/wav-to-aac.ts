import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function wavToAac(inputPath: string, outputPath: string): Promise<void> {
  const command = `ffmpeg -i "${inputPath}" -c:a aac -b:a 96k "${outputPath}" -y`;

  try {
    const { stderr } = await execAsync(command);
    console.log('Conversion completed successfully');
    if (stderr) {
      console.log('FFmpeg output:', stderr);
    }
  } catch (error) {
    console.error('Error during conversion:', error);
    throw error;
  }
}
