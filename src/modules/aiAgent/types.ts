export type AiAgentModel =
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite"
  | "gemini-2.5-pro"
  | "gemini-2.5-pro-lite"
  | "gemini-2.0-flash"
  | "gemini-2.0-flash-lite"
  | "gemini-3-flash-preview";

export interface AiAgentSettings {
  apiKey: string;
  model: AiAgentModel;
  salesContextPrompt: string;
  enabledModels?: AiAgentModel[];
  maxVideos?: number;
  maxVoices?: number;
  promptMain?: string;
  promptAutoAnalysis?: string;
  promptMiniAnalysisText?: string;
  promptMiniAnalysisPhoto?: string;
}

export interface ChatHistoryMessage {
  role: "Me" | "User";
  text: string;
  mediaHash?: string;
  mediaFormat?: string | "voice" | "video" | "photo";
  mimeType?: string;
  isPhoto?: boolean;
}

export interface AiAgentState {
  settings: AiAgentSettings;
  enabledChats: string[];
  isRightColumnOpen: boolean;
}
