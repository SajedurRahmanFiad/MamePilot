import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  MoreVertical,
  Edit3,
  Filter,
  Phone,
  Video,
  ArrowLeft,
  Paperclip,
  Smile,
  Mic,
  Send,
  Image as ImageIcon,
  FileText,
  Check,
  CheckCheck,
  Users,
  Camera,
  MessageSquare,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  text?: string;
  time: string;
  sent: boolean;
  read?: boolean;
  type: 'text' | 'image' | 'document' | 'voice';
  imageUrl?: string;
  fileName?: string;
  fileSize?: string;
  voiceDuration?: string;
}

interface ChatContact {
  id: string;
  name: string;
  avatar?: string;
  initials?: string;
  isGroup?: boolean;
  lastMessage: string;
  lastTime: string;
  unread: number;
  online?: boolean;
  typing?: boolean;
  messages: ChatMessage[];
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const demoContacts: ChatContact[] = [
  {
    id: '1',
    name: 'Alexander Sterling',
    avatar: '',
    initials: 'AS',
    lastMessage: 'The quarterly review documents are ready...',
    lastTime: '10:42 AM',
    unread: 2,
    online: true,
    typing: false,
    messages: [
      { id: 'm1', text: 'Hi, did you get a chance to review the Q3 numbers?', time: '10:30 AM', sent: false, type: 'text' },
      { id: 'm2', text: 'Yes, looking good! Revenue is up 12%.', time: '10:35 AM', sent: true, read: true, type: 'text' },
      { id: 'm3', text: 'The quarterly review documents are ready for your final approval. Please check the shared folder.', time: '10:42 AM', sent: false, type: 'text' },
    ],
  },
  {
    id: '2',
    name: 'Design Synergies',
    avatar: '',
    initials: 'DS',
    isGroup: true,
    lastMessage: 'Marcus: I\'ve updated the Figma prototypes...',
    lastTime: 'Yesterday',
    unread: 0,
    online: false,
    messages: [
      { id: 'm1', text: 'Hey team, the new brand guidelines are finalized.', time: '3:15 PM', sent: false, type: 'text' },
      { id: 'm2', text: 'Great work! I\'ll start implementing them in the UI kit.', time: '3:20 PM', sent: true, read: true, type: 'text' },
      { id: 'm3', text: 'I\'ve updated the Figma prototypes with the new Veridian palette.', time: '4:05 PM', sent: false, type: 'text' },
    ],
  },
  {
    id: '3',
    name: 'Elena Rodriguez',
    avatar: '',
    initials: 'ER',
    lastMessage: 'Let\'s schedule the sync for tomorrow at 9 AM.',
    lastTime: 'Yesterday',
    unread: 0,
    online: false,
    messages: [
      { id: 'm1', text: 'Can we move our meeting to Thursday?', time: '2:00 PM', sent: false, type: 'text' },
      { id: 'm2', text: 'Thursday works for me. Morning or afternoon?', time: '2:15 PM', sent: true, read: true, type: 'text' },
      { id: 'm3', text: 'Let\'s schedule the sync for tomorrow at 9 AM.', time: '2:30 PM', sent: false, type: 'text' },
    ],
  },
  {
    id: '4',
    name: 'Tech Innovations HQ',
    avatar: '',
    initials: 'TI',
    isGroup: true,
    lastMessage: 'Sarah invited you to the "Spring Launch" sub-group.',
    lastTime: 'Monday',
    unread: 0,
    online: false,
    messages: [
      { id: 'm1', text: 'Sarah invited you to the "Spring Launch" sub-group.', time: '11:00 AM', sent: false, type: 'text' },
    ],
  },
  {
    id: '5',
    name: 'Jonathan Thorne',
    avatar: '',
    initials: 'JT',
    lastMessage: 'Voice message (0:45)',
    lastTime: 'Oct 24',
    unread: 0,
    online: true,
    messages: [
      { id: 'm1', text: 'Hey, just following up on the API integration.', time: '9:00 AM', sent: false, type: 'text' },
      { id: 'm2', type: 'voice', voiceDuration: '0:45', time: '9:05 AM', sent: false, text: 'Voice message' },
      { id: 'm3', text: 'I\'ll check it out and get back to you.', time: '9:30 AM', sent: true, read: false, type: 'text' },
    ],
  },
  {
    id: '6',
    name: 'Fatima Al-Rashid',
    avatar: '',
    initials: 'FA',
    lastMessage: 'Sent a photo',
    lastTime: 'Oct 22',
    unread: 0,
    online: false,
    messages: [
      { id: 'm1', type: 'image', imageUrl: '', time: '4:30 PM', sent: false, text: 'Here\'s the new storefront design' },
      { id: 'm2', text: 'Looks amazing! Love the color scheme.', time: '4:45 PM', sent: true, read: true, type: 'text' },
    ],
  },
  {
    id: '7',
    name: 'Marcus Chen',
    avatar: '',
    initials: 'MC',
    lastMessage: 'The sprint demo went really well!',
    lastTime: '12:45',
    unread: 0,
    online: true,
    messages: [
      { id: 'm1', text: 'The sprint demo went really well! Stakeholders loved the new features.', time: '12:45 PM', sent: false, type: 'text' },
      { id: 'm2', text: 'That\'s fantastic news! Great job team.', time: '12:50 PM', sent: true, read: true, type: 'text' },
    ],
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const AvatarCircle: React.FC<{ name: string; initials?: string; online?: boolean; size?: 'sm' | 'md' | 'lg' }> = ({
  name,
  initials,
  online,
  size = 'md',
}) => {
  const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-14 h-14 text-base' : 'w-12 h-12 text-sm';
  const dotSize = size === 'lg' ? 'w-3.5 h-3.5' : 'w-3 h-3';
  const colors = [
    'bg-emerald-100 text-emerald-700',
    'bg-blue-100 text-blue-700',
    'bg-purple-100 text-purple-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
    'bg-cyan-100 text-cyan-700',
  ];
  const colorIndex = name.charCodeAt(0) % colors.length;

  return (
    <div className="relative shrink-0">
      <div
        className={`${sizeClasses} ${colors[colorIndex]} rounded-full flex items-center justify-center font-semibold`}
      >
        {initials || name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
      </div>
      {online && (
        <div
          className={`absolute bottom-0 right-0 ${dotSize} bg-green-500 rounded-full border-2 border-white`}
        />
      )}
    </div>
  );
};

const TypingDots: React.FC = () => (
  <div className="flex gap-[3px] items-center">
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        className="w-[5px] h-[5px] bg-emerald-500 rounded-full animate-bounce"
        style={{ animationDelay: `${i * 0.15}s`, animationDuration: '1s' }}
      />
    ))}
  </div>
);

const MessageBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const isSent = message.sent;

  return (
    <div className={`flex ${isSent ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
      <div
        className={`max-w-[75%] md:max-w-[65%] px-3 py-2 rounded-2xl shadow-sm ${
          isSent
            ? 'bg-emerald-600 text-white rounded-br-sm'
            : 'bg-white text-gray-900 border border-gray-100 rounded-bl-sm'
        }`}
      >
        {message.type === 'text' && (
          <>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
            <div className={`flex items-center justify-end gap-1 mt-1 ${isSent ? 'opacity-70' : ''}`}>
              <span className={`text-[10px] ${isSent ? 'text-emerald-100' : 'text-gray-400'}`}>{message.time}</span>
              {isSent && (
                message.read ? (
                  <CheckCheck size={14} className="text-emerald-200" />
                ) : (
                  <Check size={14} className="text-emerald-200" />
                )
              )}
            </div>
          </>
        )}

        {message.type === 'image' && (
          <>
            <div className="rounded-lg overflow-hidden mb-2 bg-gray-100 aspect-video flex items-center justify-center">
              <ImageIcon size={32} className="text-gray-300" />
            </div>
            {message.text && <p className="text-sm leading-relaxed">{message.text}</p>}
            <div className={`flex items-center justify-end gap-1 mt-1 ${isSent ? 'opacity-70' : ''}`}>
              <span className={`text-[10px] ${isSent ? 'text-emerald-100' : 'text-gray-400'}`}>{message.time}</span>
              {isSent && (message.read ? <CheckCheck size={14} className="text-emerald-200" /> : <Check size={14} className="text-emerald-200" />)}
            </div>
          </>
        )}

        {message.type === 'document' && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center text-red-500">
              <FileText size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{message.fileName}</p>
              <p className={`text-[11px] ${isSent ? 'text-emerald-100' : 'text-gray-400'}`}>{message.fileSize}</p>
            </div>
            <div className={`flex items-center gap-1 ${isSent ? 'opacity-70' : ''}`}>
              <span className={`text-[10px] ${isSent ? 'text-emerald-100' : 'text-gray-400'}`}>{message.time}</span>
            </div>
          </div>
        )}

        {message.type === 'voice' && (
          <div className="flex items-center gap-3 min-w-[220px]">
            <button
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                isSent ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              <Mic size={16} />
            </button>
            <div className="flex-1 flex items-center gap-[2px] h-6">
              {Array.from({ length: 14 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-[3px] rounded-full ${isSent ? 'bg-emerald-200' : 'bg-gray-300'}`}
                  style={{ height: `${Math.random() * 16 + 4}px` }}
                />
              ))}
            </div>
            <span className={`text-[11px] shrink-0 ${isSent ? 'text-emerald-100' : 'text-gray-400'}`}>
              {message.voiceDuration}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const WhatsApp: React.FC = () => {
  const [contacts] = useState<ChatContact[]>(demoContacts);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedContact = contacts.find((c) => c.id === selectedContactId) || null;

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedContactId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 128)}px`;
    }
  }, [inputValue]);

  const openChat = (id: string) => {
    setSelectedContactId(id);
  };

  const closeChat = () => {
    setSelectedContactId(null);
  };

  // ─── Chat List Panel ──────────────────────────────────────────────────────

  const chatListPanel = (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-emerald-700 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold">Chats</h1>
          <div className="flex items-center gap-1">
            <button className="p-2 hover:bg-emerald-600 rounded-full transition-colors">
              <Edit3 size={18} />
            </button>
            <button className="p-2 hover:bg-emerald-600 rounded-full transition-colors">
              <MoreVertical size={18} />
            </button>
          </div>
        </div>
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-300" />
          <input
            type="text"
            placeholder="Search or start a new chat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-emerald-600/60 text-white placeholder-emerald-300 rounded-lg pl-10 pr-4 py-2 text-sm outline-none focus:bg-emerald-600 transition-colors"
          />
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 px-4 py-2 border-b border-gray-100">
        <button className="px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-full">
          All
        </button>
        <button className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
          Unread
        </button>
        <button className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
          Groups
        </button>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {filteredContacts.map((contact) => {
          const isActive = contact.id === selectedContactId;
          return (
            <button
              key={contact.id}
              onClick={() => openChat(contact.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                isActive ? 'bg-emerald-50 border-l-4 border-emerald-600' : ''
              }`}
            >
              <AvatarCircle name={contact.name} initials={contact.initials} online={contact.online} />
              <div className="flex-1 min-w-0 border-b border-gray-50 pb-3">
                <div className="flex items-center justify-between mb-0.5">
                  <h3 className="text-sm font-semibold text-gray-900 truncate">{contact.name}</h3>
                  <span className={`text-[11px] shrink-0 ${contact.unread > 0 ? 'text-emerald-600 font-bold' : 'text-gray-400'}`}>
                    {contact.lastTime}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    {contact.typing ? (
                      <span className="text-sm text-emerald-600 font-medium flex items-center gap-1">
                        typing <TypingDots />
                      </span>
                    ) : (
                      <p className="text-sm text-gray-500 truncate">{contact.lastMessage}</p>
                    )}
                  </div>
                  {contact.unread > 0 && (
                    <span className="ml-2 w-5 h-5 bg-emerald-600 text-white text-[11px] font-bold rounded-full flex items-center justify-center shrink-0">
                      {contact.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ─── Chat Area ────────────────────────────────────────────────────────────

  const chatArea = selectedContact ? (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Chat header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-3 shadow-sm">
        {/* Back button - mobile only */}
        <button
          onClick={closeChat}
          className="md:hidden p-1.5 hover:bg-gray-100 rounded-full transition-colors text-emerald-700"
        >
          <ArrowLeft size={20} />
        </button>

        <AvatarCircle name={selectedContact.name} initials={selectedContact.initials} online={selectedContact.online} />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-gray-900 truncate">{selectedContact.name}</h2>
          <p className="text-[11px] text-emerald-600 font-medium">
            {selectedContact.online ? 'online' : 'offline'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
            <Video size={18} />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
            <Phone size={18} />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
            <MoreVertical size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {/* Date divider */}
        <div className="flex justify-center my-2">
          <span className="px-3 py-1 bg-white text-gray-500 text-[11px] font-medium rounded-full shadow-sm border border-gray-100">
            TODAY
          </span>
        </div>
        {selectedContact.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="bg-white border-t border-gray-100 p-3">
        <div className="flex items-end gap-2">
          {/* Attachment menu */}
          <div className="relative">
            <button
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              className="p-2.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors text-gray-500"
            >
              <Paperclip size={18} />
            </button>
            {showAttachMenu && (
              <div className="absolute bottom-14 left-0 bg-white border border-gray-100 shadow-lg rounded-xl p-1.5 w-44 z-20">
                <button className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 rounded-lg text-sm text-gray-700 transition-colors">
                  <ImageIcon size={16} className="text-purple-500" />
                  Photos & Videos
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 rounded-lg text-sm text-gray-700 transition-colors">
                  <Camera size={16} className="text-pink-500" />
                  Camera
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 rounded-lg text-sm text-gray-700 transition-colors">
                  <FileText size={16} className="text-blue-500" />
                  Document
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 rounded-lg text-sm text-gray-700 transition-colors">
                  <Users size={16} className="text-emerald-500" />
                  Contact
                </button>
              </div>
            )}
          </div>

          {/* Input field */}
          <div className="flex-1 bg-gray-50 rounded-2xl flex items-end px-3 py-2 border border-transparent focus-within:border-emerald-300 transition-colors">
            <button className="p-1 text-gray-400 hover:text-emerald-600 transition-colors shrink-0 mb-0.5">
              <Smile size={18} />
            </button>
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type a message..."
              rows={1}
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm resize-none py-1 px-2 max-h-32 outline-none"
            />
          </div>

          {/* Send / Mic button */}
          <button
            className={`p-2.5 rounded-full transition-all ${
              inputValue.trim()
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {inputValue.trim() ? <Send size={18} /> : <Mic size={18} />}
          </button>
        </div>
      </div>
    </div>
  ) : (
    /* Empty state when no chat selected - desktop only */
    <div className="hidden md:flex flex-col items-center justify-center h-full bg-gray-50 text-center px-8">
      <div className="w-64 h-64 rounded-full bg-emerald-50 flex items-center justify-center mb-6">
        <div className="w-40 h-40 rounded-full bg-emerald-100 flex items-center justify-center">
          <MessageSquare size={64} className="text-emerald-300" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">WhatsApp Web</h2>
      <p className="text-sm text-gray-500 max-w-md">
        Send and receive messages without keeping your phone online.
        Use WhatsApp on up to 4 linked devices and 1 phone at the same time.
      </p>
    </div>
  );

  // ─── Layout ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-64px)] bg-white overflow-hidden">
      {/* Desktop: side-by-side layout */}
      {/* Chat list - always visible on desktop, toggled on mobile */}
      <div
        className={`${
          selectedContactId ? 'hidden md:flex' : 'flex'
        } w-full md:w-[360px] md:min-w-[360px] md:max-w-[360px] border-r border-gray-100 flex-col shrink-0`}
      >
        {chatListPanel}
      </div>

      {/* Chat area - full width on mobile when chat selected, flex-1 on desktop */}
      <div
        className={`${
          selectedContactId ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col min-w-0`}
      >
        {chatArea}
      </div>
    </div>
  );
};

export default WhatsApp;
