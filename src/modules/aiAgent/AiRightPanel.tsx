import type { FC } from "../../lib/teact/teact";
import React, {
  memo,
  useState,
  useEffect,
  useRef,
} from "../../lib/teact/teact";
import { getActions, withGlobal } from "../../global";
import {
  selectCurrentMessageList,
  selectChatMessages,
  selectUser,
  selectUserFullInfo,
} from "../../global/selectors";
import type { GlobalState } from "../../global/types";
import type { AiAgentModel } from "./types";
import { aiApiService } from "./aiApiService";

import Button from "../../components/ui/Button";
import MenuItem from "../../components/ui/MenuItem";
import Menu from "../../components/ui/Menu";
import MessageAppendix from "../../components/middle/message/MessageAppendix";
import renderText from "../../components/common/helpers/renderText";
import useLastCallback from "../../hooks/useLastCallback";
import useAppLayout from "../../hooks/useAppLayout";

import "./AiRightPanel.scss";

import { EDITABLE_INPUT_CSS_SELECTOR } from "../../config";

// Lightweight Markdown parser for bot messages, compatible with Teact
const parseAiMarkdown = (
  rawText: string,
  onCopy?: (text: string) => void,
  onInsert?: (text: string) => void,
) => {
  let text = rawText.trim();
  if (text.startsWith("```markdown") && text.endsWith("```")) {
    text = text.slice(11, -3).trim();
  }

  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, index) => {
    if (part.startsWith("```")) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const code = match ? match[2] : part.replace(/```/g, "");
      return (
        <div key={index} className="AiMarkdown__code-block">
          <pre className="AiMarkdown__code" dir="auto">
            <code>{code}</code>
          </pre>
          <div className="AiMarkdown__code-actions">
            <Button
              size="tiny"
              color="translucent"
              round
              className="AiMarkdown__code-btn"
              iconName="copy"
              ariaLabel="Копировать код"
              onClick={() => onCopy?.(code)}
            />
            <Button
              size="tiny"
              color="translucent"
              round
              className="AiMarkdown__code-btn"
              iconName="next"
              ariaLabel="Вставить код в чат"
              onClick={() => onInsert?.(code)}
            />
          </div>
        </div>
      );
    }

    const lines = part.split("\n");
    let inList = false;
    let listItems: React.ReactNode[] = [];
    const blocks: React.ReactNode[] = [];

    const flushList = () => {
      if (listItems.length > 0) {
        blocks.push(
          <ul key={`ul-${index}-${blocks.length}`} className="AiMarkdown__list">
            {listItems}
          </ul>,
        );
        listItems = [];
      }
      inList = false;
    };

    lines.forEach((line, lineIndex) => {
      const isList = line.trim().match(/^[-*]\s/);
      const isNumList = line.trim().match(/^\d+\.\s/);

      if (isList || isNumList) {
        if (!inList) flushList();
        inList = true;

        let content = line.trim();
        if (isList) content = content.replace(/^[-*]\s/, "");
        else if (isNumList) content = content.replace(/^\d+\.\s/, "");

        listItems.push(
          <li key={lineIndex}>
            {renderText(content, ["simple_markdown", "emoji", "links"])}
          </li>,
        );
      } else {
        flushList();
        if (line.startsWith("# ")) {
          blocks.push(
            <h3 key={lineIndex}>
              {renderText(line.slice(2), ["simple_markdown", "emoji", "links"])}
            </h3>,
          );
        } else if (line.startsWith("## ") || line.startsWith("### ")) {
          const depth = line.match(/^#+\s/)?.[0].length || 3;
          blocks.push(
            <h4 key={lineIndex}>
              {renderText(line.slice(depth), [
                "simple_markdown",
                "emoji",
                "links",
              ])}
            </h4>,
          );
        } else if (line.trim() === "") {
          blocks.push(
            <div key={`br-${lineIndex}`} className="AiMarkdown__br" />,
          );
        } else {
          blocks.push(
            <div key={lineIndex} className="AiMarkdown__p">
              {renderText(line, ["simple_markdown", "emoji", "links"])}
            </div>,
          );
        }
      }
    });

    flushList();
    return (
      <div key={index} className="AiMarkdown__text">
        {blocks}
      </div>
    );
  });
};

interface OwnProps {
  isMobile?: boolean;
}

interface StateProps {
  chatId?: string;
  isAiAgentOpen: boolean;
  apiKey: string;
  model: AiAgentModel;
  salesContextPrompt: string;
  chatHistory: import("./types").ChatHistoryMessage[];
  userDossier: string;
  enabledModels: AiAgentModel[];
  maxVideos: number;
  maxVoices: number;
  promptMain: string;
  promptAutoAnalysis: string;
  promptMiniAnalysisText: string;
  promptMiniAnalysisPhoto: string;
}

const ALL_MODELS: Array<{ value: AiAgentModel; label: string }> = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-pro-lite", label: "Gemini 2.5 Pro Lite" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
];

type Message = {
  id: string;
  role: "user" | "bot";
  text: string;
  isStreaming?: boolean;
};

const formatAiError = (err: any) => {
  let errorMessage = "Неизвестная ошибка";
  if (err instanceof Error) {
    errorMessage = err.message;
  } else if (typeof err === "string") {
    errorMessage = err;
  } else {
    errorMessage = JSON.stringify(err);
  }
  try {
    const jsonMatch = errorMessage.match(/\\{[\\s\\S]*\\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error?.message) {
        errorMessage = parsed.error.message;
      }
    }
  } catch (e) {
    // Ignore
  }
  return `Ошибка: ${errorMessage}`;
};

const AiRightPanel: FC<OwnProps & StateProps> = ({
  chatId,
  isAiAgentOpen,
  apiKey,
  model,
  salesContextPrompt,
  chatHistory,
  userDossier,
  enabledModels,
  maxVideos,
  maxVoices,
  promptMain,
  promptAutoAnalysis,
  promptMiniAnalysisText,
  promptMiniAnalysisPhoto,
}) => {
  const { toggleAiAgentForChat, updateAiAgentSettings } = getActions();
  const { isDesktop } = useAppLayout();
  const [isSettingsOpen, setIsSettingsOpen] = useState(!apiKey);
  const [chatInput, setChatInput] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  const prevChatHistoryRef = useRef(chatHistory);

  // Local settings state (committed on Save)
  const [localApiKey, setLocalApiKey] = useState(apiKey);
  const [localModel, setLocalModel] = useState(model);
  const [localPrompt, setLocalPrompt] = useState(salesContextPrompt);
  const [localEnabledModels, setLocalEnabledModels] =
    useState<AiAgentModel[]>(enabledModels);
  const [localMaxVideos, setLocalMaxVideos] = useState(maxVideos);
  const [localMaxVoices, setLocalMaxVoices] = useState(maxVoices);
  const [localPromptMain, setLocalPromptMain] = useState(promptMain);
  const [localPromptAutoAnalysis, setLocalPromptAutoAnalysis] =
    useState(promptAutoAnalysis);
  const [localPromptMiniText, setLocalPromptMiniText] = useState(
    promptMiniAnalysisText,
  );
  const [localPromptMiniPhoto, setLocalPromptMiniPhoto] = useState(
    promptMiniAnalysisPhoto,
  );

  const hasAutoAnalyzed = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement>();

  // Resize state — modifies #RightColumn width via CSS variable
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Sync local settings when external values change
  useEffect(() => {
    setLocalApiKey(apiKey);
    setLocalModel(model);
    setLocalPrompt(salesContextPrompt);
    setLocalEnabledModels(enabledModels);
    setLocalMaxVideos(maxVideos);
    setLocalMaxVoices(maxVoices);
    setLocalPromptMain(promptMain);
    setLocalPromptAutoAnalysis(promptAutoAnalysis);
    setLocalPromptMiniText(promptMiniAnalysisText);
    setLocalPromptMiniPhoto(promptMiniAnalysisPhoto);
  }, [
    apiKey,
    model,
    salesContextPrompt,
    enabledModels,
    maxVideos,
    maxVoices,
    promptMain,
    promptAutoAnalysis,
    promptMiniAnalysisText,
    promptMiniAnalysisPhoto,
  ]);

  useEffect(() => {
    hasAutoAnalyzed.current = false;
    setMessages([]);
  }, [chatId]);

  useEffect(() => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.closest(
        ".AiRightPanel__messages-area",
      );
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    }
  }, [messages]);

  useEffect(() => {
    if (isAiAgentOpen && apiKey && !hasAutoAnalyzed.current && chatHistory) {
      hasAutoAnalyzed.current = true;
      prevChatHistoryRef.current = chatHistory as any;
      triggerAutoAnalysis();
    } else if (
      isAiAgentOpen &&
      apiKey &&
      hasAutoAnalyzed.current &&
      chatHistory.length > (prevChatHistoryRef.current as any)?.length
    ) {
      const oldHistory = (prevChatHistoryRef.current as any) || [];
      prevChatHistoryRef.current = chatHistory as any;

      const newLines = chatHistory;
      if (newLines.length > oldHistory.length) {
        const lastMsg = newLines[newLines.length - 1];
        if (lastMsg && lastMsg.role === "User") {
          triggerMiniAnalysis(lastMsg);
        }
      }
    }
  }, [isAiAgentOpen, apiKey, chatHistory]);

  // Resize handlers
  const handleResizeMouseDown = useLastCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    const rightCol = document.getElementById("RightColumn");
    resizeStartWidth.current = rightCol?.offsetWidth || 420;
    document.body.classList.add("cursor-ew-resize");
  });

  useEffect(() => {
    if (!isResizing) return undefined;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeStartX.current - e.clientX;
      const newWidth = Math.max(
        280,
        Math.min(900, resizeStartWidth.current + delta),
      );
      // Set on :root so middle column shifts properly via CSS calc
      document.documentElement.style.setProperty(
        "--right-column-width",
        `${newWidth}px`,
      );
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.classList.remove("cursor-ew-resize");
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const triggerMiniAnalysis = async (
    msg: import("./types").ChatHistoryMessage,
  ) => {
    if (isAiLoading) return;
    const botMessageId = Date.now().toString();
    setMessages((prev) => [
      ...prev,
      { id: botMessageId, role: "bot", text: "", isStreaming: true },
    ]);
    setIsAiLoading(true);

    try {
      let promptText = promptMiniAnalysisText.replace("{text}", msg.text || "");

      if (msg.isPhoto) {
        promptText = promptMiniAnalysisPhoto.replace(
          "{caption}",
          msg.text ? ` С подписью: "${msg.text}"` : "",
        );
      }

      const responseStream = aiApiService.streamChatStrategy(
        apiKey,
        model,
        promptMain
          .replace("{userDossier}", userDossier)
          .replace("{salesContextPrompt}", salesContextPrompt),
        [
          {
            role: "User",
            text: promptText,
            mediaHash: msg.mediaHash,
            mimeType: msg.mimeType,
          } as any,
        ],
      );

      let botText = "";
      for await (const chunk of responseStream) {
        botText += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMessageId ? { ...m, text: botText } : m,
          ),
        );
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMessageId ? { ...m, isStreaming: false } : m,
        ),
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMessageId
            ? { ...m, text: formatAiError(err), isStreaming: false }
            : m,
        ),
      );
    } finally {
      setIsAiLoading(false);
    }
  };

  const triggerAutoAnalysis = async () => {
    const botMessageId = Date.now().toString();
    setMessages([
      { id: botMessageId, role: "bot", text: "", isStreaming: true },
    ]);
    setIsAiLoading(true);

    try {
      const systemPrompt = promptAutoAnalysis
        .replace("{userDossier}", userDossier)
        .replace("{salesContextPrompt}", salesContextPrompt);
      const responseStream = aiApiService.streamChatStrategy(
        apiKey,
        model,
        systemPrompt,
        chatHistory as any,
      );

      let botText = "";
      for await (const chunk of responseStream) {
        botText += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMessageId ? { ...m, text: botText } : m,
          ),
        );
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMessageId ? { ...m, isStreaming: false } : m,
        ),
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMessageId
            ? { ...m, text: formatAiError(err), isStreaming: false }
            : m,
        ),
      );
    } finally {
      setIsAiLoading(false);
    }
  };

  if (!isAiAgentOpen) return null;

  const handleClose = () => {
    // Reset resize to default
    document.documentElement.style.removeProperty("--right-column-width");
    if (chatId) {
      toggleAiAgentForChat({ chatId, isEnabled: false });
    }
  };

  const handleSaveSettings = () => {
    updateAiAgentSettings({
      apiKey: localApiKey,
      model: localModel,
      salesContextPrompt: localPrompt,
      enabledModels: localEnabledModels,
      maxVideos: localMaxVideos,
      maxVoices: localMaxVoices,
      promptMain: localPromptMain,
      promptAutoAnalysis: localPromptAutoAnalysis,
      promptMiniAnalysisText: localPromptMiniText,
      promptMiniAnalysisPhoto: localPromptMiniPhoto,
    });
    setIsSettingsOpen(false);
  };

  const handleToggleModelEnabled = (modelValue: AiAgentModel) => {
    setLocalEnabledModels((prev) => {
      if (prev.includes(modelValue)) {
        if (prev.length <= 1) return prev; // Keep at least one
        return prev.filter((m) => m !== modelValue);
      }
      return [...prev, modelValue];
    });
  };

  const onSend = async () => {
    if (!chatInput.trim() || isAiLoading) return;
    const userText = chatInput.trim();
    setChatInput("");
    inputRef.current?.focus();

    const newMessages: Message[] = [
      ...messages,
      { id: Date.now().toString(), role: "user", text: userText },
    ];
    setMessages(newMessages);

    const botMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: botMessageId, role: "bot", text: "", isStreaming: true },
    ]);
    setIsAiLoading(true);

    try {
      const chatHistoryStr = newMessages
        .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.text}`)
        .join("\n");

      const systemPrompt = promptMain
        .replace("{userDossier}", userDossier)
        .replace("{salesContextPrompt}", salesContextPrompt);

      const fullHistory = [
        ...(chatHistory as any),
        { role: "User", text: userText },
      ];

      const responseStream = aiApiService.streamChatStrategy(
        apiKey,
        model,
        systemPrompt,
        fullHistory,
      );

      let botText = "";
      for await (const chunk of responseStream) {
        botText += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMessageId ? { ...m, text: botText } : m,
          ),
        );
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMessageId ? { ...m, isStreaming: false } : m,
        ),
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMessageId
            ? { ...m, text: formatAiError(err), isStreaming: false }
            : m,
        ),
      );
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleAttachFile = useLastCallback(() => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".txt,.md,.json,.csv,.pdf,.doc,.docx";
    fileInput.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (re) => {
        const fileText = re.target?.result as string;
        if (fileText) {
          setChatInput((prev) => prev + (prev ? "\n" : "") + fileText);
          inputRef.current?.focus();
        }
      };
      reader.readAsText(file);
    };
    fileInput.click();
  });

  const canSend = chatInput.trim().length > 0 && !isAiLoading;

  // Filter models for dropdown to only show enabled ones
  const activeModels = ALL_MODELS.filter((m) =>
    localEnabledModels.includes(m.value),
  );

  const handleModelMenuOpen = useLastCallback(() => {
    setIsModelMenuOpen(true);
  });

  const handleModelMenuClose = useLastCallback(() => {
    setIsModelMenuOpen(false);
  });

  const handleSelectModel = useLastCallback((modelValue: AiAgentModel) => {
    setLocalModel(modelValue);
    updateAiAgentSettings({
      apiKey,
      model: modelValue,
      salesContextPrompt,
      enabledModels,
    });
    setIsModelMenuOpen(false);
  });

  return (
    <div className="AiRightPanel">
      {/* ── Resize handle (left edge) ── */}
      {isDesktop && (
        <div
          className="AiRightPanel__resize-handle"
          onMouseDown={handleResizeMouseDown}
        />
      )}

      {/* ── Header — clean ── */}
      <div className="AiRightPanel__header">
        <Button
          round
          color="translucent"
          size="smaller"
          className="AiRightPanel__header-btn"
          onClick={handleClose}
          iconName="close"
          ariaLabel="Закрыть"
        />

        <div className="AiRightPanel__header-info">
          <div className="AiRightPanel__header-title">AI Ассистент</div>
        </div>

        <Button
          round
          color="translucent"
          size="smaller"
          className={`AiRightPanel__header-btn${isSettingsOpen ? " is-active" : ""}`}
          onClick={() => setIsSettingsOpen((v) => !v)}
          iconName="settings"
          ariaLabel="Настройки"
        />
      </div>

      {/* ── Chat area ── */}
      <div className="AiRightPanel__messages-area custom-scroll">
        <div className="AiRightPanel__bg" />

        <div className="AiRightPanel__messages">
          {!apiKey && (
            <div className="AiRightPanel__notice">
              <i className="icon icon-lock" />
              Укажите API ключ в настройках для начала работы
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`Message message-list-item allow-selection first-in-group last-in-group${m.role === "user" ? " own" : ""}`}
            >
              <div
                className="message-content text has-shadow has-solid-background has-appendix"
                dir="auto"
              >
                <div className="content-inner" dir="auto">
                  <div className="text-content clearfix" dir="auto">
                    {m.role === "bot" ? (
                      <div className="AiMarkdown" dir="auto">
                        {parseAiMarkdown(
                          m.text || " ",
                          (text) => navigator.clipboard.writeText(text),
                          (text) => {
                            const messageInput =
                              document.querySelector<HTMLDivElement>(
                                EDITABLE_INPUT_CSS_SELECTOR,
                              );
                            if (messageInput) {
                              messageInput.focus();
                              document.execCommand("insertText", false, text);
                            }
                          },
                        )}
                        {!m.isStreaming && (
                          <div className="AiRightPanel__msg-actions">
                            <Button
                              size="tiny"
                              color="translucent"
                              round
                              iconName="copy"
                              ariaLabel="Копировать"
                              onClick={() =>
                                navigator.clipboard.writeText(m.text)
                              }
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      renderText(m.text, [
                        "simple_markdown",
                        "emoji",
                        "br",
                        "links",
                      ])
                    )}
                    {m.isStreaming && (
                      <span className="AiRightPanel__cursor">▋</span>
                    )}
                  </div>
                </div>
                <MessageAppendix isOwn={m.role === "user"} />
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Custom AI Composer ── */}
      <div className="AiRightPanel__footer">
        {/* Model Selector Chip */}
        <div className="AiRightPanel__model-selector">
          <div
            className="AiRightPanel__model-chip"
            onClick={handleModelMenuOpen}
            title="Выбрать модель"
          >
            <i className="icon icon-lamp" />
            <span className="chip-text">
              {ALL_MODELS.find((m) => m.value === localModel)?.label ||
                "Выбрать модель"}
            </span>
            <i className="icon icon-down" />
          </div>
          <Menu
            isOpen={isModelMenuOpen}
            positionX="left"
            positionY="bottom"
            autoClose
            onClose={handleModelMenuClose}
            className="AiRightPanel__model-menu"
          >
            {activeModels.map((m) => (
              <MenuItem
                key={m.value}
                icon={m.value === localModel ? "check" : undefined}
                onClick={() => handleSelectModel(m.value)}
              >
                {m.label}
              </MenuItem>
            ))}
          </Menu>
        </div>

        {/* Input Row */}
        <div className="AiRightPanel__input-row">
          <Button
            round
            color="translucent"
            className="AiRightPanel__attach-btn"
            onClick={handleAttachFile}
            ariaLabel="Прикрепить файл"
            iconName="attach"
          />

          <div className="AiRightPanel__input-wrapper">
            <input
              ref={inputRef}
              className="AiRightPanel__input"
              type="text"
              dir="auto"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isAiLoading}
              placeholder="Спросить ИИ…"
              autoComplete="off"
            />
          </div>

          <Button
            round
            color="translucent"
            className={`AiRightPanel__send-btn ${canSend ? "can-send" : ""}`}
            onClick={canSend ? onSend : undefined}
            ariaLabel="Отправить"
            disabled={!canSend}
            iconName="send"
          />
        </div>
      </div>

      {/* ── Settings — Telegram-native style ── */}
      {isSettingsOpen && (
        <div className="AiSettings" onClick={(e) => e.stopPropagation()}>
          <div className="AiSettings__header">
            <span className="AiSettings__title">Настройки ИИ</span>
            <Button
              round
              color="translucent"
              size="smaller"
              onClick={() => setIsSettingsOpen(false)}
              iconName="close"
              ariaLabel="Закрыть настройки"
            />
          </div>

          <div className="AiSettings__body custom-scroll">
            {/* Models section */}
            <div className="AiSettings__section">
              <div className="AiSettings__section-header">Доступные модели</div>
              <div className="AiSettings__section-content">
                {ALL_MODELS.map((m) => (
                  <label
                    key={m.value}
                    className="AiSettings__list-item"
                    onClick={() => handleToggleModelEnabled(m.value)}
                  >
                    <span
                      className={`AiSettings__checkbox-mark${localEnabledModels.includes(m.value) ? " is-checked" : ""}`}
                    />
                    <span className="AiSettings__list-item-text">
                      {m.label}
                    </span>
                    <input
                      type="checkbox"
                      checked={localEnabledModels.includes(m.value)}
                      onChange={() => handleToggleModelEnabled(m.value)}
                    />
                  </label>
                ))}
              </div>
              <div className="AiSettings__section-hint">
                Выбранные модели будут доступны в быстром переключателе
              </div>
            </div>

            {/* API Key section */}
            <div className="AiSettings__section">
              <div className="AiSettings__section-header">
                Gemini API Key
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="AiSettings__label-link"
                >
                  Получить
                </a>
              </div>
              <div className="AiSettings__section-content">
                <div className="AiSettings__input-field">
                  <input
                    className="AiSettings__input"
                    type="password"
                    value={localApiKey}
                    onChange={(e) => setLocalApiKey(e.target.value)}
                    placeholder="AIza..."
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
            {/* System prompt section */}
            <div className="AiSettings__section">
              <div className="AiSettings__section-header">
                Основной системный промпт
              </div>
              <div className="AiSettings__section-content">
                <div className="AiSettings__input-field">
                  <textarea
                    className="AiSettings__textarea"
                    value={localPromptMain}
                    onChange={(e) => setLocalPromptMain(e.target.value)}
                    placeholder="Системный промпт (используйте {userDossier} и {salesContextPrompt})"
                    rows={5}
                  />
                </div>
              </div>
            </div>
            <div className="AiSettings__section">
              <div className="AiSettings__section-header">
                Инструкция и контекст продаж
              </div>
              <div className="AiSettings__section-content">
                <div className="AiSettings__input-field">
                  <textarea
                    className="AiSettings__textarea"
                    value={localPrompt}
                    onChange={(e) => setLocalPrompt(e.target.value)}
                    placeholder="Опишите стиль общения, роль ассистента, контекст продаж…"
                    rows={5}
                  />
                </div>
              </div>
              <div className="AiSettings__section-hint">
                Вставляется вместо {"{salesContextPrompt}"} в других промптах
              </div>
            </div>
            <div className="AiSettings__section">
              <div className="AiSettings__section-header">
                Промпт для авто-анализа чата
              </div>
              <div className="AiSettings__section-content">
                <div className="AiSettings__input-field">
                  <textarea
                    className="AiSettings__textarea"
                    value={localPromptAutoAnalysis}
                    onChange={(e) => setLocalPromptAutoAnalysis(e.target.value)}
                    placeholder="Промпт для авто-анализа чата (переменные {userDossier}, {salesContextPrompt})"
                    rows={4}
                  />
                </div>
              </div>
            </div>
            <div className="AiSettings__section">
              <div className="AiSettings__section-header">
                Промпт для мини-анализа (текст)
              </div>
              <div className="AiSettings__section-content">
                <div className="AiSettings__input-field">
                  <textarea
                    className="AiSettings__textarea"
                    value={localPromptMiniText}
                    onChange={(e) => setLocalPromptMiniText(e.target.value)}
                    placeholder="Промпт для текстовых сообщений (переменная {text})"
                    rows={4}
                  />
                </div>
              </div>
            </div>
            <div className="AiSettings__section">
              <div className="AiSettings__section-header">
                Промпт для мини-анализа (фото)
              </div>
              <div className="AiSettings__section-content">
                <div className="AiSettings__input-field">
                  <textarea
                    className="AiSettings__textarea"
                    value={localPromptMiniPhoto}
                    onChange={(e) => setLocalPromptMiniPhoto(e.target.value)}
                    placeholder="Промпт для фото сообщений (переменная {caption})"
                    rows={4}
                  />
                </div>
              </div>
            </div>
            {/* Max Videos section */}
            <div className="AiSettings__section">
              <div className="AiSettings__section-header">
                Максимум анализируемых видео в истории
              </div>
              <div
                className="AiSettings__section-content"
                style="display: flex; align-items: center; gap: 10px; padding: 10px 16px;"
              >
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={localMaxVideos}
                  onChange={(e) =>
                    setLocalMaxVideos(
                      Number((e.target as HTMLInputElement).value),
                    )
                  }
                  style="flex: 1;"
                />
                <div style="min-width: 24px; text-align: right; font-weight: 500;">
                  {localMaxVideos}
                </div>
              </div>
              <div className="AiSettings__section-hint">
                Google Gemini API поддерживает максимум 10 видеофайлов.
              </div>
            </div>
            {/* Max Voices section */}
            <div className="AiSettings__section">
              <div className="AiSettings__section-header">
                Максимум анализируемых голосовых в истории
              </div>
              <div
                className="AiSettings__section-content"
                style="display: flex; align-items: center; gap: 10px; padding: 10px 16px;"
              >
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={localMaxVoices}
                  onChange={(e) =>
                    setLocalMaxVoices(
                      Number((e.target as HTMLInputElement).value),
                    )
                  }
                  style="flex: 1;"
                />
                <div style="min-width: 24px; text-align: right; font-weight: 500;">
                  {localMaxVoices}
                </div>
              </div>
              <div className="AiSettings__section-hint">
                Google Gemini API поддерживает максимум 10 аудиофайлов.
              </div>
            </div>
          </div>

          <div className="AiSettings__footer">
            <Button onClick={handleSaveSettings} size="smaller">
              Сохранить
            </Button>
          </div>
        </div>
      )}

      {/* Overlay behind settings */}
      {isSettingsOpen && (
        <div
          className="AiSettings__overlay"
          onClick={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};

const defaultModels: AiAgentModel[] = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
];

export default memo(
  withGlobal<OwnProps>((global): Complete<StateProps> => {
    const { chatId } = selectCurrentMessageList(global) || {};
    const isAiAgentOpen = Boolean(
      chatId &&
      global.aiAgent?.enabledChats.includes(chatId) &&
      global.aiAgent?.isRightColumnOpen,
    );

    let chatHistory: import("./types").ChatHistoryMessage[] = [];
    if (chatId) {
      const chatMessagesMap = selectChatMessages(global, chatId);
      if (chatMessagesMap) {
        chatHistory = Object.values(chatMessagesMap)
          .filter(
            (m: any) =>
              m &&
              !m.isService &&
              (m.content?.text?.text ||
                m.content?.voice ||
                m.content?.photo ||
                (m.content?.video && m.content?.video?.isRound)),
          )
          .sort((a: any, b: any) => a.date - b.date)
          .map((m: any) => {
            let text =
              typeof m.content?.text?.text === "string"
                ? m.content.text.text
                : m.content?.text?.text
                  ? String(m.content.text.text)
                  : "";

            let mediaFormat = undefined;
            let mimeType = undefined;
            let mediaHash = undefined;

            let isPhoto = false;

            if (m.transcriptionId && global.transcriptions[m.transcriptionId]) {
              text = (
                text +
                "\\n(Транскрипция голосового: " +
                global.transcriptions[m.transcriptionId].text +
                ")"
              ).trim();
            } else if (
              m.content?.voice ||
              (m.content?.video && m.content?.video?.isRound)
            ) {
              const file = m.content?.voice || m.content?.video;
              mediaFormat = m.content?.voice ? "voice" : "video";
              mediaHash = "document" + file.id;
              mimeType =
                file.mimeType ||
                (mediaFormat === "voice" ? "audio/ogg" : "video/mp4");
            } else if (m.content?.photo) {
              isPhoto = true;
              // Analyse only real-time recent photos (last 15 minutes) to avoid downloading all old chat data
              // The panel will react to real-time additions via triggerMiniAnalysis
              if (Date.now() / 1000 - m.date < 15 * 60) {
                mediaFormat = "photo";
                mediaHash = "photo" + m.content.photo.id + "?size=x";
                mimeType = "image/jpeg";
              }
            }
            return {
              role: m.isOutgoing ? "Me" : "User",
              text,
              mediaHash,
              mediaFormat,
              mimeType,
              isPhoto,
            };
          });

        const maxVideos = global.aiAgent?.settings.maxVideos ?? 5; // default 5
        const maxVoices = global.aiAgent?.settings.maxVoices ?? 5; // default 5
        let videoCount = 0;
        let voiceCount = 0;
        for (let i = chatHistory.length - 1; i >= 0; i--) {
          if (chatHistory[i].mediaFormat === "video") {
            videoCount++;
            if (videoCount > maxVideos) {
              chatHistory[i].mediaFormat = undefined;
              chatHistory[i].mediaHash = undefined;
              chatHistory[i].mimeType = undefined;
            }
          } else if (chatHistory[i].mediaFormat === "voice") {
            voiceCount++;
            if (voiceCount > maxVoices) {
              chatHistory[i].mediaFormat = undefined;
              chatHistory[i].mediaHash = undefined;
              chatHistory[i].mimeType = undefined;
            }
          }
        }
      }
    }

    let userDossier = "Нет данных о пользователе.";
    if (chatId) {
      const user = selectUser(global, chatId);
      const userInfo = selectUserFullInfo(global, chatId);
      if (user) {
        userDossier = `Имя: ${user.firstName || ""} ${user.lastName || ""}\n`;
        if (user.usernames?.length) {
          userDossier += `Username: @${user.usernames[0].username}\n`;
        }
        if (userInfo?.bio) {
          userDossier += `Био: ${userInfo.bio}\n`;
        }
        if (user.isPremium) {
          userDossier += `Premium Аккаунт: Да\n`;
        }
      }
    }

    return {
      chatId,
      isAiAgentOpen,
      apiKey: global.aiAgent?.settings.apiKey || "",
      model: global.aiAgent?.settings.model || "gemini-2.5-flash",
      salesContextPrompt: global.aiAgent?.settings.salesContextPrompt || "",
      chatHistory,
      userDossier,
      enabledModels: global.aiAgent?.settings.enabledModels || defaultModels,
      maxVideos: global.aiAgent?.settings.maxVideos ?? 5,
      maxVoices: global.aiAgent?.settings.maxVoices ?? 5,
      promptMain:
        global.aiAgent?.settings.promptMain ||
        "Ты — профессиональный ИИ-ассистент внутри Telegram. Отвечай максимально коротко, по существу, без лишних слов.\\n\\nДАННЫЕ О СОБЕСЕДНИКЕ:\\n{userDossier}\\n\\nИНСТРУКЦИЯ И КОНТЕКСТ:\\n{salesContextPrompt}",
      promptAutoAnalysis:
        global.aiAgent?.settings.promptAutoAnalysis ||
        "Проанализируй этот чат и дай очень краткое саммари (2-3 предложения) и рекомендации маркдауном.\\n\\nДОСЬЕ НА ПОЛЬЗОВАТЕЛЯ:\\n{userDossier}\\n\\n{salesContextPrompt}",
      promptMiniAnalysisText:
        global.aiAgent?.settings.promptMiniAnalysisText ||
        'Собеседник только что написал новое сообщение:\\n"{text}"\\n\\nДай моментальный, очень короткий анализ или идею для ответа (1-2 предложения максимум). Без воды.',
      promptMiniAnalysisPhoto:
        global.aiAgent?.settings.promptMiniAnalysisPhoto ||
        "Собеседник только что прислал фото.{caption}\\n\\nДай моментальный, очень короткий анализ фото для ответа (1-2 предложения максимум). Без воды.",
    };
  })(AiRightPanel),
);
