import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, RotateCcw, Send, Square, X } from 'lucide-react';
import { apiAction, apiActionUrl, getAuthToken } from '../src/services/apiClient';
import { theme } from '../theme';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useAuth } from '../src/contexts/AuthProvider';

type BundleItem = {
  position: number;
  toolName: string;
  preview?: { label?: string; effect?: string; values?: Record<string, unknown> };
};

type ActionBundle = {
  bundleId: string;
  confirmationToken: string;
  expiresAt: string;
  items: BundleItem[];
};

type ChatMessage = {
  id: string;
  runId?: string | null;
  role: 'user' | 'assistant';
  content: string;
  bundle?: ActionBundle;
};

type RunReceipt = {
  answer?: string;
  runId: string;
  conversationId: string;
  status: string;
  eventCursor: number;
};

type RunEvent = {
  id: string;
  runId: string;
  type: string;
  sequence: number;
  payload: Record<string, any>;
  createdAt?: string;
};

type RunEventsResponse = {
  runId: string;
  conversationId: string;
  status: string;
  currentActivity?: string;
  events: RunEvent[];
  nextCursor: number;
  terminal: boolean;
};

type ConversationResponse = {
  messages: Array<{ id: string; runId?: string | null; role: string; content: string }>;
  activeRun?: { runId: string; status: string; eventCursor: number; currentActivity?: string } | null;
};

type Attachment = { id: string; fileName: string; mimeType: string; sizeBytes: number };

const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => text.split(/(\*\*(?:[^*]|\*[^*])*\*\*)/g).flatMap((token, index) => {
  if (token.startsWith('**') && token.endsWith('**') && token.length > 4) return [<strong key={`${keyPrefix}-bold-${index}`}>{token.slice(2, -2)}</strong>];
  return token.split('\n').flatMap((line, innerIndex) => [innerIndex > 0 ? <br key={`${keyPrefix}-${index}-br-${innerIndex}`} /> : null, line]);
});

const renderMessageContent = (content: string): ReactNode[] => {
  if (!content) return [content];
  const lines = content.split('\n');
  const rendered: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    const key = `list-${rendered.length}`;
    rendered.push(<ul key={key} className="ml-4 list-disc space-y-1">{list.map((item, index) => <li key={`${key}-${index}`}>{renderInlineMarkdown(item, `${key}-${index}`)}</li>)}</ul>);
    list = [];
  };
  lines.forEach((line) => {
    const match = line.match(/^\s*[-*]\s+(.*)$/);
    if (match) { list.push(match[1]); return; }
    flush();
    rendered.push(line ? <div key={`p-${rendered.length}`} className="whitespace-pre-wrap">{renderInlineMarkdown(line, `p-${rendered.length}`)}</div> : <br key={`b-${rendered.length}`} />);
  });
  flush();
  return rendered;
};

const INITIAL_MESSAGE: ChatMessage = { id: 'welcome-message', role: 'assistant', content: 'Hello! I am Mame, your business assistant. How can I help you today?' };
const STORAGE_KEY = 'mame-ai-conversation-id';

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
  const [conversationId, setConversationId] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [activeRunId, setActiveRunId] = useState('');
  const [cursor, setCursor] = useState(0);
  const [monitorEpoch, setMonitorEpoch] = useState(0);
  const [activity, setActivity] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const chatHeight = useMemo(() => isMobile ? `calc(100vh - ${120 + keyboardOffset}px)` : undefined, [isMobile, keyboardOffset]);
  const adjustTextareaHeight = () => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const targetHeight = Math.min(textarea.scrollHeight, 108);
    textarea.style.height = `${targetHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 108 ? 'auto' : 'hidden';
    setInputRadius(Math.max(14, 24 - Math.floor((targetHeight - 44) / 8)));
  };

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const update = () => {
      const viewport = window.visualViewport;
      setKeyboardOffset(viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0);
    };
    update(); window.addEventListener('resize', update); window.visualViewport?.addEventListener('resize', update);
    return () => { window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); };
  }, []);

  useEffect(() => { if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, activity, isOpen]);
  useEffect(() => { adjustTextareaHeight(); }, [draft, isOpen]);
  useEffect(() => { if (!isOpen && isMobile) document.body.style.overflow = ''; }, [isOpen, isMobile]);

  const loadConversation = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const response = await apiAction<ConversationResponse>('fetchAgentConversation', { conversationId: id });
      const restored = response.messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => ({ id: message.id, runId: message.runId, role: message.role as 'user' | 'assistant', content: message.content }));
      setMessages(restored.length ? restored : [INITIAL_MESSAGE]);
      if (response.activeRun) {
        setActiveRunId(response.activeRun.runId);
        setCursor(0);
        setActivity(response.activeRun.currentActivity || 'Reconnecting to the active run...');
        setIsSending(true);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      setConversationId('');
    }
  }, []);

  useEffect(() => { if (user && conversationId) void loadConversation(conversationId); }, [user, conversationId, loadConversation]);

  const applyEvents = useCallback((events: RunEvent[]) => {
    events.forEach((event) => {
      if (event.type === 'activity' || event.type === 'retry_scheduled') setActivity(String(event.payload.label || 'Working...'));
      if (event.type === 'action_bundle') {
        const bundle = event.payload as ActionBundle & { label?: string };
        setActivity(bundle.label || 'Waiting for your confirmation...');
        setMessages((current) => {
          const bundleMessageId = `bundle-${bundle.bundleId}`;
          const withoutDuplicate = current.filter((message) => message.id !== `run-${event.runId}` && message.id !== bundleMessageId && !(message.runId === event.runId && message.bundle));
          return [...withoutDuplicate, { id: bundleMessageId, runId: event.runId, role: 'assistant', content: 'Please review the exact actions below. Nothing will change until you confirm.', bundle }];
        });
      }
      if (event.type === 'completed' || event.type === 'failed') {
        const answer = String(event.payload.answer || (event.type === 'failed' ? 'Mame could not complete this run.' : ''));
        setMessages((current) => {
          const existing = current.find((message) => message.role === 'assistant' && (message.runId === event.runId || message.id === `answer-${event.runId}`));
          const withoutDuplicate = current.filter((message) => message.id !== `run-${event.runId}` && !(message.role === 'assistant' && (message.runId === event.runId || message.id === `answer-${event.runId}`)));
          return [...withoutDuplicate, { id: existing?.id || `answer-${event.runId}`, runId: event.runId, role: 'assistant', content: answer }];
        });
        setActivity(''); setIsSending(false); setActiveRunId('');
      }
      if (event.type === 'cancelled') { setActivity(''); setIsSending(false); setActiveRunId(''); }
    });
  }, []);

  useEffect(() => {
    if (!activeRunId) return;
    let stopped = false;
    let timer = 0;
    let localCursor = cursor;
    let pausedForConfirmation = false;
    let terminal = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const response = await apiAction<RunEventsResponse>('fetchAgentRunEvents', { runId: activeRunId, afterSequence: localCursor });
        localCursor = response.nextCursor;
        setCursor(localCursor);
        applyEvents(response.events);
        pausedForConfirmation = response.status === 'awaiting_confirmation' || response.events.some((event) => event.type === 'action_bundle');
        terminal = response.terminal;
        if (!response.terminal && !pausedForConfirmation && !stopped) timer = window.setTimeout(poll, 1200);
      } catch {
        if (!stopped) timer = window.setTimeout(poll, 2500);
      }
    };

    const controller = new AbortController();
    const stream = async () => {
      const token = getAuthToken();
      const response = await fetch(apiActionUrl('streamAgentRunEvents'), {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ runId: activeRunId, afterSequence: localCursor }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('SSE unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const firstDataTimeout = window.setTimeout(() => controller.abort(), 6000);
      let receivedData = false;
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!receivedData) { receivedData = true; window.clearTimeout(firstDataTimeout); }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const eventName = block.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim();
          const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
          if (eventName === 'terminal') { terminal = true; controller.abort(); break; }
          if (eventName !== 'agent' || !data) continue;
          const parsed = JSON.parse(data) as RunEvent;
          localCursor = Math.max(localCursor, parsed.sequence); setCursor(localCursor); applyEvents([parsed]);
          if (parsed.type === 'action_bundle') { pausedForConfirmation = true; controller.abort(); break; }
          if (parsed.type === 'completed' || parsed.type === 'failed' || parsed.type === 'cancelled') { terminal = true; controller.abort(); break; }
        }
      }
      window.clearTimeout(firstDataTimeout);
    };

    void stream().catch(() => undefined).finally(() => { if (!stopped && !terminal && !pausedForConfirmation) void poll(); });
    return () => { stopped = true; controller.abort(); if (timer) window.clearTimeout(timer); };
  }, [activeRunId, monitorEpoch, applyEvents]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (trimmed === '' || isSending || uploading) return;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: trimmed };
    setMessages((current) => [...current, userMessage]);
    setDraft(''); setIsSending(true); setActivity('Submitting your request...');
    try {
      const response = await apiAction<RunReceipt>('startAgentRun', { message: trimmed, conversationId: conversationId || undefined, attachmentIds: attachments.map((attachment) => attachment.id) }, { timeoutMs: 20000 });
      setConversationId(response.conversationId); localStorage.setItem(STORAGE_KEY, response.conversationId);
      setActiveRunId(response.runId); setCursor(0); setAttachments([]);
      setMessages((current) => current.map((message) => message.id === userMessage.id ? { ...message, runId: response.runId } : message));
      if (response.status === 'completed' && response.answer) applyEvents([{ id: `immediate-${response.runId}`, runId: response.runId, type: 'completed', sequence: response.eventCursor, payload: { answer: response.answer } }]);
      else setMessages((current) => [...current.filter((message) => message.id !== `run-${response.runId}`), { id: `run-${response.runId}`, runId: response.runId, role: 'assistant', content: 'Queued for processing...' }]);
    } catch (error: any) {
      setActivity(''); setIsSending(false);
      setMessages((current) => [...current, { id: `error-${Date.now()}`, role: 'assistant', content: error?.message || 'Unable to start Mame AI right now.' }]);
    }
  };

  const cancelRun = async () => {
    if (!activeRunId) return;
    try { await apiAction('cancelAgentRun', { runId: activeRunId }); setActivity('Cancelling...'); } catch (error: any) { setActivity(error?.message || 'Could not cancel this run.'); }
  };

  const decideBundle = async (bundle: ActionBundle, confirm: boolean) => {
    setIsSending(true); setActivity(confirm ? 'Confirming exact actions...' : 'Rejecting actions...');
    try {
      await apiAction(confirm ? 'confirmAgentActionBundle' : 'rejectAgentActionBundle', confirm ? { bundleId: bundle.bundleId, confirmationToken: bundle.confirmationToken } : { bundleId: bundle.bundleId });
      setMessages((current) => current.map((message) => message.bundle?.bundleId === bundle.bundleId ? { ...message, bundle: undefined, content: confirm ? 'Actions confirmed. Mame is executing and verifying them now.' : 'Actions rejected. No changes were made.' } : message));
      setActivity(confirm ? 'Queued confirmed actions...' : 'Preparing the final answer...');
      setMonitorEpoch((current) => current + 1);
    } catch (error: any) { setActivity(error?.message || 'Could not process this decision.'); setIsSending(false); }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, 3 - attachments.length))) {
        if (!file.type.startsWith('image/') && !file.type.startsWith('audio/')) throw new Error('Only image and audio files are supported.');
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('Could not read the attachment.')); reader.readAsDataURL(file); });
        const uploaded = await apiAction<Attachment>('createAgentAttachment', { fileName: file.name, mimeType: file.type, dataUrl }, { timeoutMs: 30000 });
        setAttachments((current) => [...current, uploaded]);
      }
    } catch (error: any) { setActivity(error?.message || 'Could not upload the attachment.'); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } };
  const closePanel = () => { if (isOpen) setIsClosing(true); };
  useEffect(() => { if (!isClosing) return; const timeout = window.setTimeout(() => { setIsOpen(false); setIsClosing(false); }, 280); return () => window.clearTimeout(timeout); }, [isClosing]);

  const widgetContainer = isMobile ? 'fixed inset-0 z-[100] bg-white' : 'fixed bottom-4 right-[112px] z-[100] w-[380px] h-[580px] rounded-[32px] shadow-2xl';
  const widgetBodyClass = isMobile ? 'flex flex-col h-full' : `${theme.card.elevated} flex flex-col h-full overflow-hidden bg-white`;

  if (!isDeveloper && !hasCapability('enterprise_ai_agent')) return null;

  return <>
    <div className="fixed right-6 bottom-6 z-[90] flex items-center gap-3">
      {!hasOpenedOnce && <div className="flex h-10 items-center rounded-full bg-white px-4 text-xs font-semibold text-slate-900 shadow-lg md:h-12 md:px-5 md:text-sm">Chat with Mame</div>}
      <button type="button" onClick={() => { if (isOpen && !isClosing) closePanel(); else { setHasOpenedOnce(true); setIsClosing(false); setIsOpen(true); } }} className="relative flex h-14 w-14 md:h-[72px] md:w-[72px] items-center justify-center overflow-hidden rounded-full bg-transparent shadow-2xl" aria-label={isOpen ? 'Close chat' : 'Open chat'}><img src="/uploads/Mame%20AI.png" alt="Mame AI" className="h-full w-full object-cover" /></button>
    </div>
    {(isOpen || isClosing) && <div className={`${widgetContainer} ${isClosing ? 'animate-chat-panel-close' : 'animate-chat-panel-enter'}`}>
      {isMobile && <div className="absolute inset-0 bg-black/20" onClick={closePanel} />}
      <div className={`${widgetBodyClass} ${isMobile ? 'relative m-0 rounded-none' : 'bg-white'} ${theme.radius.lg}`}>
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-4">
          <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-[var(--primary-color,#0f2f57)]/10"><img src="/uploads/Avatar.png" alt="Mame avatar" className="h-10 w-10 object-cover" /></div><div><p className="text-sm font-semibold text-gray-900">Mame</p><p className="text-xs text-gray-500">Internal business assistant</p></div></div>
          <div className="flex items-center gap-1">
            {activeRunId && <button type="button" onClick={() => void cancelRun()} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50" title="Cancel active run"><Square size={13} />Cancel</button>}
            <button type="button" onClick={() => { setConversationId(''); localStorage.removeItem(STORAGE_KEY); setMessages([INITIAL_MESSAGE]); setActiveRunId(''); setCursor(0); setActivity(''); setAttachments([]); setIsSending(false); }} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="New chat"><RotateCcw size={16} /></button>
            <button type="button" onClick={closePanel} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Close chat"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden px-4" style={{ minHeight: 0 }}>
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1" style={isMobile ? { maxHeight: chatHeight } : undefined}>
            {messages.map((message, index) => <div key={message.id} className={`flex items-end gap-1 ${message.role === 'user' ? 'justify-end' : 'justify-start'} ${!index && message.role === 'assistant' ? 'mt-5' : ''}`}>
              {message.role === 'assistant' && <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-[var(--primary-color,#0f2f57)]/10 ring-1 ring-[var(--primary-color,#0f2f57)]/20"><img src="/uploads/Avatar.png" alt="Mame avatar" className="h-full w-full object-cover" /></div>}
              <div className={`max-w-[88%] rounded-3xl px-3 py-2 text-sm leading-6 ${message.role === 'user' ? `${theme.colors.primary[600]} rounded-br-[4px] text-white` : 'rounded-bl-[4px] border border-slate-200 bg-[var(--primary-soft,#dbeafe)] text-gray-900 shadow-sm'}`}>
                {renderMessageContent(message.content)}
                {message.bundle && <div className="mt-3 space-y-3 border-t border-slate-300/60 pt-3">
                  {message.bundle.items.map((item) => <div key={item.position} className="rounded-xl bg-white/80 p-3"><p className="font-black text-gray-900">{item.position}. {item.preview?.label || item.toolName}</p>{item.preview?.effect && <p className="mt-1 text-xs font-semibold text-gray-600">{item.preview.effect}</p>}{item.preview?.values && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-gray-600">{JSON.stringify(item.preview.values, null, 2)}</pre>}</div>)}
                  <p className="text-xs font-semibold text-amber-700">Expires {new Date(message.bundle.expiresAt).toLocaleString()}.</p>
                  <div className="flex gap-2"><button type="button" onClick={() => void decideBundle(message.bundle!, true)} className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700">Confirm exact actions</button><button type="button" onClick={() => void decideBundle(message.bundle!, false)} className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-black text-gray-700 hover:bg-gray-50">Reject</button></div>
                </div>}
              </div>
              {message.role === 'user' && <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-gray-100"><img src="/uploads/Empty_avatar.png" alt="Your avatar" className="h-full w-full object-cover" /></div>}
            </div>)}
            {activity && <div className="ml-8 flex items-center gap-2 pb-1 text-xs font-bold text-slate-500"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />{activity}</div>}
            <div ref={messagesEndRef} />
          </div>
        </div>
        <div className="border-t border-gray-200 bg-white px-4 py-2" style={{ paddingBottom: isMobile ? `${keyboardOffset + 14}px` : '12px' }}>
          {attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{attachments.map((attachment) => <span key={attachment.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{attachment.fileName}<button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><X size={12} /></button></span>)}</div>}
          <div className="relative flex items-center border border-gray-200 bg-gray-50 transition focus-within:border-[var(--primary-color,#0f2f57)] focus-within:ring-2 focus-within:ring-[var(--primary-color,#0f2f57)]/20" style={{ borderRadius: `${inputRadius}px`, padding: '10px 88px 10px 44px', minHeight: '44px', maxHeight: '108px' }}>
            <input ref={fileRef} type="file" className="hidden" accept="image/*,audio/*" multiple onChange={(event) => void uploadFiles(event.target.files)} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || attachments.length >= 3 || isSending} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-40" aria-label="Attach image or audio"><Paperclip size={17} /></button>
            <textarea ref={inputRef} rows={1} value={draft} onChange={(event) => { setDraft(event.target.value); adjustTextareaHeight(); }} onKeyDown={handleKeyDown} placeholder="Ask Mame..." className={`w-full resize-none overflow-hidden border-none bg-transparent p-0 text-sm text-gray-900 outline-none ${theme.transitions.normal}`} style={{ minHeight: '24px', maxHeight: '84px', lineHeight: '1.5' }} aria-label="Type your message" />
            <button type="button" onClick={() => void handleSend()} disabled={draft.trim() === '' || isSending || uploading} className={`absolute right-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full ${theme.colors.primary[600]} text-white disabled:cursor-not-allowed disabled:opacity-60`} aria-label="Send message">{isSending || uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Send size={16} />}</button>
          </div>
        </div>
      </div>
    </div>}
  </>;
};

export default MameChat;
