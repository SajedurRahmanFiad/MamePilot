import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Smile,
  X,
} from 'lucide-react';
import type { WhatsAppContact, WhatsAppMessage } from '../types';
import { useWhatsAppContacts, useWhatsAppMessages, useWhatsAppTemplates } from '../src/hooks/useQueries';
import {
  useCreateWhatsAppConversation,
  useMarkWhatsAppConversationRead,
  useSendWhatsAppMediaMessage,
  useSendWhatsAppMessage,
  useSendWhatsAppTemplate,
} from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';

type ContactFilter = 'all' | 'unread';
type WhatsAppTemplate = { id: string; name: string; language: string; status: string; category: string; components?: any[] };

const EMOJIS = ['😀', '😂', '😍', '🙏', '👍', '❤️', '🎉', '✅', '📦', '🚚', '💳', '☎️'];

function formatTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('en-BD', { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-BD', { month: 'short', day: 'numeric' });
}

function messageDateLabel(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'TODAY';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return date.toLocaleDateString('en-BD', { month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'WA';
}

function friendlySavedMessageName(name: string): string {
  const value = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return value ? value.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Saved message';
}

function friendlyError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return message && !/api|webhook|credential|token|configured|curl|http|meta|business account|graph/i.test(message) ? message : fallback;
}

const ContactAvatar: React.FC<{ contact: Pick<WhatsAppContact, 'name'>; small?: boolean }> = ({ contact, small }) => (
  <div className={`${small ? 'h-9 w-9 text-xs' : 'h-11 w-11 text-sm'} flex shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700`}>
    {initials(contact.name)}
  </div>
);

const MessageStatus: React.FC<{ message: WhatsAppMessage }> = ({ message }) => {
  if (message.direction !== 'outbound') return null;
  if (message.status === 'failed') return <AlertCircle size={13} className="text-red-500" aria-label="Failed" />;
  if (message.status === 'read') return <CheckCheck size={14} className="text-sky-500" aria-label="Read" />;
  if (message.status === 'delivered') return <CheckCheck size={14} className="text-gray-400" aria-label="Delivered" />;
  return <Check size={14} className="text-gray-400" aria-label={message.status || 'Sent'} />;
};

const MessageContent: React.FC<{ message: WhatsAppMessage }> = ({ message }) => {
  const type = message.type;
  if ((type === 'image' || type === 'sticker') && message.mediaUrl) {
    return (
      <>
        <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-gray-100">
          <img src={message.mediaUrl} alt={message.caption || 'WhatsApp image'} className="max-h-80 w-full object-contain" />
        </a>
        {(message.caption || message.text) && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{message.caption || message.text}</p>}
      </>
    );
  }
  if (type === 'video' && message.mediaUrl) {
    return (
      <>
        <video src={message.mediaUrl} controls className="max-h-80 w-full rounded-lg bg-black" />
        {(message.caption || message.text) && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{message.caption || message.text}</p>}
      </>
    );
  }
  if (type === 'audio' && message.mediaUrl) return <audio src={message.mediaUrl} controls className="max-w-full" />;
  if (type === 'document') {
    return (
      <a href={message.mediaUrl || '#'} target={message.mediaUrl ? '_blank' : undefined} rel="noreferrer" className="flex min-w-0 items-center gap-3 rounded-lg bg-black/5 p-3">
        <FileText size={24} className="shrink-0 text-blue-600" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{message.fileName || 'Document'}</p>
          {message.caption && <p className="mt-0.5 truncate text-xs opacity-70">{message.caption}</p>}
        </div>
      </a>
    );
  }
  if (type === 'template') return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">Saved message</p>;
  return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text || message.caption || `[${type}]`}</p>;
};

const MessageBubble: React.FC<{ message: WhatsAppMessage }> = ({ message }) => {
  const outgoing = message.direction === 'outbound';
  return (
    <div className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[86%] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[72%] lg:max-w-[65%] ${outgoing ? 'rounded-br-sm bg-[#d9fdd3] text-gray-900' : 'rounded-bl-sm border border-gray-100 bg-white text-gray-900'}`}>
        <MessageContent message={message} />
        <div className="mt-1 flex items-center justify-end gap-1">
          <span className="text-[10px] text-gray-500">{formatTime(message.messageAt)}</span>
          <MessageStatus message={message} />
        </div>
        {message.errorMessage && <p className="mt-1 max-w-sm text-[11px] font-medium text-red-600">{message.errorMessage}</p>}
      </div>
    </div>
  );
};

const NewConversationModal: React.FC<{
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (phoneNumber: string, name: string) => void;
}> = ({ open, pending, onClose, onSubmit }) => {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  useEffect(() => { if (!open) { setPhone(''); setName(''); } }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onSubmit={(event) => { event.preventDefault(); onSubmit(phone, name); }}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-gray-900">New WhatsApp chat</h3>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <p className="mt-2 text-sm text-gray-500">Use the full number with country code and no leading plus sign.</p>
        <label className="mt-5 block space-y-2 text-sm font-bold text-gray-700">
          <span>WhatsApp number</span>
          <input autoFocus value={phone} onChange={(event) => setPhone(event.target.value)} className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-emerald-500" placeholder="8801XXXXXXXXX" required />
        </label>
        <label className="mt-4 block space-y-2 text-sm font-bold text-gray-700">
          <span>Name <span className="font-normal text-gray-400">(optional)</span></span>
          <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-emerald-500" placeholder="Customer name" />
        </label>
        <button type="submit" disabled={pending || !phone.trim()} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
          {pending && <Loader2 size={17} className="animate-spin" />} Start conversation
        </button>
      </form>
    </div>
  );
};

function templateVariableFields(template: WhatsAppTemplate | undefined): Array<{ key: string; label: string; componentIndex: number; componentType: string; placeholder: string }> {
  const fields: Array<{ key: string; label: string; componentIndex: number; componentType: string; placeholder: string }> = [];
  (template?.components || []).forEach((component, componentIndex) => {
    const componentType = String(component?.type || '').toLowerCase();
    const text = String(component?.text || '');
    const placeholders = Array.from(new Set(Array.from(text.matchAll(/\{\{(\d+)\}\}/g), (match) => match[1]))).sort((a, b) => Number(a) - Number(b));
    placeholders.forEach((placeholder) => fields.push({ key: `${componentIndex}:${placeholder}`, label: `Message detail ${fields.length + 1}`, componentIndex, componentType, placeholder }));
  });
  return fields;
}

const TemplateModal: React.FC<{
  open: boolean;
  templates: WhatsAppTemplate[];
  loading: boolean;
  error?: string;
  pending: boolean;
  onClose: () => void;
  onSend: (template: WhatsAppTemplate, values: Record<string, string>) => void;
}> = ({ open, templates, loading, error, pending, onClose, onSend }) => {
  const [selection, setSelection] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const selected = templates.find((template) => `${template.name}:${template.language}` === selection);
  const fields = useMemo(() => templateVariableFields(selected), [selected]);
  useEffect(() => { if (!open) { setSelection(''); setValues({}); } }, [open]);
  if (!open) return null;
  const hasMediaHeader = (selected?.components || []).some((component) => String(component?.type || '').toLowerCase() === 'header' && String(component?.format || 'text').toLowerCase() !== 'text');
  const missingValue = fields.some((field) => !values[field.key]?.trim());
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h3 className="text-lg font-black text-gray-900">Send a saved message</h3><button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100"><X size={18} /></button></div>
        <p className="mt-2 text-sm text-gray-500">Choose a ready-made message and fill in the requested details.</p>
        {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-emerald-600" /></div> : error ? (
          <div className="mt-5 rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-medium text-red-700">Saved messages could not be loaded. Please try again or ask an administrator for help.</div>
        ) : (
          <>
            <label className="mt-5 block space-y-2 text-sm font-bold text-gray-700">
              <span>Saved message</span>
              <div className="relative">
                <select value={selection} onChange={(event) => { setSelection(event.target.value); setValues({}); }} className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-4 py-3 pr-10 outline-none focus:border-emerald-500">
                  <option value="">Choose a saved message</option>
                  {templates.map((template) => <option key={`${template.id}:${template.language}`} value={`${template.name}:${template.language}`}>{friendlySavedMessageName(template.name)}</option>)}
                </select>
                <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </label>
            {fields.map((field) => (
              <label key={field.key} className="mt-4 block space-y-2 text-sm font-bold text-gray-700">
                <span>{field.label}</span>
                <input value={values[field.key] || ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-emerald-500" />
              </label>
            ))}
            {hasMediaHeader && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-800">This saved message needs a photo or video that cannot be added here. Please choose another one.</p>}
            {!loading && templates.length === 0 && <p className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">No saved messages are available yet.</p>}
            <button type="button" disabled={!selected || missingValue || hasMediaHeader || pending} onClick={() => selected && onSend(selected, values)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
              {pending && <Loader2 size={17} className="animate-spin" />} Send saved message
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const WhatsApp: React.FC = () => {
  const toast = useToastNotifications();
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<ContactFilter>('all');
  const [text, setText] = useState('');
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showEmojiMenu, setShowEmojiMenu] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const shouldStickToBottom = useRef(true);
  const previousContactId = useRef<string | null>(null);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);

  const contactsQuery = useWhatsAppContacts({ search: debouncedSearch, filter }, true);
  const contacts = contactsQuery.data?.data || [];
  const configured = contactsQuery.data?.configured ?? true;
  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) || null;
  const messagesQuery = useWhatsAppMessages(selectedContactId, Boolean(selectedContactId));
  const messages = messagesQuery.data?.data || [];
  const templatesQuery = useWhatsAppTemplates(showTemplates);
  const createConversation = useCreateWhatsAppConversation();
  const markRead = useMarkWhatsAppConversationRead();
  const sendText = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMediaMessage();
  const sendTemplate = useSendWhatsAppTemplate();
  const sending = sendText.isPending || sendMedia.isPending || sendTemplate.isPending;

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    const contactChanged = previousContactId.current !== selectedContactId;
    if (contactChanged || shouldStickToBottom.current) container.scrollTop = container.scrollHeight;
    previousContactId.current = selectedContactId;
  }, [selectedContactId, messages.length, messages[messages.length - 1]?.status]);

  useEffect(() => {
    if (selectedContact && selectedContact.unreadCount > 0 && !markRead.isPending) markRead.mutate(selectedContact.id);
  }, [selectedContact?.id, selectedContact?.unreadCount]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
  }, [text]);

  const submitText = async () => {
    const body = text.trim();
    if (!selectedContactId || !body || sendText.isPending) return;
    try {
      await sendText.mutateAsync({ contactId: selectedContactId, text: body });
      setText(''); shouldStickToBottom.current = true;
    } catch (error) {
      toast.error(friendlyError(error, 'Could not send the message. Please try again.'));
    }
  };

  const selectFile = async (file: File | undefined) => {
    setShowAttachmentMenu(false);
    if (!file || !selectedContactId) return;
    if (file.size > 16 * 1024 * 1024) { toast.error('Select a file smaller than 16 MB.'); return; }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      await sendMedia.mutateAsync({ contactId: selectedContactId, dataUrl, fileName: file.name, mimeType: file.type || 'application/octet-stream' });
      shouldStickToBottom.current = true;
    } catch (error) {
      toast.error(friendlyError(error, 'Could not send the attachment. Please try again.'));
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = '';
      if (documentInputRef.current) documentInputRef.current.value = '';
    }
  };

  const startConversation = async (phoneNumber: string, name: string) => {
    try {
      const contact = await createConversation.mutateAsync({ phoneNumber, name: name.trim() || undefined });
      setSelectedContactId(contact.id); setShowNewChat(false); shouldStickToBottom.current = true;
    } catch (error) { toast.error(friendlyError(error, 'Could not start the conversation. Please try again.')); }
  };

  const submitTemplate = async (template: WhatsAppTemplate, values: Record<string, string>) => {
    if (!selectedContactId) return;
    const fields = templateVariableFields(template);
    const grouped = new Map<number, { type: string; parameters: Array<{ type: 'text'; text: string }> }>();
    fields.forEach((field) => {
      const group = grouped.get(field.componentIndex) || { type: field.componentType, parameters: [] };
      group.parameters.push({ type: 'text', text: values[field.key].trim() }); grouped.set(field.componentIndex, group);
    });
    try {
      await sendTemplate.mutateAsync({ contactId: selectedContactId, templateName: template.name, languageCode: template.language, components: Array.from(grouped.values()) });
      setShowTemplates(false); shouldStickToBottom.current = true;
    } catch (error) { toast.error(friendlyError(error, 'Could not send the saved message. Please try again.')); }
  };

  const listPanel = (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 bg-emerald-700 px-4 pb-3 pt-4 text-white">
        <div className="mb-3 flex items-center justify-between">
          <div><h1 className="text-lg font-black">WhatsApp</h1><p className="text-[11px] font-medium text-emerald-100">Customer conversations</p></div>
          <div className="flex items-center gap-1">
            <button onClick={() => contactsQuery.refetch()} className="rounded-full p-2 hover:bg-emerald-600" aria-label="Refresh chats"><RefreshCw size={18} className={contactsQuery.isFetching ? 'animate-spin' : ''} /></button>
            <button onClick={() => setShowNewChat(true)} className="rounded-full p-2 hover:bg-emerald-600" aria-label="New chat"><Plus size={20} /></button>
          </div>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-200" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats or numbers" className="w-full rounded-lg bg-emerald-600/70 py-2 pl-10 pr-4 text-sm text-white outline-none placeholder:text-emerald-200 focus:bg-emerald-600" />
        </div>
      </div>
      <div className="flex shrink-0 gap-2 border-b border-gray-100 px-4 py-2">
        {(['all', 'unread'] as ContactFilter[]).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${filter === value ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{value}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {contactsQuery.isPending ? Array.from({ length: 6 }).map((_, index) => <div key={index} className="flex animate-pulse gap-3 px-4 py-3"><div className="h-11 w-11 rounded-full bg-gray-100" /><div className="flex-1"><div className="mt-1 h-3 w-1/2 rounded bg-gray-100" /><div className="mt-3 h-3 w-4/5 rounded bg-gray-100" /></div></div>) : contactsQuery.isError ? (
          <div className="p-6 text-center"><AlertCircle className="mx-auto text-red-400" /><p className="mt-3 text-sm font-bold text-gray-700">Could not load chats</p><p className="mt-1 text-xs text-red-600">Please try again. If it still does not work, ask an administrator for help.</p></div>
        ) : contacts.length === 0 ? (
          <div className="flex h-full min-h-56 flex-col items-center justify-center px-8 text-center"><MessageSquare size={36} className="text-gray-200" /><p className="mt-4 text-sm font-bold text-gray-700">No conversations yet</p><p className="mt-1 text-xs leading-relaxed text-gray-400">New messages will appear here. You can also start a chat with a customer.</p></div>
        ) : contacts.map((contact) => (
          <button key={contact.id} onClick={() => { setSelectedContactId(contact.id); shouldStickToBottom.current = true; }} className={`flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50 ${selectedContactId === contact.id ? 'bg-emerald-50' : ''}`}>
            <ContactAvatar contact={contact} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2"><h3 className="truncate text-sm font-bold text-gray-900">{contact.name}</h3><span className={`shrink-0 text-[10px] ${contact.unreadCount ? 'font-bold text-emerald-600' : 'text-gray-400'}`}>{formatTime(contact.lastMessageAt)}</span></div>
              <div className="mt-1 flex items-center justify-between gap-2"><p className="truncate text-xs text-gray-500">{contact.lastMessageType === 'template' ? 'Saved message' : (contact.lastMessagePreview || contact.phoneNumber)}</p>{contact.unreadCount > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">{contact.unreadCount > 99 ? '99+' : contact.unreadCount}</span>}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const chatPanel = selectedContactId ? (
    <div className="flex h-full min-h-0 flex-col bg-[#efeae2]">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3 shadow-sm">
        <button onClick={() => setSelectedContactId(null)} className="rounded-full p-2 text-emerald-700 hover:bg-gray-100 md:hidden"><ArrowLeft size={20} /></button>
        {selectedContact ? <ContactAvatar contact={selectedContact} small /> : <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100" />}
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-black text-gray-900">{selectedContact?.name || messagesQuery.data?.contact.name || 'WhatsApp contact'}</h2><p className="truncate text-[11px] text-gray-500">+{selectedContact?.phoneNumber || messagesQuery.data?.contact.phoneNumber || ''}</p></div>
        <button onClick={() => setShowTemplates(true)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50">Saved message</button>
      </div>

      <div ref={messagesRef} onScroll={(event) => { const element = event.currentTarget; shouldStickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120; }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
        {messagesQuery.isPending ? <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></div> : messagesQuery.isError ? <div className="mx-auto mt-8 max-w-md rounded-xl bg-white p-5 text-center shadow-sm"><AlertCircle className="mx-auto text-red-400" /><p className="mt-2 text-sm font-bold text-red-700">Messages could not be loaded. Please try again.</p></div> : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center"><div className="max-w-sm rounded-xl bg-white/90 p-5 text-center shadow-sm"><p className="text-sm font-bold text-gray-800">No messages in this conversation</p><p className="mt-1 text-xs leading-relaxed text-gray-500">Send a message to start the conversation.</p></div></div>
        ) : (
          <div className="space-y-2">
            {messages.map((message, index) => {
              const label = messageDateLabel(message.messageAt);
              const previousLabel = index > 0 ? messageDateLabel(messages[index - 1].messageAt) : '';
              return <React.Fragment key={message.id}>{label !== previousLabel && <div className="flex justify-center py-2"><span className="rounded-lg bg-white/90 px-3 py-1 text-[10px] font-bold text-gray-500 shadow-sm">{label}</span></div>}<MessageBubble message={message} /></React.Fragment>;
            })}
          </div>
        )}
      </div>

      <div className="relative shrink-0 border-t border-gray-200 bg-white px-3 py-2">
        <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} />
        <input ref={documentInputRef} type="file" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} />
        {showAttachmentMenu && <div className="absolute bottom-16 left-3 z-20 w-48 rounded-xl border border-gray-100 bg-white p-1.5 shadow-xl"><button onClick={() => imageInputRef.current?.click()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"><ImageIcon size={17} className="text-purple-500" />Photo, video or audio</button><button onClick={() => documentInputRef.current?.click()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"><FileText size={17} className="text-blue-500" />Document</button></div>}
        {showEmojiMenu && <div className="absolute bottom-16 left-12 z-20 grid w-64 grid-cols-6 gap-1 rounded-xl border border-gray-100 bg-white p-3 shadow-xl">{EMOJIS.map((emoji) => <button key={emoji} onClick={() => { setText((current) => current + emoji); setShowEmojiMenu(false); textareaRef.current?.focus(); }} className="rounded p-1 text-xl hover:bg-gray-100">{emoji}</button>)}</div>}
        <div className="flex items-end gap-2">
          <button disabled={sending} onClick={() => { setShowAttachmentMenu((value) => !value); setShowEmojiMenu(false); }} className="rounded-full p-2.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50"><Paperclip size={19} /></button>
          <button disabled={sending} onClick={() => { setShowEmojiMenu((value) => !value); setShowAttachmentMenu(false); }} className="rounded-full p-2.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50"><Smile size={19} /></button>
          <div className="flex min-h-10 min-w-0 flex-1 items-end rounded-2xl bg-gray-50 px-3 py-2 ring-1 ring-gray-100 focus-within:ring-emerald-300">
            <textarea ref={textareaRef} rows={1} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitText(); } }} disabled={sending} placeholder="Type a message" className="max-h-[120px] min-h-5 w-full resize-none bg-transparent text-sm leading-5 outline-none disabled:opacity-50" />
          </div>
          <button onClick={submitText} disabled={!text.trim() || sending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}</button>
        </div>
      </div>
    </div>
  ) : (
    <div className="hidden h-full flex-col items-center justify-center bg-gray-50 px-8 text-center md:flex">
      {!configured ? <><div className="flex h-28 w-28 items-center justify-center rounded-full bg-amber-50"><Settings size={42} className="text-amber-400" /></div><h2 className="mt-6 text-xl font-black text-gray-800">Set up WhatsApp</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-gray-500">WhatsApp is not ready yet. Open settings to finish the setup.</p><Link to="/settings?tab=whatsapp" className="mt-5 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700">Open settings</Link></> : <><div className="flex h-32 w-32 items-center justify-center rounded-full bg-emerald-50"><MessageSquare size={52} className="text-emerald-300" /></div><h2 className="mt-6 text-xl font-black text-gray-800">WhatsApp conversations</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-gray-500">Choose a conversation or start a new chat with a customer.</p></>}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-white">
      <div className={`${selectedContactId ? 'hidden md:flex' : 'flex'} h-full min-h-0 w-full shrink-0 flex-col border-r border-gray-100 md:w-[360px] md:min-w-[360px]`}>{listPanel}</div>
      <div className={`${selectedContactId ? 'flex' : 'hidden md:flex'} h-full min-h-0 min-w-0 flex-1 flex-col`}>{chatPanel}</div>
      <NewConversationModal open={showNewChat} pending={createConversation.isPending} onClose={() => setShowNewChat(false)} onSubmit={startConversation} />
      <TemplateModal open={showTemplates} templates={(templatesQuery.data?.data || []) as WhatsAppTemplate[]} loading={templatesQuery.isPending} error={templatesQuery.error?.message} pending={sendTemplate.isPending} onClose={() => setShowTemplates(false)} onSend={submitTemplate} />
    </div>
  );
};

export default WhatsApp;
