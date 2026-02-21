import { addActionHandler } from "../../global";
import type { AiAgentSettings } from "./types";

// Let's extend ActionPayloads using declaration merging for typescript
declare module "../../global/types/actions" {
  interface ActionPayloads {
    updateAiAgentSettings: AiAgentSettings;
    toggleAiAgentRightColumn: boolean;
    toggleAiAgentForChat: { chatId: string; isEnabled: boolean };
  }
}

addActionHandler("updateAiAgentSettings", (global, actions, payload) => {
  return {
    ...global,
    aiAgent: {
      ...global.aiAgent!,
      settings: payload,
    },
  };
});

addActionHandler("toggleAiAgentRightColumn", (global, actions, payload) => {
  return {
    ...global,
    aiAgent: {
      ...global.aiAgent!,
      isRightColumnOpen: payload,
    },
  };
});

addActionHandler("toggleAiAgentForChat", (global, actions, payload) => {
  const { chatId, isEnabled } = payload;
  const currentChats = global.aiAgent!.enabledChats;
  const newChats = isEnabled
    ? [...new Set([...currentChats, chatId])]
    : currentChats.filter((id) => id !== chatId);

  return {
    ...global,
    aiAgent: {
      ...global.aiAgent!,
      enabledChats: newChats,
      isRightColumnOpen: isEnabled ? true : global.aiAgent!.isRightColumnOpen,
    },
  };
});
