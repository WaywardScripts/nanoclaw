import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TranscriptionConfig {
  provider: 'openai' | 'groq';
  openai?: {
    apiKey: string;
    model: string;
  };
  groq?: {
    apiKey: string;
    model: string;
  };
  enabled: boolean;
  fallbackMessage: string;
}

function loadConfig(): TranscriptionConfig {
  const configPath = path.join(__dirname, '../.transcription.config.json');
  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configData);
  } catch (err) {
    logger.warn('Transcription config not found, using defaults');
    return {
      provider: 'openai',
      enabled: false,
      fallbackMessage: '[Voice Message - transcription unavailable]',
    };
  }
}

async function transcribeWithOpenAI(
  audioBuffer: Buffer,
  config: TranscriptionConfig,
): Promise<string | null> {
  if (!config.openai?.apiKey || config.openai.apiKey === '') {
    logger.warn('OpenAI API key not configured');
    return null;
  }

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;

    const openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });

    const file = await toFile(audioBuffer, 'voice.ogg', {
      type: 'audio/ogg',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: config.openai.model || 'whisper-1',
      response_format: 'text',
    });

    return transcription as unknown as string;
  } catch (err) {
    logger.error({ err }, 'OpenAI transcription failed');
    return null;
  }
}

async function transcribeWithGroq(
  audioBuffer: Buffer,
  config: TranscriptionConfig,
): Promise<string | null> {
  if (!config.groq?.apiKey || config.groq.apiKey === '') {
    logger.warn('Groq API key not configured');
    return null;
  }

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;

    // Groq uses OpenAI-compatible API
    const groq = new OpenAI({
      apiKey: config.groq.apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });

    const file = await toFile(audioBuffer, 'voice.ogg', {
      type: 'audio/ogg',
    });

    const transcription = await groq.audio.transcriptions.create({
      file: file,
      model: config.groq.model || 'whisper-large-v3',
      response_format: 'text',
    });

    return transcription as unknown as string;
  } catch (err) {
    logger.error({ err }, 'Groq transcription failed');
    return null;
  }
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  source: 'telegram' | 'whatsapp' = 'telegram',
): Promise<string | null> {
  const config = loadConfig();

  if (!config.enabled) {
    logger.debug('Transcription disabled in config');
    return config.fallbackMessage;
  }

  try {
    logger.info({ source, bufferSize: audioBuffer.length }, 'Transcribing audio');

    let transcript: string | null = null;

    switch (config.provider) {
      case 'openai':
        transcript = await transcribeWithOpenAI(audioBuffer, config);
        break;
      case 'groq':
        transcript = await transcribeWithGroq(audioBuffer, config);
        break;
      default:
        logger.error(
          { provider: config.provider },
          'Unknown transcription provider',
        );
        return config.fallbackMessage;
    }

    if (!transcript) {
      return config.fallbackMessage;
    }

    logger.info({ source, length: transcript.length }, 'Transcription successful');
    return transcript.trim();
  } catch (err) {
    logger.error({ err }, 'Transcription error');
    return config.fallbackMessage;
  }
}
