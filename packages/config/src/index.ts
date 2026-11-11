export const APP_CONFIG = {
  name: 'JotBox',
  description: 'Notes from meetings, seminars, and lectures — without the typing.',
  version: '0.4.0',
  maxRecordingDuration: 4 * 60 * 60,
  maxFileSize: 80 * 1024 * 1024,
  supportedAudioTypes: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/m4a'],
  supportedAudioExtensions: ['.webm', '.mp4', '.m4a', '.mp3', '.wav', '.ogg'],
} as const;

export const SESSION_KINDS = ['meeting', 'seminar', 'lecture', 'voice'] as const;

export type SessionKind = (typeof SESSION_KINDS)[number];

export const AI_CONFIG = {
  notesModel: 'grok-4.7',
  sttModel: 'grok-voice-transcribe-2.0',
  temperature: 0.2,
  maxTokens: 2500,
} as const;

export const ROUTES = {
  home: '/',
  listen: '/listen',
  library: '/library',
  flow: '/flow',
  settings: '/settings',
  session: (id: string) => `/session/${id}`,
} as const;
