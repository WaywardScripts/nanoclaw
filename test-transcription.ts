#!/usr/bin/env tsx
import { transcribeAudio } from './src/transcription.js';
import fs from 'fs';

async function testTranscription() {
  // Check if a test audio file was provided
  const audioPath = process.argv[2];

  if (!audioPath) {
    console.error('Usage: tsx test-transcription.ts <path-to-audio-file>');
    console.error('\nExample:');
    console.error('  tsx test-transcription.ts ./test-audio.ogg');
    process.exit(1);
  }

  if (!fs.existsSync(audioPath)) {
    console.error(`File not found: ${audioPath}`);
    process.exit(1);
  }

  console.log('Reading audio file...');
  const audioBuffer = fs.readFileSync(audioPath);
  console.log(`File size: ${audioBuffer.length} bytes`);

  console.log('\nTranscribing...');
  const start = Date.now();
  const transcript = await transcribeAudio(audioBuffer, 'telegram');
  const duration = Date.now() - start;

  console.log(`\n✓ Transcription completed in ${duration}ms\n`);
  console.log('Transcript:');
  console.log('─'.repeat(60));
  console.log(transcript);
  console.log('─'.repeat(60));
}

testTranscription().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
