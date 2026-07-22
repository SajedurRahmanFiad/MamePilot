import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  Smile,
  ThumbsUp,
  X,
} from 'lucide-react';
import type { MessengerContact, MessengerMessage } from '../types';
import { useMessengerContacts, useMessengerMessages } from '../src/hooks/useQueries';
import {
  useMarkMessengerConversationRead,
  useSendMessengerCard,
  useSendMessengerMediaMessage,
  useSendMessengerMessage,
  useSendMessengerQuickReplies,
  useSendMessengerReaction,
  useSendMessengerSenderAction,
} from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';

type ContactFilter = 'all' | 'unread';

const EMOJIS = ['😀', '😂', '😍', '🙏', '👍', '❤️', '🎉', '✅', '📦', '🚚', '💳', '☎️'];
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

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

function dateLabel(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-BD', { month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'M';
}

function friendlyError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return message && !/api|webhook|credential|token|configured|curl|http|meta|graph/i.test(message) ? message : fallback;
}

const ContactAvatar: React.FC<{ contact: Pick<MessengerContact, 'name' | 'profilePictureUrl'>; size?: 'sm' | 'md' | 'lg' }> = ({ contact, size = 'md' }) => {
  const classes = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-20 w-20 text-xl' : 'h-12 w-12 text-sm';
  return contact.profilePictureUrl ? <img src={contact.profilePictureUrl} alt="" className={`${classes} shrink-0 rounded-full object-cover`} /> : <div className={`${classes} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 font-black text-[#0866ff]`}>{initials(contact.name)}</div>;
};

const MessageContent: React.FC<{ message: MessengerMessage }> = ({ message }) => {
  if (message.type === 'template') return <div className="min-w-[220px] overflow-hidden rounded-2xl bg-white text-gray-900 shadow-sm">{message.attachmentUrl && <img src={message.attachmentUrl} alt="" className="h-32 w-full object-cover" />}<div className="p-3"><p className="font-black">{message.text || 'Shared card'}</p></div></div>;
  const attachments = message.attachments?.length ? message.attachments : (message.attachmentUrl ? [{ type: message.type, url: message.attachmentUrl }] : []);
  if (attachments.length > 0) {
    return (
      <div className="space-y-1.5">
        {attachments.map((attachment, index) => {
          const type = attachment.type || message.type;
          if ((type === 'image' || type === 'sticker') && attachment.url) return <a key={index} href={attachment.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl"><img src={attachment.url} alt={type === 'sticker' ? 'Sticker' : 'Photo'} className="max-h-96 w-full object-contain" /></a>;
          if (type === 'video' && attachment.url) return <video key={index} src={attachment.url} controls className="max-h-96 w-full rounded-2xl bg-black" />;
          if (type === 'audio' && attachment.url) return <audio key={index} src={attachment.url} controls className="max-w-full" />;
          return <a key={index} href={attachment.url || '#'} target={attachment.url ? '_blank' : undefined} rel="noreferrer" className="flex min-w-[210px] items-center gap-3 rounded-2xl bg-black/5 p-3"><FileText className="shrink-0 text-[#0866ff]" /><div className="min-w-0"><p className="truncate text-sm font-bold">{message.fileName || attachment.title || 'Attachment'}</p><p className="text-xs opacity-60">Open file</p></div></a>;
        })}
        {message.text && !['Photo', 'Video', 'File', 'Voice message', 'Sticker'].includes(message.text) && <p className="whitespace-pre-wrap break-words px-1 text-[15px] leading-relaxed">{message.text}</p>}
      </div>
    );
  }
  if (message.type === 'unsent') return <p className="text-sm italic opacity-60">Message was removed</p>;
  return <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{message.text || `[${message.type}]`}</p>;
};

const MessageBubble: React.FC<{
  message: MessengerMessage;
  repliedMessage?: MessengerMessage;
  onReply: () => void;
  onReact: (reaction: string) => void;
}> = ({ message, repliedMessage, onReply, onReact }) => {
  const outgoing = message.direction === 'outbound';
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <div className={`group flex items-end gap-2 ${outgoing ? 'justify-end' : 'justify-start'}`}>
      {outgoing && <button type="button" onClick={() => setActionsOpen((value) => !value)} className="relative mb-1 rounded-full p-1.5 text-gray-400 opacity-0 transition hover:bg-gray-100 group-hover:opacity-100 focus:opacity-100"><Smile size={16} />{actionsOpen && <div className="absolute bottom-full right-0 z-20 mb-2 flex rounded-full border border-gray-100 bg-white p-1 shadow-xl">{REACTIONS.map((reaction) => <button key={reaction} type="button" onClick={(event) => { event.stopPropagation(); onReact(message.reaction === reaction ? '' : reaction); setActionsOpen(false); }} className="rounded-full p-1.5 text-lg hover:bg-gray-100">{reaction}</button>)}</div>}</button>}
      {outgoing && <button type="button" onClick={onReply} className="mb-1 rounded-full p-1.5 text-gray-400 opacity-0 transition hover:bg-gray-100 group-hover:opacity-100 focus:opacity-100"><Reply size={16} /></button>}
      <div className="relative max-w-[82%] sm:max-w-[70%] lg:max-w-[64%]">
        {repliedMessage && <div className={`mb-1 rounded-2xl px-3 py-2 text-xs ${outgoing ? 'bg-blue-100 text-blue-900' : 'bg-gray-100 text-gray-600'}`}><p className="mb-0.5 font-black">Replying to {repliedMessage.direction === 'outbound' ? 'your Page' : 'customer'}</p><p className="truncate opacity-70">{repliedMessage.text || repliedMessage.fileName || repliedMessage.type}</p></div>}
        <div className={`${outgoing ? 'rounded-[20px] rounded-br-[5px] bg-[#0866ff] text-white' : 'rounded-[20px] rounded-bl-[5px] bg-[#e4e6eb] text-gray-950'} ${message.type === 'image' || message.type === 'sticker' || message.type === 'video' || message.type === 'template' ? 'overflow-hidden p-0' : 'px-3.5 py-2'} shadow-[0_1px_1px_rgba(0,0,0,0.04)]`}>
          <MessageContent message={message} />
        </div>
        {message.quickReplies?.length > 0 && <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">{message.quickReplies.map((reply, index) => <span key={`${reply.title}-${index}`} className="rounded-full border border-[#0866ff] bg-white px-3 py-1 text-xs font-bold text-[#0866ff]">{reply.title}</span>)}</div>}
        {message.reaction && <button type="button" onClick={() => onReact('')} className={`absolute -bottom-3 ${outgoing ? 'right-1' : 'left-1'} rounded-full border-2 border-white bg-white px-1.5 py-0.5 text-sm shadow`}>{message.reaction}</button>}
        <div className={`mt-1 flex items-center gap-1 px-1 text-[10px] text-gray-400 ${outgoing ? 'justify-end' : 'justify-start'}`}><span>{formatTime(message.messageAt)}</span>{outgoing && <Check size={11} className={message.status === 'read' ? 'text-[#0866ff]' : ''} />}{message.status === 'failed' && <AlertCircle size={12} className="text-red-500" />}</div>
        {message.errorMessage && <p className="max-w-sm px-1 text-right text-[11px] font-medium text-red-600">{message.errorMessage}</p>}
      </div>
      {!outgoing && <button type="button" onClick={onReply} className="mb-1 rounded-full p-1.5 text-gray-400 opacity-0 transition hover:bg-gray-100 group-hover:opacity-100 focus:opacity-100"><Reply size={16} /></button>}
      {!outgoing && <button type="button" onClick={() => setActionsOpen((value) => !value)} className="relative mb-1 rounded-full p-1.5 text-gray-400 opacity-0 transition hover:bg-gray-100 group-hover:opacity-100 focus:opacity-100"><Smile size={16} />{actionsOpen && <div className="absolute bottom-full left-0 z-20 mb-2 flex rounded-full border border-gray-100 bg-white p-1 shadow-xl">{REACTIONS.map((reaction) => <button key={reaction} type="button" onClick={(event) => { event.stopPropagation(); onReact(message.reaction === reaction ? '' : reaction); setActionsOpen(false); }} className="rounded-full p-1.5 text-lg hover:bg-gray-100">{reaction}</button>)}</div>}</button>}
    </div>
  );
};

const ChoicesModal: React.FC<{ open: boolean; pending: boolean; onClose: () => void; onSend: (text: string, options: string[]) => void }> = ({ open, pending, onClose, onSend }) => {
  const [text, setText] = useState('');
  const [options, setOptions] = useState(['', '']);
  useEffect(() => { if (!open) { setText(''); setOptions(['', '']); } }, [open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h3 className="text-lg font-black">Send reply choices</h3><p className="mt-1 text-sm text-gray-500">Make it easy for the customer to answer with one tap.</p></div><button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-gray-100"><X size={18} /></button></div><label className="mt-5 block space-y-2 text-sm font-bold"><span>Question</span><textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} rows={3} className="w-full rounded-2xl border border-gray-200 px-4 py-3 outline-none focus:border-[#0866ff]" placeholder="How can we help?" /></label><div className="mt-4 space-y-2">{options.map((option, index) => <div key={index} className="flex gap-2"><input value={option} maxLength={20} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#0866ff]" placeholder={`Choice ${index + 1}`} /><button type="button" disabled={options.length <= 1} onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl p-2.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><X size={16} /></button></div>)}</div>{options.length < 13 && <button type="button" onClick={() => setOptions((current) => [...current, ''])} className="mt-3 inline-flex items-center gap-1.5 text-sm font-black text-[#0866ff]"><Plus size={16} /> Add choice</button>}<button type="button" disabled={pending || !text.trim() || !options.some((option) => option.trim())} onClick={() => onSend(text, options.filter((option) => option.trim()))} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0866ff] px-4 py-3 text-sm font-black text-white disabled:opacity-50">{pending && <Loader2 size={17} className="animate-spin" />} Send choices</button></div></div>;
};

const CardModal: React.FC<{ open: boolean; pending: boolean; onClose: () => void; onSend: (value: { title: string; subtitle: string; imageUrl: string; buttons: Array<{ type: 'web_url' | 'postback'; title: string; value: string }> }) => void }> = ({ open, pending, onClose, onSend }) => {
  const [title, setTitle] = useState(''); const [subtitle, setSubtitle] = useState(''); const [imageUrl, setImageUrl] = useState(''); const [buttons, setButtons] = useState([{ title: '', url: '' }]);
  useEffect(() => { if (!open) { setTitle(''); setSubtitle(''); setImageUrl(''); setButtons([{ title: '', url: '' }]); } }, [open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h3 className="text-lg font-black">Share a card</h3><p className="mt-1 text-sm text-gray-500">Send a product, service, or useful link.</p></div><button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-gray-100"><X size={18} /></button></div><div className="mt-5 space-y-4"><label className="block space-y-2 text-sm font-bold"><span>Title</span><input autoFocus value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-[#0866ff]" /></label><label className="block space-y-2 text-sm font-bold"><span>Description <span className="font-medium text-gray-400">(optional)</span></span><input value={subtitle} maxLength={80} onChange={(event) => setSubtitle(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-[#0866ff]" /></label><label className="block space-y-2 text-sm font-bold"><span>Image link <span className="font-medium text-gray-400">(optional)</span></span><input type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-[#0866ff]" placeholder="https://..." /></label><div><p className="text-sm font-black">Buttons</p><p className="mt-1 text-xs text-gray-500">Leave the link blank to send a simple one-tap response.</p><div className="mt-2 space-y-3">{buttons.map((button, index) => <div key={index} className="grid grid-cols-[1fr_1.4fr_auto] gap-2"><input value={button.title} maxLength={20} onChange={(event) => setButtons((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} className="min-w-0 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#0866ff]" placeholder="Button label" /><input type="url" value={button.url} onChange={(event) => setButtons((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} className="min-w-0 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#0866ff]" placeholder="Link (optional)" /><button type="button" disabled={buttons.length <= 1} onClick={() => setButtons((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><X size={16} /></button></div>)}</div>{buttons.length < 3 && <button type="button" onClick={() => setButtons((current) => [...current, { title: '', url: '' }])} className="mt-3 inline-flex items-center gap-1 text-sm font-black text-[#0866ff]"><Plus size={15} /> Add button</button>}</div></div><button type="button" disabled={pending || !title.trim()} onClick={() => onSend({ title, subtitle, imageUrl, buttons: buttons.filter((button) => button.title.trim()).map((button) => ({ type: button.url.trim() ? 'web_url' : 'postback', title: button.title.trim(), value: button.url.trim() || button.title.trim() })) })} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0866ff] px-4 py-3 text-sm font-black text-white disabled:opacity-50">{pending && <Loader2 size={17} className="animate-spin" />} Share card</button></div></div>;
};

const MessengerPage: React.FC = () => {
  const toast = useToastNotifications();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<ContactFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MessengerMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const contactsQuery = useMessengerContacts({ search: debouncedSearch, filter }, true);
  const contacts = contactsQuery.data?.data || [];
  const messagesQuery = useMessengerMessages(selectedId, Boolean(selectedId));
  const messages = messagesQuery.data?.data || [];
  const selectedContact = messagesQuery.data?.contact || contacts.find((contact) => contact.id === selectedId) || null;
  const markRead = useMarkMessengerConversationRead();
  const sendText = useSendMessengerMessage();
  const sendMedia = useSendMessengerMediaMessage();
  const sendChoices = useSendMessengerQuickReplies();
  const sendCard = useSendMessengerCard();
  const sendReaction = useSendMessengerReaction();
  const senderAction = useSendMessengerSenderAction();
  const busy = sendText.isPending || sendMedia.isPending || sendChoices.isPending || sendCard.isPending;

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { if (!selectedId && contacts.length > 0) setSelectedId(contacts[0].id); }, [contacts, selectedId]);
  useEffect(() => { if (selectedId && selectedContact?.unreadCount) markRead.mutate(selectedId); }, [selectedId, selectedContact?.unreadCount]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, selectedId]);
  useEffect(() => () => { if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current); recorderStreamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  const groupedMessages = useMemo(() => {
    const groups: Array<{ label: string; messages: MessengerMessage[] }> = [];
    messages.forEach((message) => { const label = dateLabel(message.messageAt); const last = groups[groups.length - 1]; if (!last || last.label !== label) groups.push({ label, messages: [message] }); else last.messages.push(message); });
    return groups;
  }, [messages]);
  const messageByMid = useMemo(() => new Map(messages.map((message) => [message.mid, message])), [messages]);

  const stopTyping = () => {
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    if (typingActiveRef.current && selectedId) senderAction.mutate({ contactId: selectedId, senderAction: 'typing_off' });
    typingActiveRef.current = false;
  };
  const notifyTyping = () => {
    if (!selectedId || !selectedContact?.canReply) return;
    if (!typingActiveRef.current) { typingActiveRef.current = true; senderAction.mutate({ contactId: selectedId, senderAction: 'typing_on' }); }
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(stopTyping, 4000);
  };

  const selectContact = (contact: MessengerContact) => { stopTyping(); setSelectedId(contact.id); setMobileChatOpen(true); setReplyingTo(null); };
  const handleSendText = async (text = draft) => {
    if (!selectedId || !text.trim() || busy) return;
    stopTyping();
    try { await sendText.mutateAsync({ contactId: selectedId, text: text.trim(), replyToMid: replyingTo?.mid || undefined }); setDraft(''); setReplyingTo(null); setEmojiOpen(false); }
    catch (error) { toast.error(friendlyError(error, 'Message could not be sent. Please try again.')); }
  };
  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('Could not read the selected file.')); reader.readAsDataURL(file); });
  const sendFile = async (file: File) => {
    if (!selectedId) return;
    try { const dataUrl = await fileToDataUrl(file); await sendMedia.mutateAsync({ contactId: selectedId, dataUrl, fileName: file.name, mimeType: file.type || 'application/octet-stream', replyToMid: replyingTo?.mid || undefined }); setReplyingTo(null); }
    catch (error) { toast.error(friendlyError(error, 'Attachment could not be sent. Please try again.')); }
  };
  const handleFiles = async (files: FileList | null) => { for (const file of Array.from(files || [])) await sendFile(file); if (fileInputRef.current) fileInputRef.current.value = ''; };
  const toggleRecording = async () => {
    if (recording) { recorderRef.current?.stop(); setRecording(false); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast.error('Voice recording is not supported in this browser.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); recorderStreamRef.current = stream; audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream); recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
      recorder.onstop = async () => { const mimeType = (recorder.mimeType || 'audio/webm').split(';')[0]; const blob = new Blob(audioChunksRef.current, { type: mimeType }); stream.getTracks().forEach((track) => track.stop()); recorderStreamRef.current = null; const file = new File([blob], `voice-${Date.now()}.webm`, { type: mimeType }); await sendFile(file); };
      recorder.start(); setRecording(true);
    } catch { toast.error('Microphone access was not available.'); }
  };
  const handleReaction = async (message: MessengerMessage, reaction: string) => { if (!selectedId) return; try { await sendReaction.mutateAsync({ contactId: selectedId, messageId: message.id, reaction }); } catch (error) { toast.error(friendlyError(error, 'Reaction could not be sent. Please try again.')); } };

  if (contactsQuery.error) return <div className="flex h-full items-center justify-center p-8"><div className="max-w-md rounded-3xl border border-red-100 bg-red-50 p-6 text-center"><AlertCircle className="mx-auto text-red-500" /><p className="mt-3 font-black text-red-800">Messenger could not be loaded</p><p className="mt-2 text-sm text-red-700">Please try again. If it still does not work, ask an administrator for help.</p></div></div>;
  if (contactsQuery.data && !contactsQuery.data.configured) return <div className="flex h-full items-center justify-center bg-[#f0f2f5] p-6"><div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#0866ff] text-white"><Send size={28} /></div><h2 className="mt-5 text-2xl font-black text-gray-900">Set up Messenger</h2><p className="mt-2 text-sm leading-relaxed text-gray-500">Messenger is not ready yet. Open settings to finish the setup.</p><Link to="/settings?tab=messenger" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#0866ff] px-5 py-3 text-sm font-black text-white"><Settings size={17} /> Open settings</Link></div></div>;

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-white text-gray-950">
      <aside className={`${mobileChatOpen ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-gray-200 bg-white md:w-[340px] xl:w-[370px]`}>
        <div className="flex items-center justify-between px-4 pb-2 pt-4"><h1 className="text-[27px] font-black tracking-tight">Chats</h1><button type="button" onClick={() => contactsQuery.refetch()} className="rounded-full bg-gray-100 p-2.5 text-gray-700 hover:bg-gray-200" aria-label="Refresh chats"><RefreshCw size={18} className={contactsQuery.isFetching ? 'animate-spin' : ''} /></button></div>
        <div className="px-4 py-2"><div className="flex items-center gap-2 rounded-full bg-[#f0f2f5] px-3 py-2.5"><Search size={17} className="text-gray-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" placeholder="Search Messenger" />{search && <button type="button" onClick={() => setSearch('')}><X size={15} /></button>}</div></div>
        <div className="flex gap-2 px-4 py-2">{(['all', 'unread'] as ContactFilter[]).map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`rounded-full px-4 py-2 text-sm font-black capitalize ${filter === item ? 'bg-blue-50 text-[#0866ff]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{item}</button>)}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {contactsQuery.isPending ? <div className="space-y-2 p-2">{Array.from({ length: 7 }).map((_, index) => <div key={index} className="flex animate-pulse gap-3 rounded-xl p-2"><div className="h-14 w-14 rounded-full bg-gray-100" /><div className="flex-1 space-y-2 py-1"><div className="h-3 w-2/3 rounded bg-gray-100" /><div className="h-3 w-full rounded bg-gray-100" /></div></div>)}</div> : contacts.length === 0 ? <div className="px-6 py-16 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-[#0866ff]"><Search /></div><p className="mt-4 font-black">No chats yet</p><p className="mt-1 text-sm text-gray-500">New messages will appear here.</p></div> : contacts.map((contact) => <button key={contact.id} type="button" onClick={() => selectContact(contact)} className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition ${selectedId === contact.id ? 'bg-[#f0f2f5]' : 'hover:bg-gray-50'}`}><ContactAvatar contact={contact} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className={`truncate text-[15px] ${contact.unreadCount ? 'font-black' : 'font-semibold'}`}>{contact.name}</p><span className={`shrink-0 text-xs ${contact.unreadCount ? 'font-black text-[#0866ff]' : 'text-gray-400'}`}>{formatTime(contact.lastMessageAt)}</span></div><div className="mt-0.5 flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-sm ${contact.unreadCount ? 'font-bold text-gray-900' : 'text-gray-500'}`}>{contact.lastMessagePreview || 'Messenger conversation'}</p>{contact.unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0866ff] px-1.5 text-[10px] font-black text-white">{contact.unreadCount}</span>}</div></div></button>)}
        </div>
      </aside>

      <main className={`${mobileChatOpen ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col bg-white`}>
        {!selectedContact ? <div className="flex flex-1 items-center justify-center bg-white p-6 text-center"><div><div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#0a7cff] to-[#8b5cf6] text-white shadow-xl"><Send size={42} /></div><h2 className="mt-6 text-2xl font-black">Messenger conversations</h2><p className="mt-2 text-sm text-gray-500">Choose a conversation to start replying.</p></div></div> : <>
          <header className="flex h-[65px] shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:px-4"><button type="button" onClick={() => setMobileChatOpen(false)} className="rounded-full p-2 text-[#0866ff] hover:bg-blue-50 md:hidden"><ArrowLeft size={21} /></button><ContactAvatar contact={selectedContact} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-[15px] font-black">{selectedContact.name}</p><p className={`text-xs font-medium ${selectedContact.canReply ? 'text-gray-500' : 'text-amber-600'}`}>{selectedContact.canReply ? 'You can reply' : 'Waiting for a new message'}</p></div><button type="button" onClick={() => setInfoOpen((value) => !value)} className={`rounded-full p-2.5 ${infoOpen ? 'bg-blue-50 text-[#0866ff]' : 'text-[#0866ff] hover:bg-blue-50'}`}><Info size={21} /></button></header>
          {!selectedContact.canReply && <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-center text-xs font-bold text-amber-800">You can reply after this customer sends a new message.</div>}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
            {messagesQuery.isPending ? <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-[#0866ff]" /></div> : <div className="mx-auto max-w-3xl space-y-5">{groupedMessages.map((group) => <section key={group.label} className="space-y-2"><div className="py-2 text-center"><span className="text-xs font-bold text-gray-400">{group.label}</span></div>{group.messages.map((message) => <MessageBubble key={message.id} message={message} repliedMessage={message.replyToMid ? messageByMid.get(message.replyToMid) : undefined} onReply={() => setReplyingTo(message)} onReact={(reaction) => handleReaction(message, reaction)} />)}</section>)}<div ref={messagesEndRef} /></div>}
          </div>
          <footer className="shrink-0 border-t border-gray-100 bg-white px-2 pb-3 pt-2 sm:px-4">
            {replyingTo && <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl bg-gray-50 px-3 py-2"><div className="min-w-0 flex-1 border-l-2 border-[#0866ff] pl-3"><p className="text-xs font-black text-[#0866ff]">Replying to {replyingTo.direction === 'outbound' ? 'your Page' : selectedContact.name}</p><p className="truncate text-xs text-gray-500">{replyingTo.text || replyingTo.fileName || replyingTo.type}</p></div><button type="button" onClick={() => setReplyingTo(null)} className="rounded-full p-1.5 hover:bg-gray-200"><X size={15} /></button></div>}
            <div className="relative mx-auto flex max-w-3xl items-end gap-1.5">
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt" />
              <div className="relative"><button type="button" disabled={!selectedContact.canReply || busy} onClick={() => setMoreOpen((value) => !value)} className="rounded-full p-2.5 text-[#0866ff] hover:bg-blue-50 disabled:opacity-40"><Plus size={22} /></button>{moreOpen && <div className="absolute bottom-full left-0 z-30 mb-2 w-52 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl"><button type="button" onClick={() => { fileInputRef.current?.click(); setMoreOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-gray-50"><Paperclip size={18} className="text-[#0866ff]" /> Add attachment</button><button type="button" onClick={() => { setChoicesOpen(true); setMoreOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-gray-50"><MoreHorizontal size={18} className="text-[#0866ff]" /> Reply choices</button><button type="button" onClick={() => { setCardOpen(true); setMoreOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-gray-50"><ImageIcon size={18} className="text-[#0866ff]" /> Share a card</button></div>}</div>
              <button type="button" disabled={!selectedContact.canReply || busy} onClick={() => fileInputRef.current?.click()} className="hidden rounded-full p-2.5 text-[#0866ff] hover:bg-blue-50 disabled:opacity-40 sm:block"><ImageIcon size={21} /></button>
              <button type="button" disabled={!selectedContact.canReply || busy} onClick={toggleRecording} className={`rounded-full p-2.5 hover:bg-blue-50 disabled:opacity-40 ${recording ? 'animate-pulse bg-red-50 text-red-600' : 'text-[#0866ff]'}`}><Mic size={21} /></button>
              <div className="relative flex min-h-10 min-w-0 flex-1 items-end rounded-[22px] bg-[#f0f2f5] px-3"><textarea value={draft} disabled={!selectedContact.canReply || busy} onChange={(event) => { setDraft(event.target.value); notifyTyping(); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSendText(); } }} rows={1} className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-5 outline-none disabled:cursor-not-allowed" placeholder={selectedContact.canReply ? 'Aa' : 'Waiting for customer'} /><button type="button" disabled={!selectedContact.canReply} onClick={() => setEmojiOpen((value) => !value)} className="mb-1 rounded-full p-1.5 text-[#0866ff] hover:bg-blue-100 disabled:opacity-30"><Smile size={20} /></button>{emojiOpen && <div className="absolute bottom-full right-0 z-30 mb-2 grid w-56 grid-cols-6 gap-1 rounded-2xl border border-gray-100 bg-white p-3 shadow-xl">{EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => { setDraft((current) => current + emoji); notifyTyping(); }} className="rounded-lg p-1 text-xl hover:bg-gray-100">{emoji}</button>)}</div>}</div>
              {draft.trim() ? <button type="button" disabled={busy || !selectedContact.canReply} onClick={() => handleSendText()} className="rounded-full p-2.5 text-[#0866ff] hover:bg-blue-50 disabled:opacity-40">{sendText.isPending ? <Loader2 size={22} className="animate-spin" /> : <Send size={22} fill="currentColor" />}</button> : <button type="button" disabled={busy || !selectedContact.canReply} onClick={() => handleSendText('👍')} className="rounded-full p-2.5 text-[#0866ff] hover:bg-blue-50 disabled:opacity-40"><ThumbsUp size={22} fill="currentColor" /></button>}
            </div>
          </footer>
        </>}
      </main>

      {selectedContact && infoOpen && <aside className="hidden w-[300px] shrink-0 flex-col border-l border-gray-200 bg-white xl:flex"><div className="flex flex-col items-center px-6 pb-6 pt-8"><ContactAvatar contact={selectedContact} size="lg" /><h2 className="mt-3 text-center text-lg font-black">{selectedContact.name}</h2><p className="mt-1 text-sm text-gray-500">Facebook Messenger</p></div><div className="border-t border-gray-100 px-5 py-5"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Conversation</p><div className={`mt-3 rounded-2xl p-4 ${selectedContact.canReply ? 'bg-blue-50 text-blue-900' : 'bg-amber-50 text-amber-900'}`}><p className="text-sm font-black">{selectedContact.canReply ? 'You can reply' : 'Waiting for customer'}</p><p className="mt-1 text-xs leading-relaxed opacity-75">{selectedContact.canReply ? 'You can continue helping this customer here.' : 'They need to send a new message before you can reply.'}</p></div></div><div className="mt-auto border-t border-gray-100 p-5"><Link to="/settings?tab=messenger" className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-3 text-sm font-black text-gray-700 hover:bg-gray-200"><Settings size={16} /> Messenger settings</Link></div></aside>}

      {selectedContact && infoOpen && <div className="absolute inset-0 z-50 flex flex-col bg-white xl:hidden"><header className="flex h-16 items-center gap-3 border-b border-gray-200 px-4"><button type="button" onClick={() => setInfoOpen(false)} className="rounded-full p-2 text-[#0866ff] hover:bg-blue-50"><ArrowLeft size={21} /></button><p className="font-black">Conversation details</p></header><div className="flex flex-1 flex-col overflow-y-auto"><div className="flex flex-col items-center px-6 pb-8 pt-10"><ContactAvatar contact={selectedContact} size="lg" /><h2 className="mt-3 text-center text-xl font-black">{selectedContact.name}</h2><p className="mt-1 text-sm text-gray-500">Facebook Messenger</p></div><div className="border-t border-gray-100 px-6 py-6"><div className={`rounded-2xl p-4 ${selectedContact.canReply ? 'bg-blue-50 text-blue-900' : 'bg-amber-50 text-amber-900'}`}><p className="font-black">{selectedContact.canReply ? 'You can reply' : 'Waiting for customer'}</p><p className="mt-1 text-sm leading-relaxed opacity-75">{selectedContact.canReply ? 'You can continue helping this customer here.' : 'They need to send a new message before you can reply.'}</p></div><Link to="/settings?tab=messenger" className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-3 text-sm font-black text-gray-700"><Settings size={16} /> Messenger settings</Link></div></div></div>}

      <ChoicesModal open={choicesOpen} pending={sendChoices.isPending} onClose={() => setChoicesOpen(false)} onSend={async (text, options) => { if (!selectedId) return; try { await sendChoices.mutateAsync({ contactId: selectedId, text, options: options.map((title) => ({ title })), replyToMid: replyingTo?.mid || undefined }); setChoicesOpen(false); setReplyingTo(null); } catch (error) { toast.error(friendlyError(error, 'Choices could not be sent. Please try again.')); } }} />
      <CardModal open={cardOpen} pending={sendCard.isPending} onClose={() => setCardOpen(false)} onSend={async (card) => { if (!selectedId) return; try { await sendCard.mutateAsync({ contactId: selectedId, ...card, replyToMid: replyingTo?.mid || undefined }); setCardOpen(false); setReplyingTo(null); } catch (error) { toast.error(friendlyError(error, 'Card could not be sent. Please try again.')); } }} />
    </div>
  );
};

export default MessengerPage;
