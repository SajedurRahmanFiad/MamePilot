import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Send, X, RotateCcw } from 'lucide-react';
import { apiAction } from '../src/services/apiClient';
import { theme } from '../theme';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useAuth } from '../src/contexts/AuthProvider';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: Array<{ id: string; label: string; status: 'pending' | 'active' | 'done'; kind: string }>;
  followUps?: string[];
};

type AgentRunResponse = {
  answer: string;
  runId: string;
  conversationId: string;
  streamToken: string;
  status: string;
};

type AgentRunEvent = {
  type: string;
  sequence: number;
  payload: Record<string, any>;
  createdAt?: string;
};

type AgentRunStreamResponse = {
  runId: string;
  conversationId: string;
  status: string;
  answer: string;
  events: AgentRunEvent[];
  messages: Array<{ role: string; content: string }>;
};

const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => {
  const tokens = text.split(/(\*\*(?:[^*]|\*[^*])*\*\*)/g);
  return tokens.flatMap((token, index) => {
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      const innerText = token.slice(2, -2);
      return [
        <strong key={`${keyPrefix}-bold-${index}`}>
          {innerText.split('\n').flatMap((line, innerIndex) => [
            innerIndex > 0 ? <br key={`${keyPrefix}-bold-${index}-br-${innerIndex}`} /> : null,
            line,
          ])}
        </strong>,
      ];
    }

    return token.split('\n').flatMap((line, innerIndex) => [
      innerIndex > 0 ? <br key={`${keyPrefix}-${index}-br-${innerIndex}`} /> : null,
      line,
    ]);
  });
};

const renderMessageContent = (content: string): ReactNode[] => {
  if (!content) {
    return [content];
  }

  const lines = content.split('\n');
  const rendered: ReactNode[] = [];
  let currentListType: 'ul' | 'ol' | null = null;
  let currentListItems: string[] = [];

  const flushList = () => {
    if (!currentListType || currentListItems.length === 0) {
      currentListType = null;
      currentListItems = [];
      return;
    }

    const listKey = `list-${rendered.length}`;
    if (currentListType === 'ul') {
      rendered.push(
        <ul key={listKey} className="ml-4 list-disc space-y-1">
          {currentListItems.map((item, index) => (
            <li key={`${listKey}-item-${index}`}>
              {renderInlineMarkdown(item, `${listKey}-item-${index}`)}
            </li>
          ))}
        </ul>,
      );
    } else {
      rendered.push(
        <ol key={listKey} className="ml-4 list-decimal space-y-1">
          {currentListItems.map((item, index) => (
            <li key={`${listKey}-item-${index}`}>
              {renderInlineMarkdown(item, `${listKey}-item-${index}`)}
            </li>
          ))}
        </ol>,
      );
    }

    currentListType = null;
    currentListItems = [];
  };

  const flushParagraph = (paragraph: string) => {
    if (paragraph === '') {
      rendered.push(<br key={`blank-${rendered.length}`} />);
      return;
    }

    rendered.push(
      <div key={`paragraph-${rendered.length}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(paragraph, `paragraph-${rendered.length}`)}
      </div>,
    );
  };

  lines.forEach((line) => {
    const listMatch = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const marker = listMatch[1];
      const itemText = listMatch[2];
      const listType = marker === '-' || marker === '*' ? 'ul' : 'ol';

      if (currentListType && currentListType !== listType) {
        flushList();
      }

      if (!currentListType) {
        currentListType = listType;
      }

      currentListItems.push(itemText);
      return;
    }

    flushList();
    flushParagraph(line);
  });

  flushList();
  return rendered;
};

const INITIAL_MESSAGE: ChatMessage = {
  id: 'welcome-message',
  role: 'assistant',
  content:
    'Hello! I am Mame, your business assistant. How can I help you today?.',
};

const MameChat: React.FC = () => {
  const { user } = useAuth();
  const { hasCapability, isDeveloper } = useCapabilities(Boolean(user));
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [inputRadius, setInputRadius] = useState(24);
  const [conversationId, setConversationId] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  if (!isDeveloper && !hasCapability('enterprise_ai_agent')) {
    return null;
  }

  const chatHeight = useMemo(() => {
    if (isMobile) {
      return `calc(100vh - ${120 + keyboardOffset}px)`;
    }
    return undefined;
  }, [isMobile, keyboardOffset]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateMobile = () => setIsMobile(mediaQuery.matches);
    updateMobile();
    mediaQuery.addEventListener('change', updateMobile);
    return () => mediaQuery.removeEventListener('change', updateMobile);
  }, []);

  useEffect(() => {
    const updateKeyboardOffset = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        setKeyboardOffset(0);
        return;
      }
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardOffset(offset);
    };

    updateKeyboardOffset();
    window.addEventListener('resize', updateKeyboardOffset);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateKeyboardOffset);
    }

    return () => {
      window.removeEventListener('resize', updateKeyboardOffset);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateKeyboardOffset);
      }
    };
  }, []);

  const adjustTextareaHeight = () => {
    const textarea = inputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    const maxHeight = 108; // roughly 3 lines with current line-height
    const targetHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${targetHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    setInputRadius(Math.max(14, 24 - Math.floor((targetHeight - 44) / 8)));
  };

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [draft, isOpen]);

  useEffect(() => {
    if (!isOpen && isMobile) {
      document.body.style.overflow = '';
    }
  }, [isOpen, isMobile]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (trimmed === '' || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    const assistantMessageId = `assistant-${Date.now()}`;
    const thinkingTexts = [
      'Thinking...',
      'Analyzing your question...',
      'Querying the database...',
      'Looking at your business data...',
      'Preparing your answer...',
    ];

    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: thinkingTexts[0],
    };

    setMessages((current) => [...current, userMessage, assistantPlaceholder]);
    setDraft('');
    setIsSending(true);

    let thinkingIndex = 0;
    const thinkingInterval = window.setInterval(() => {
      thinkingIndex = (thinkingIndex + 1) % thinkingTexts.length;
      setMessages((current) => current.map((message) =>
        message.id === assistantMessageId
          ? { ...message, content: thinkingTexts[thinkingIndex] }
          : message
      ));
    }, 2500);

    try {
      const response = await apiAction<AgentRunResponse>('mameChat', {
        message: trimmed,
        conversationId: conversationId || undefined,
      }, { timeoutMs: 120000 });

      window.clearInterval(thinkingInterval);

      const answer = response?.answer || 'I could not generate a response. Please try again.';
      if (response?.conversationId) {
        setConversationId(response.conversationId);
      }
      setMessages((current) => current.map((message) =>
        message.id === assistantMessageId
          ? { ...message, content: answer }
          : message
      ));
    } catch (error: any) {
      window.clearInterval(thinkingInterval);

      const errorContent = error?.code === 'TIMEOUT'
        ? 'The request took too long. Please try a simpler question or try again later.'
        : error?.code === 'NETWORK'
          ? 'Unable to connect to Mame. Please check your internet connection and try again.'
          : error?.message || 'Unable to connect to Mame right now. Please try again later.';

      setMessages((current) => current.map((message) =>
        message.id === assistantMessageId
          ? { ...message, content: errorContent }
          : message
      ));
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const openPanel = () => {
    setHasOpenedOnce(true);
    setIsClosing(false);
    setIsOpen(true);
  };

  const closePanel = () => {
    if (!isOpen) return;
    setIsClosing(true);
  };

  useEffect(() => {
    if (!isClosing) return;

    const timeout = window.setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 280);

    return () => window.clearTimeout(timeout);
  }, [isClosing]);

  const widgetContainer = isMobile
    ? 'fixed inset-0 z-[100] bg-white'
    : 'fixed bottom-4 right-[112px] z-[100] w-[360px] h-[520px] rounded-[32px] shadow-2xl';

  const widgetAnimationClass = isClosing ? 'animate-chat-panel-close' : 'animate-chat-panel-enter';

  const widgetBodyClass = isMobile
    ? 'flex flex-col h-full'
    : `${theme.card.elevated} flex flex-col h-full overflow-hidden bg-white`;

  return (
    <>
      <div className="fixed right-6 bottom-6 z-[90] flex items-center gap-3">
        {!hasOpenedOnce && (
          <div className="flex h-10 items-center rounded-full bg-white px-4 text-xs font-semibold text-slate-900 shadow-lg md:h-12 md:px-5 md:text-sm">
            Chat with Mame
          </div>
        )}
        <div className="relative flex h-14 w-14 md:h-[72px] md:w-[72px] items-center justify-center rounded-full">
          <span className="pointer-events-none absolute inset-0 rounded-full border border-[var(--primary-color,#0f2f57)]/30 bg-[var(--primary-color,#0f2f57)]/20 opacity-0 shadow-[0_0_0_0_rgba(15,47,87,0.25)] animate-chat-shockwave" />
          <button
            type="button"
            onClick={() => {
              if (isOpen && !isClosing) {
                closePanel();
              } else {
                openPanel();
              }
            }}
            className={`relative inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-transparent shadow-2xl ${theme.transitions.normal}`}
            aria-label={isOpen ? 'Close chat' : 'Open chat'}
          >
            <img src="/uploads/Mame%20AI.png" alt="Mame AI" className="h-full w-full object-cover" />
          </button>
        </div>
      </div>

      {(isOpen || isClosing) && (
        <div className={`${widgetContainer} ${widgetAnimationClass}`}>
          {isMobile && (
            <div
              className="absolute inset-0 bg-black/20"
              onClick={closePanel}
            />
          )}
          <div className={`${widgetBodyClass} ${isMobile ? 'relative m-0 rounded-none' : 'bg-white'} ${theme.radius.lg}`} style={{ margin: isMobile ? 0 : undefined }}>
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 bg-white">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-[var(--primary-color,#0f2f57)]/10">
                  <img src="/uploads/Avatar.png" alt="Mame avatar" className="h-10 w-10 object-cover" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Mame</p>
                  <p className="text-xs text-gray-500">Ask anything.</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setConversationId('');
                    setMessages([INITIAL_MESSAGE]);
                  }}
                  className="inline-flex items-center justify-center rounded-full p-2 text-gray-500 hover:bg-gray-100"
                  aria-label="New chat"
                  title="New chat"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  type="button"
                  onClick={closePanel}
                  className="inline-flex items-center justify-center rounded-full p-2 text-gray-500 hover:bg-gray-100"
                  aria-label="Close chat"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden px-4 py-0" style={{ minHeight: 0 }}>
              <div className="flex min-h-0 h-full flex-col gap-3 overflow-y-auto pr-1" style={isMobile ? { maxHeight: chatHeight } : undefined}>
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    className={`flex items-end gap-1 ${message.role === 'user' ? 'justify-end' : 'justify-start'} ${!index && message.role === 'assistant' ? 'mt-5' : ''}`}
                  >
                    {message.role === 'assistant' && (
                      <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-[var(--primary-color,#0f2f57)]/10 ring-1 ring-[var(--primary-color,#0f2f57)]/20">
                        <img src="/uploads/Avatar.png" alt="Mame avatar" className="h-full w-full object-cover" />
                      </div>
                    )}

                    <div
                      className={`max-w-[85%] rounded-3xl px-3 py-2 text-sm leading-6 ${
                        message.role === 'user'
                          ? `${theme.colors.primary[600]} text-white rounded-br-[4px]`
                          : 'bg-[var(--primary-soft,#dbeafe)] text-gray-900 rounded-bl-[4px] border border-slate-200 shadow-sm'
                      }`}
                    >
                      {renderMessageContent(message.content)}
                    </div>

                    {message.role === 'user' && (
                      <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-gray-100">
                        <img src="/uploads/Empty_avatar.png" alt="Your avatar" className="h-full w-full object-cover" />
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div
              className="border-t border-gray-200 bg-white px-4 py-2"
              style={{ paddingBottom: isMobile ? `${keyboardOffset + 14}px` : '12px' }}
            >
              <div
                className="relative flex items-center border border-gray-200 bg-gray-50 transition duration-200 focus-within:border-[var(--primary-color,#0f2f57)] focus-within:ring-2 focus-within:ring-[var(--primary-color,#0f2f57)]/20"
                style={{ borderRadius: `${inputRadius}px`, padding: '10px 50px 10px 14px', minHeight: '44px', maxHeight: '108px' }}
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    adjustTextareaHeight();
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask Mame..."
                  className={`w-full bg-transparent border-none p-0 pr-0 text-sm text-gray-900 outline-none resize-none overflow-hidden ${theme.transitions.normal}`}
                  style={{ minHeight: '24px', maxHeight: '84px', lineHeight: '1.5' }}
                  aria-label="Type your message"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={draft.trim() === '' || isSending}
                  className={`absolute right-3 top-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full ${theme.colors.primary[600]} text-white ${theme.transitions.normal} hover:${theme.colors.primary[700]} ${draft.trim() === '' || isSending ? 'opacity-60 cursor-not-allowed' : ''}`}
                  aria-label="Send message"
                  style={{ transform: 'translateY(-50%)' }}
                >
                  {isSending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MameChat;