# Accent Pro

## Overview

Accent Pro is a mobile-first speech accent training application built with Expo (React Native) and an Express backend. Users record themselves speaking, and the app uses OpenAI's speech-to-text and GPT models to analyze pronunciation accuracy, score individual words, and provide improvement tips. The app has two main features: a free-form speech recording/analysis tab ("Talk") and a targeted practice tab for words the user has previously struggled with. The backend handles audio processing, AI-powered speech analysis, and text-to-speech for pronunciation demonstrations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (Expo / React Native)

- **Framework**: Expo SDK 54 with expo-router for file-based routing
- **Navigation**: Tab-based layout with two tabs — "Talk" (index) for recording/analysis and "Practice" for drilling weak words
- **State Management**: TanStack React Query for server state; local component state with React hooks
- **Auth**: JWT-based email/password auth. Token stored in `expo-secure-store` (native) or `localStorage` (web). `AuthProvider` in `contexts/AuthContext.tsx` provides `user`, `token`, `login`, `register`, `logout` globally. `AuthModal` slides up during accent analysis for just-in-time account creation.
- **Local Storage**: AsyncStorage for persisting mispronounced words and session history locally. Cloud sync via `/api/user/words` and `/api/user/sessions` when logged in.
- **Fonts**: Inter font family loaded via `@expo-google-fonts/inter`
- **Animations**: react-native-reanimated for recording animations and UI transitions
- **Audio Recording**: expo-av for microphone access and recording
- **UI Theme**: Dark mode only (`userInterfaceStyle: "dark"`), custom color scheme defined in `constants/colors.ts`
- **Platform Support**: iOS, Android, and Web. Uses platform-specific adaptations (e.g., BlurView on iOS, standard views on web)

### Backend (Express + Node.js)

- **Server**: Express 5 running on the same Replit instance, serves API routes and static assets
- **API Design**: RESTful JSON endpoints under `/api/`
- **Key endpoint**: `POST /api/analyze-speech` — accepts base64-encoded audio, transcribes it via OpenAI Whisper, then uses GPT to score each word's pronunciation accuracy
- **Audio Processing**: Server-side audio format detection and conversion using ffmpeg (supports WAV, MP3, WebM, MP4, OGG). Located in `server/replit_integrations/audio/client.ts`
- **AI Integration**: OpenAI SDK configured with Replit AI Integrations environment variables (`AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`)
- **CORS**: Dynamic CORS configuration supporting Replit dev/deployment domains and localhost for Expo web development

### Data Storage

- **Database**: PostgreSQL via Drizzle ORM. Schema defined in `shared/schema.ts` and `shared/models/chat.ts`
- **Current Schema Tables**:
  - `users` — basic user table (id, username, password)
  - `conversations` — chat conversation records
  - `messages` — individual messages within conversations
- **In-Memory Storage**: `server/storage.ts` has a `MemStorage` class for users (not currently connected to Postgres)
- **Client-side Storage**: AsyncStorage stores pronunciation data locally (mispronounced words, practice sessions, scores)
- **Database Config**: `drizzle.config.ts` reads `DATABASE_URL` env var; migrations output to `./migrations`
- **Push Schema**: Use `npm run db:push` (drizzle-kit push) to sync schema to database

### Replit Integration Modules

Located in `server/replit_integrations/`, these are modular capabilities:

- **audio/**: Speech-to-text, text-to-speech, voice chat streaming, audio format detection/conversion
- **chat/**: Conversation CRUD with database-backed storage, OpenAI chat completions
- **image/**: Image generation and editing via `gpt-image-1`
- **batch/**: Generic batch processing with rate limiting (`p-limit`) and retries (`p-retry`)

### Build & Development

- **Dev Mode**: Two processes — `expo:dev` for the Expo frontend and `server:dev` for the Express backend
- **Production Build**: `expo:static:build` creates a static web export, `server:build` bundles the server with esbuild, `server:prod` runs the production server
- **TypeScript**: Strict mode enabled; path aliases `@/*` and `@shared/*` configured
- **Patch Package**: `postinstall` runs `patch-package` for any dependency patches

## External Dependencies

### AI Services
- **Azure Speech Services**: Pronunciation Assessment API for real acoustic-level phoneme scoring. Uses REST API (`POST https://{region}.stt.speech.microsoft.com/...`) with WAV PCM 16kHz audio. Located in `server/azure-speech.ts`. **Note: Currently returning 401 — credentials need renewal.**
- **OpenAI API** (via Replit AI Integrations): Powers speech-to-text (Whisper), text-to-speech, chat completions (GPT for enrichment tips/phonetics), and image generation
- **Scoring Fallback Chain**: Azure (best, acoustic phoneme level) → `gpt-4o-audio-preview` (sends real WAV audio to GPT, hears actual pronunciation) → `gpt-4o-mini` text-only (last resort). Located in `server/routes.ts` (`audioBasedAssessment`, `gptTextFallbackScoring`).
- **Environment Variables**: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`
- **Assessment Flow**: Audio → Whisper transcription → Azure Pronunciation Assessment (acoustic scoring using article text as reference, not transcript) → OpenAI tips enrichment for low-scoring words
- **Reference Text Strategy**: The article text displayed on screen is sent as the Azure reference instead of the Whisper transcript. This catches words mispronounced so badly they get transcribed differently, skipped words, and subtle issues Whisper glosses over.

### Database
- **PostgreSQL**: Connected via `DATABASE_URL` environment variable, accessed through Drizzle ORM

### System Dependencies
- **ffmpeg**: Required on the server for audio format conversion (converting various audio formats to WAV for processing)

### Key NPM Packages
- `expo` ~54.0.27, `expo-router` ~6.0.17, `expo-av` (audio recording)
- `express` ^5.0.1 (backend server)
- `openai` ^6.21.0 (AI API client)
- `drizzle-orm` ^0.39.3, `drizzle-zod` ^0.7.1 (database ORM + validation)
- `pg` ^8.16.3 (PostgreSQL driver)
- `@tanstack/react-query` ^5.83.0 (data fetching)
- `react-native-reanimated`, `react-native-gesture-handler` (animations/gestures)
- `p-limit`, `p-retry` (batch processing utilities)