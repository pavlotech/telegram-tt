import { GoogleGenAI } from "@google/genai";
import type { AiAgentModel, ChatHistoryMessage } from "./types";
import { fetch as fetchMedia } from "../../util/mediaLoader";
import { ApiMediaFormat } from "../../api/types";

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (result.includes(",")) {
        resolve(result.split(",")[1]);
      } else {
        resolve(result);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export class AiApiService {
  private client: GoogleGenAI | null = null;
  private currentApiKey: string = "";

  private getClient(apiKey: string): GoogleGenAI {
    if (!apiKey) {
      throw new Error("API ключ не установлен в настройках AI Ассистента.");
    }
    if (this.currentApiKey !== apiKey || !this.client) {
      this.currentApiKey = apiKey;
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  /**
   * Generates a one-shot response for profile analysis.
   */
  async analyzeProfile(
    apiKey: string,
    model: AiAgentModel,
    profileDataStr: string,
  ): Promise<string> {
    const ai = this.getClient(apiKey);
    const prompt = `Выступай в роли эксперта-психолога и специалиста по продажам. Проанализируй данные профиля пользователя (имя, био, публичные данные) и составь краткий портрет собеседника: его возможные интересы, стиль общения и как к нему лучше найти подход.\n\nДанные профиля:\n${profileDataStr}`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    const responseText =
      typeof (response as any).text === "function"
        ? (response as any).text()
        : (response as any).text;

    if (typeof responseText === "object") {
      return JSON.stringify(responseText);
    }

    return String(responseText ?? "");
  }

  /**
   * Streams chat strategy response chunk by chunk.
   */
  async *streamChatStrategy(
    apiKey: string,
    model: AiAgentModel,
    systemInstruction: string,
    chatHistory: ReadonlyArray<ChatHistoryMessage>,
  ): AsyncGenerator<string, void, unknown> {
    const ai = this.getClient(apiKey);

    const parts: any[] = [];
    parts.push({
      text: `Контекст продаж и твоя основная инструкция:\n${systemInstruction}\n\nТвоя задача: проанализировать этот чат, выделить основные потребности или возражения клиента и предложить варианты оптимального следующего сообщения. Если увидишь медиа (голосовое, видео) - проанализируй его содержание.`,
    });

    parts.push({ text: "\n\nИстория чата:\n" });

    for (const msg of chatHistory) {
      parts.push({ text: `${msg.role}: ${msg.text}` });
      if (msg.mediaHash && msg.mimeType) {
        try {
          const preparedMedia = await fetchMedia(
            msg.mediaHash,
            ApiMediaFormat.BlobUrl,
          );
          if (
            typeof preparedMedia === "string" &&
            preparedMedia.startsWith("blob:")
          ) {
            const response = await fetch(preparedMedia);
            const blob = await response.blob();
            const base64Data = await blobToBase64(blob);
            parts.push({
              inlineData: {
                mimeType: msg.mimeType,
                data: base64Data,
              },
            });
          }
        } catch (err) {
          console.warn("Failed to load media for AI analysis:", err);
          parts.push({ text: `[Ошибка загрузки медиа: ${msg.mediaHash}]` });
        }
      }
      parts.push({ text: "\n" });
    }

    const responseStream = await ai.models.generateContentStream({
      model,
      contents: parts,
    });

    for await (const chunk of responseStream) {
      // safely extract text since Google SDKs vary and can return objects / getters
      const chunkText =
        typeof (chunk as any).text === "function"
          ? (chunk as any).text()
          : chunk.text;
      const extracted =
        chunkText || (chunk as any)?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (extracted) {
        if (typeof extracted === "object") {
          console.warn("AI returned an object instead of string:", extracted);
          yield JSON.stringify(extracted);
        } else {
          yield String(extracted);
        }
      }
    }
  }
}

export const aiApiService = new AiApiService();
