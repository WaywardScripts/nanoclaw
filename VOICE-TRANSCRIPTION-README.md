# Voice Message Transcription

This implementation adds automatic voice message transcription for Telegram using AI-powered speech recognition (OpenAI Whisper or Groq).

## Features

- Automatic transcription of Telegram voice messages
- Support for multiple providers (OpenAI, Groq)
- Configurable fallback messages
- Integrated with existing message storage
- Easy enable/disable via configuration

## Architecture

```
Telegram Voice Message
    ↓
Grammy Bot Handler (src/channels/telegram.ts)
    ↓
Download Audio via Telegram Bot API
    ↓
Transcription Service (src/transcription.ts)
    ↓
OpenAI/Groq Whisper API
    ↓
Store as Text in Database
    ↓
Agent Processes Message
```

## Files

- **`src/transcription.ts`**: Core transcription module
  - Loads configuration
  - Handles OpenAI and Groq API calls
  - Error handling and fallback

- **`src/channels/telegram.ts`**: Updated voice handler
  - Downloads voice messages from Telegram
  - Calls transcription service
  - Stores transcribed content

- **`.transcription.config.json`**: Configuration file
  - Provider selection (openai/groq)
  - API keys
  - Enable/disable flag
  - Fallback message

- **`test-transcription.ts`**: Testing utility
  - Test transcription with local audio files
  - Verify API key configuration
  - Measure transcription speed

## Setup

### Quick Start

1. **Install dependencies:**
   ```bash
   npm install openai --legacy-peer-deps
   ```

2. **Create configuration:**
   ```bash
   cp .transcription.config.json.example .transcription.config.json
   ```

3. **Add API key:**
   Edit `.transcription.config.json` and add your API key

4. **Build and restart:**
   ```bash
   npm run build
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw
   ```

For detailed instructions, see `SETUP-VOICE-TRANSCRIPTION.md` in the main group folder.

## Configuration

### Example Configuration (Groq - Free)

```json
{
  "provider": "groq",
  "groq": {
    "apiKey": "gsk_your_api_key_here",
    "model": "whisper-large-v3"
  },
  "enabled": true,
  "fallbackMessage": "[Voice Message - transcription unavailable]"
}
```

### Example Configuration (OpenAI)

```json
{
  "provider": "openai",
  "openai": {
    "apiKey": "sk-proj-your_api_key_here",
    "model": "whisper-1"
  },
  "enabled": true,
  "fallbackMessage": "[Voice Message - transcription unavailable]"
}
```

## Testing

### Test with Sample Audio

```bash
tsx test-transcription.ts path/to/audio.ogg
```

### Test with Telegram

1. Send a voice message in a registered Telegram chat
2. Check logs:
   ```bash
   tail -f logs/nanoclaw.log | grep -i "voice\|transcri"
   ```

## API Providers

### Groq (Recommended for Personal Use)

- **Cost**: FREE tier with generous limits
- **Speed**: 10-20x faster than OpenAI (0.5-2 seconds)
- **Model**: whisper-large-v3
- **Sign up**: https://console.groq.com/keys

### OpenAI

- **Cost**: ~$0.006 per minute of audio
- **Speed**: Standard (5-10 seconds for 30s audio)
- **Model**: whisper-1
- **Sign up**: https://platform.openai.com/api-keys

## Usage

Once configured, voice messages are automatically:
1. Downloaded from Telegram
2. Sent to transcription API
3. Transcribed to text
4. Stored in database as: `[Voice: transcribed text here]`
5. Processed by the agent like regular text messages

## Message Format

Voice messages appear in conversation history as:

```
[Voice: This is what the user said in the voice message]
```

This format helps the agent understand the message was originally audio while providing the full transcribed content.

## Troubleshooting

### Transcription Not Working

1. **Check configuration exists:**
   ```bash
   ls -la .transcription.config.json
   ```

2. **Verify enabled flag:**
   ```bash
   cat .transcription.config.json | grep enabled
   ```

3. **Check API key:**
   ```bash
   cat .transcription.config.json | grep apiKey
   ```

4. **Test API connection:**
   ```bash
   # Groq
   curl https://api.groq.com/openai/v1/models \
     -H "Authorization: Bearer YOUR_KEY"

   # OpenAI
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer YOUR_KEY"
   ```

### Module Not Found Errors

Reinstall dependencies:
```bash
npm install openai --legacy-peer-deps
npm run build
```

### Voice Messages Show "[Voice message]" Without Transcription

- Transcription is disabled or not configured
- API key is missing or invalid
- Network connectivity issues
- Check logs for specific error messages

## Cost Estimates

### Groq
- **Free tier**: Very generous, perfect for personal use
- **Paid tier**: Available for high-volume use

### OpenAI
- **Per minute**: $0.006
- **30-second voice note**: ~$0.003
- **100 messages/month** (30s avg): ~$3
- **1 hour of audio**: ~$0.36

## Security & Privacy

### API Keys
- Stored in `.transcription.config.json` (gitignored)
- Never committed to version control
- Keep secure and don't share

### Audio Data
- Audio is sent to third-party API for processing
- Not stored locally after transcription
- Check provider's data retention policy:
  - OpenAI: Does not retain audio after processing
  - Groq: Check their privacy policy

### Transcripts
- Stored in local SQLite database
- Part of conversation history
- Treated like regular text messages

## Limitations

- Maximum file size: 25MB
- Supported formats: .ogg, .mp3, .wav, .m4a, .webm, and more
- Requires internet connection
- Requires active API key
- Subject to provider rate limits

## Disabling Transcription

To temporarily disable without removing code:

```json
{
  "enabled": false
}
```

Then rebuild and restart:
```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Extending

### Adding New Providers

1. Add provider config to `.transcription.config.json`
2. Implement provider function in `src/transcription.ts`:
   ```typescript
   async function transcribeWithNewProvider(
     audioBuffer: Buffer,
     config: TranscriptionConfig
   ): Promise<string | null> {
     // Implementation here
   }
   ```
3. Add case to switch statement in `transcribeAudio()`

### Customizing Fallback Messages

Edit `.transcription.config.json`:
```json
{
  "fallbackMessage": "[Custom message when transcription fails]"
}
```

## Support

For issues or questions:
1. Check logs: `tail -100 logs/nanoclaw.log`
2. Verify configuration: `cat .transcription.config.json`
3. Test API connection (see troubleshooting section)
4. Review setup guide: `SETUP-VOICE-TRANSCRIPTION.md`

## Credits

Built for NanoClaw using:
- OpenAI Whisper API / Groq Whisper API
- Grammy (Telegram Bot Framework)
- OpenAI Node.js SDK

## License

Same as NanoClaw project.
