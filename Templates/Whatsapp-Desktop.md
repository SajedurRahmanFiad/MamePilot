<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>ProChat | Premium Messaging</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            "colors": {
                    "on-primary-fixed": "#00201c",
                    "inverse-on-surface": "#f3f0ef",
                    "surface-dim": "#dcd9d9",
                    "tertiary-fixed": "#8ff4e3",
                    "error-container": "#ffdad6",
                    "tertiary-container": "#005e54",
                    "surface-tint": "#1c695f",
                    "secondary-fixed": "#66ff8e",
                    "on-background": "#1c1b1b",
                    "error": "#ba1a1a",
                    "on-primary": "#ffffff",
                    "on-surface-variant": "#3f4946",
                    "primary-container": "#075e54",
                    "primary": "#00453d",
                    "on-tertiary-container": "#73d8c8",
                    "on-primary-container": "#8dd5c8",
                    "surface": "#fcf9f8",
                    "primary-fixed-dim": "#8cd4c7",
                    "background": "#fcf9f8",
                    "on-primary-fixed-variant": "#005047",
                    "on-tertiary-fixed": "#00201c",
                    "on-tertiary": "#ffffff",
                    "outline-variant": "#bec9c5",
                    "surface-container-high": "#ebe7e7",
                    "on-tertiary-fixed-variant": "#005047",
                    "surface-variant": "#e5e2e1",
                    "inverse-primary": "#8cd4c7",
                    "inverse-surface": "#313030",
                    "surface-bright": "#fcf9f8",
                    "on-error-container": "#93000a",
                    "surface-container": "#f0edec",
                    "secondary": "#006d2f",
                    "surface-container-lowest": "#ffffff",
                    "on-secondary": "#ffffff",
                    "secondary-fixed-dim": "#3de273",
                    "primary-fixed": "#a8f0e3",
                    "on-secondary-fixed-variant": "#005322",
                    "surface-container-highest": "#e5e2e1",
                    "surface-container-low": "#f6f3f2",
                    "tertiary-fixed-dim": "#72d8c8",
                    "on-secondary-container": "#007232",
                    "on-surface": "#1c1b1b",
                    "tertiary": "#00443d",
                    "on-error": "#ffffff",
                    "on-secondary-fixed": "#002109",
                    "outline": "#6f7976",
                    "secondary-container": "#5dfd8a"
            },
            "borderRadius": {
                    "DEFAULT": "0.25rem",
                    "lg": "0.5rem",
                    "xl": "0.75rem",
                    "full": "9999px"
            },
            "spacing": {
                    "xs": "4px",
                    "sidebar-width": "360px",
                    "lg": "24px",
                    "sm": "8px",
                    "md": "16px",
                    "xl": "32px",
                    "chat-max-width": "800px",
                    "unit": "4px"
            },
            "fontFamily": {
                    "body-md": ["Inter"],
                    "label-md": ["Inter"],
                    "label-xs": ["Inter"],
                    "headline-sm": ["Inter"],
                    "display-sm": ["Inter"],
                    "body-sm": ["Inter"]
            },
            "fontSize": {
                    "body-md": ["16px", {"lineHeight": "24px", "fontWeight": "400"}],
                    "label-md": ["13px", {"lineHeight": "16px", "letterSpacing": "0.01em", "fontWeight": "500"}],
                    "label-xs": ["11px", {"lineHeight": "14px", "letterSpacing": "0.04em", "fontWeight": "600"}],
                    "headline-sm": ["18px", {"lineHeight": "24px", "letterSpacing": "-0.01em", "fontWeight": "600"}],
                    "display-sm": ["24px", {"lineHeight": "32px", "letterSpacing": "-0.02em", "fontWeight": "600"}],
                    "body-sm": ["14px", {"lineHeight": "20px", "fontWeight": "400"}]
            }
          },
        },
      }
    </script>
<style>
      .material-symbols-outlined {
        font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      }
      .typing-dot {
        animation: typing 1.4s infinite ease-in-out both;
      }
      .typing-dot:nth-child(1) { animation-delay: -0.32s; }
      .typing-dot:nth-child(2) { animation-delay: -0.16s; }
      @keyframes typing {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
      }
      .custom-scrollbar::-webkit-scrollbar { width: 4px; }
      .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
      .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e2e1; border-radius: 10px; }
      .message-in-transition { animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
      @keyframes slideIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>
</head>
<body class="bg-background font-body-md text-on-surface overflow-hidden h-screen flex">
<!-- Rail Sidebar Component (Shared Component: SideNavBar) -->
<aside class="w-20 h-screen bg-surface-container-low border-r border-outline-variant flex flex-col items-center py-lg shrink-0">
<div class="mb-xl">
<div class="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
<span class="material-symbols-outlined text-on-primary" data-icon="chat">chat</span>
</div>
</div>
<nav class="flex flex-col gap-sm flex-1">
<button class="w-12 h-12 rounded-full flex items-center justify-center text-primary bg-primary-container/10 border-l-4 border-primary transition-transform active:scale-95">
<span class="material-symbols-outlined" data-icon="chat" style="font-variation-settings: 'FILL' 1;">chat</span>
</button>
<button class="w-12 h-12 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-highest transition-colors">
<span class="material-symbols-outlined" data-icon="status_heart">settings_heart</span>
</button>
<button class="w-12 h-12 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-highest transition-colors">
<span class="material-symbols-outlined" data-icon="groups">groups</span>
</button>
<button class="w-12 h-12 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-highest transition-colors">
<span class="material-symbols-outlined" data-icon="call">call</span>
</button>
</nav>
<div class="mt-auto flex flex-col gap-sm">
<button class="w-12 h-12 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-highest transition-colors">
<span class="material-symbols-outlined" data-icon="settings">settings</span>
</button>
<img class="w-10 h-10 rounded-full border border-outline-variant object-cover" data-alt="A professional close-up headshot of a senior executive woman with a friendly expression. She has short, styled hair and is wearing a dark charcoal blazer. The background is a blurred high-end office environment with soft morning light filtering through large windows, maintaining a clean and minimalist aesthetic." src="https://lh3.googleusercontent.com/aida-public/AB6AXuC7HbuujkAQeI3Jw7DGLB0ZQWdfbaZc7rbyZ0va70rZBSXbK-axPnUJwZayS4myTNsslaySo1aBTNJpUfqLlD0QSAnNIlAGf_OgzgY_dcHr6pEODplEAwUlUV6kV3ncEUw29mqk8yeAhftcetobvJ0qKu7LK60YW4t5b3NL0-AGTNL4WecD8TcJckgDLNyBR-48nw6DoDAAmewX03Gd3mn0EPD80VbVCHPv-vE1O0N8aFD4YBUB7aAfjg"/>
</div>
</aside>
<!-- Chat List Sidebar -->
<section class="w-sidebar-width h-screen bg-surface border-r border-outline-variant flex flex-col shrink-0">
<header class="p-lg flex flex-col gap-md bg-surface/80 backdrop-blur-md sticky top-0 z-10">
<div class="flex justify-between items-center">
<h1 class="font-headline-sm text-headline-sm font-bold text-on-surface">Chats</h1>
<div class="flex gap-xs">
<button class="p-2 hover:bg-surface-container-highest rounded-full transition-colors">
<span class="material-symbols-outlined text-outline" data-icon="edit_square">edit_square</span>
</button>
<button class="p-2 hover:bg-surface-container-highest rounded-full transition-colors">
<span class="material-symbols-outlined text-outline" data-icon="filter_list">filter_list</span>
</button>
</div>
</div>
<div class="relative">
<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm" data-icon="search">search</span>
<input class="w-full bg-surface-container border-none rounded-lg pl-10 pr-4 py-2 text-label-md focus:ring-1 focus:ring-primary outline-none" placeholder="Search or start a new chat" type="text"/>
</div>
</header>
<div class="flex-1 overflow-y-auto custom-scrollbar">
<!-- Active Chat -->
<div class="px-md py-xs">
<div class="flex items-center gap-md p-md rounded-xl bg-surface-container-highest/50 border-l-4 border-primary relative cursor-pointer group">
<img class="w-12 h-12 rounded-full object-cover shrink-0" data-alt="A minimalist logo for a company named Veridian Global, featuring a stylized emerald green leaf integrated into a subtle globe outline. The design is sleek, modern, and corporate, presented as a circular profile icon against a clean white background, reflecting sustainability and professional excellence." src="https://lh3.googleusercontent.com/aida-public/AB6AXuCvJgqJ3DRtkwoMN0whOZyLwYkXg_BDmtiLhLjX3sRlHTVbkllv_LYRcgQO25X-DlAcKXDk6xzIX3vb4_Nwppdl-kbxl-dsRat18CsSvWUTIDm4hrCjR4ejmixfrR4Kv_nNGqqkEfowEt6UWKCBkT5nHvsQ_Ps1excbaL-IIAoWZXi6RN7ayOA_3EzHdI__EckBcFdNXwArNco6L2l9tblHHvNAdlPXGLtz0wCEa8oi1ipHEgoBwTNJHA"/>
<div class="flex-1 min-w-0">
<div class="flex justify-between items-center mb-xs">
<h3 class="font-label-md text-label-md font-bold text-on-surface truncate">Veridian Global</h3>
<span class="text-xs text-primary font-bold">14:02</span>
</div>
<div class="flex items-center gap-1">
<span class="text-label-md text-primary font-medium truncate">typing</span>
<div class="flex gap-[2px]">
<div class="w-1 h-1 bg-primary rounded-full typing-dot"></div>
<div class="w-1 h-1 bg-primary rounded-full typing-dot"></div>
<div class="w-1 h-1 bg-primary rounded-full typing-dot"></div>
</div>
</div>
</div>
</div>
</div>
<!-- Contact 2 -->
<div class="px-md py-xs">
<div class="flex items-center gap-md p-md rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer group">
<img class="w-12 h-12 rounded-full object-cover shrink-0" data-alt="A portrait of a young male software developer with glasses, wearing a casual light grey hoodie. He is sitting in a minimalist tech workspace with soft ambient purple and blue lighting in the background. The aesthetic is clean, modern, and professional with a shallow depth of field focusing on his friendly face." src="https://lh3.googleusercontent.com/aida-public/AB6AXuD7AgkirCk9iOblbOzpi1hFk-P1JdT8QRidcSvlJLgVGluOJ74-aIsXs6wlCf_hyaipeZ9leBvT4z5Z-feegE-Ky1ZevkwglLuugrXgUJ3vaMt6iOLBctuh1UfM5bzPlwxA3dBHXnun-MEg_0-_ktHd3nIwGkVCvMmqlsVYuOmU0GW_hoxgcLkRpNhr3RX_LZ7SyBX-T7eRqzM7aw4UBTFYfxLYyidNiy0_n6UqD1NRdqqekPQ5q1cE-g"/>
<div class="flex-1 min-w-0">
<div class="flex justify-between items-center mb-xs">
<h3 class="font-label-md text-label-md font-bold text-on-surface truncate">Marcus Chen</h3>
<span class="text-xs text-outline">12:45</span>
</div>
<p class="text-label-md text-on-surface-variant truncate">The sprint demo went really well!</p>
</div>
</div>
</div>
<!-- Contact 3 -->
<div class="px-md py-xs">
<div class="flex items-center gap-md p-md rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer group">
<div class="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center shrink-0">
<span class="material-symbols-outlined text-on-secondary-container" data-icon="groups">groups</span>
</div>
<div class="flex-1 min-w-0">
<div class="flex justify-between items-center mb-xs">
<h3 class="font-label-md text-label-md font-bold text-on-surface truncate">Product Design Sync</h3>
<span class="text-xs text-outline">Yesterday</span>
</div>
<p class="text-label-md text-on-surface-variant truncate">Sarah: Please review the latest Figma link...</p>
</div>
<div class="w-5 h-5 bg-secondary rounded-full flex items-center justify-center">
<span class="text-[10px] text-on-secondary font-bold">3</span>
</div>
</div>
</div>
<!-- Contact 4 -->
<div class="px-md py-xs">
<div class="flex items-center gap-md p-md rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer group">
<img class="w-12 h-12 rounded-full object-cover shrink-0" data-alt="A professional woman with curly dark hair, wearing a white silk blouse and gold earrings. She is in a high-end minimalist apartment with large windows overlooking a blurred city skyline at dusk. The lighting is warm and atmospheric, emphasizing a premium and sophisticated lifestyle aesthetic." src="https://lh3.googleusercontent.com/aida-public/AB6AXuBph4Im1Z_y-ofk7LGIfdZ_HndO72ZJIUCb7dRlvfjykQvsi-U0gAidPWjFRA-11wZ59e5K_HbQbkrxA08DIRlNCKUMvJZz-cLbN4BayetCXLzD53PgxGbfT8nSqaXDks4TuqRuwHwW_owsPtNFr8PwKChyAHzhh6B8gFO1L1rkjuxnrQmSNEhg-H1qvje7VYQEiIWaWsto5dg1sciGbErSDHkIQW3ESIW7pR2yR7xHlEf-azvwUkZZPg"/>
<div class="flex-1 min-w-0">
<div class="flex justify-between items-center mb-xs">
<h3 class="font-label-md text-label-md font-bold text-on-surface truncate">Elena Rodriguez</h3>
<span class="text-xs text-outline">Yesterday</span>
</div>
<div class="flex items-center gap-xs">
<span class="material-symbols-outlined text-sm text-outline" data-icon="photo">photo</span>
<p class="text-label-md text-on-surface-variant truncate">Sent a photo</p>
</div>
</div>
</div>
</div>
</div>
</section>
<!-- Main Chat Content -->
<main class="flex-1 h-screen flex flex-col relative bg-surface-container-lowest">
<!-- Chat Header (Shared Component: TopAppBar) -->
<header class="h-16 flex justify-between items-center px-lg bg-surface/80 backdrop-blur-md border-b border-outline-variant sticky top-0 z-40">
<div class="flex items-center gap-md">
<div class="relative">
<img class="w-10 h-10 rounded-full object-cover" data-alt="Close up of the Veridian Global corporate logo on a circular background. The logo uses deep emerald greens and crisp white, representing trust and sustainability. High-end minimalist design with premium lighting effects." src="https://lh3.googleusercontent.com/aida-public/AB6AXuAPHYqdcE5y11bY5AY1mIXWtpTFsa6nESLz-eG6jq2NjT0TtAfvhn1vPPOZxJfgkljI1NPAEgfuBRgNn-BBrH-0CzoqKQJZHIUMvTaQSA0T0Ys7QHhnsu7GYWUG2yQUm_pe2PpL9GccdFfFRPABcaHjqx71hJSQaIfTAaTuOTB1QDn-BOxvkw528q5mBSLBIYfII7ml0f8fHVCw_cqWL501zmwgdiu7pa8QAhs4vmttToxvB6yvzNkCSw"/>
<div class="absolute bottom-0 right-0 w-3 h-3 bg-secondary rounded-full border-2 border-surface"></div>
</div>
<div>
<h2 class="font-headline-sm text-headline-sm font-bold text-on-surface leading-tight">Veridian Global</h2>
<div class="flex items-center gap-1">
<p class="text-xs text-secondary font-medium">Online</p>
<span class="text-xs text-outline mx-1">•</span>
<div class="flex gap-[2px]">
<div class="w-1 h-1 bg-primary rounded-full typing-dot"></div>
<div class="w-1 h-1 bg-primary rounded-full typing-dot"></div>
<div class="w-1 h-1 bg-primary rounded-full typing-dot"></div>
</div>
</div>
</div>
</div>
<div class="flex items-center gap-sm">
<button class="p-2 hover:bg-surface-variant/50 rounded-full transition-all text-on-surface-variant">
<span class="material-symbols-outlined" data-icon="videocam">videocam</span>
</button>
<button class="p-2 hover:bg-surface-variant/50 rounded-full transition-all text-on-surface-variant">
<span class="material-symbols-outlined" data-icon="call">call</span>
</button>
<div class="h-6 w-[1px] bg-outline-variant mx-2"></div>
<button class="p-2 hover:bg-surface-variant/50 rounded-full transition-all text-on-surface-variant">
<span class="material-symbols-outlined" data-icon="search">search</span>
</button>
<button class="p-2 hover:bg-surface-variant/50 rounded-full transition-all text-on-surface-variant">
<span class="material-symbols-outlined" data-icon="more_vert">more_vert</span>
</button>
</div>
</header>
<!-- Message Feed -->
<div class="flex-1 overflow-y-auto p-lg custom-scrollbar space-y-md">
<div class="flex justify-center my-xl">
<span class="px-3 py-1 bg-surface-container rounded-full text-label-xs text-on-surface-variant uppercase tracking-wider">Today</span>
</div>
<!-- Sent Text -->
<div class="flex justify-end message-in-transition">
<div class="max-w-[70%] bg-primary text-on-primary p-md rounded-2xl rounded-tr-none shadow-sm">
<p class="text-body-md">Hi, let me know if you received the files.</p>
<div class="flex items-center justify-end gap-1 mt-1">
<span class="text-[10px] opacity-70">13:58</span>
<span class="material-symbols-outlined text-[14px] text-secondary-fixed" data-icon="done_all" style="font-variation-settings: 'FILL' 1;">done_all</span>
</div>
</div>
</div>
<!-- Received Text -->
<div class="flex justify-start message-in-transition">
<div class="max-w-[70%] bg-white text-on-surface p-md rounded-2xl rounded-tl-none border border-outline-variant shadow-sm">
<p class="text-body-md">Yes, I'm checking them now.</p>
<div class="flex items-center justify-end gap-1 mt-1">
<span class="text-[10px] text-outline">14:01</span>
</div>
</div>
</div>
<!-- Received Voice Message -->
<div class="flex justify-start message-in-transition">
<div class="max-w-[70%] bg-white text-on-surface p-md rounded-2xl rounded-tl-none border border-outline-variant shadow-sm flex items-center gap-md min-w-[280px]">
<button class="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary shrink-0 hover:bg-primary-container/30 transition-colors">
<span class="material-symbols-outlined" data-icon="play_arrow" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
</button>
<div class="flex-1 h-8 flex items-center gap-[2px]">
<!-- Simple visual wave -->
<div class="h-2 w-1 bg-outline rounded-full"></div>
<div class="h-4 w-1 bg-primary rounded-full"></div>
<div class="h-6 w-1 bg-primary rounded-full"></div>
<div class="h-3 w-1 bg-primary rounded-full"></div>
<div class="h-5 w-1 bg-primary rounded-full"></div>
<div class="h-8 w-1 bg-primary rounded-full"></div>
<div class="h-4 w-1 bg-outline rounded-full"></div>
<div class="h-6 w-1 bg-outline rounded-full"></div>
<div class="h-3 w-1 bg-outline rounded-full"></div>
<div class="h-5 w-1 bg-outline rounded-full"></div>
<div class="h-2 w-1 bg-outline rounded-full"></div>
<div class="h-4 w-1 bg-outline rounded-full"></div>
</div>
<span class="text-xs text-outline shrink-0">0:14</span>
</div>
</div>
<!-- Received Photo -->
<div class="flex justify-start message-in-transition">
<div class="max-w-[70%] bg-white p-1 rounded-2xl rounded-tl-none border border-outline-variant shadow-sm overflow-hidden">
<div class="relative group cursor-pointer">
<img class="w-full max-h-64 object-cover rounded-xl" data-alt="A stunning architectural photograph of a modern, eco-friendly corporate headquarters. The building features large glass panels, vertical gardens integrated into the facade, and sleek white structural lines. It is set against a clear blue sky during the golden hour, with soft, warm light reflecting off the glass. The style is professional and highly detailed, embodying a sustainable future." src="https://lh3.googleusercontent.com/aida-public/AB6AXuAHRx97172kCJ7X124Spmj8ZT5D5ZqBEfsgSasnklV8CgBtFdP12Br20w65jDOS6R5RU9bzOG9gGuMXcIngsTHlEaAwza2-CGDTdFH42_grBa-qVCT9IoEFddzF6YJJ4UJCHQ6L981xB4GvMPv07yGK8oHgipbPNM3Z1VrTdshP3BvWVWond9VFQPsRQwCJWet4JKN-gKET4jo2bTPEs3dwatuljF96NIZV1f8dk1aZh0xzlMz4DQ-YrA"/>
<div class="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
<span class="material-symbols-outlined text-white text-3xl" data-icon="fullscreen">fullscreen</span>
</div>
</div>
<div class="p-2 flex justify-between items-center">
<p class="text-xs text-on-surface-variant font-medium">New HQ Concept.jpg</p>
<span class="text-[10px] text-outline">14:02</span>
</div>
</div>
</div>
<!-- Received Document -->
<div class="flex justify-start message-in-transition">
<div class="max-w-[70%] bg-white text-on-surface p-md rounded-2xl rounded-tl-none border border-outline-variant shadow-sm flex items-center gap-md">
<div class="w-12 h-12 bg-error-container/20 rounded-lg flex items-center justify-center text-error">
<span class="material-symbols-outlined" data-icon="description">description</span>
</div>
<div class="flex-1 min-w-0">
<p class="text-label-md font-bold truncate">Q4_Sustainability_Report.pdf</p>
<p class="text-label-xs text-outline">1.2 MB • PDF</p>
</div>
<button class="p-2 hover:bg-surface-container rounded-full text-outline">
<span class="material-symbols-outlined" data-icon="download">download</span>
</button>
</div>
</div>
</div>
<!-- Input Bar -->
<footer class="p-lg bg-surface/80 backdrop-blur-md border-t border-outline-variant">
<div class="max-w-chat-max-width mx-auto relative flex items-end gap-md">
<!-- Attachment Action Menu (Floating Hidden) -->
<div class="hidden absolute bottom-20 left-0 bg-white border border-outline-variant shadow-xl rounded-2xl p-2 w-48 animate-in fade-in slide-in-from-bottom-4 duration-200" id="attachment-menu">
<button class="w-full flex items-center gap-md p-3 hover:bg-surface-container rounded-xl transition-colors">
<span class="material-symbols-outlined text-primary" data-icon="photo_library">photo_library</span>
<span class="text-label-md">Photos &amp; Videos</span>
</button>
<button class="w-full flex items-center gap-md p-3 hover:bg-surface-container rounded-xl transition-colors">
<span class="material-symbols-outlined text-on-secondary-container" data-icon="camera_alt">camera_alt</span>
<span class="text-label-md">Camera</span>
</button>
<button class="w-full flex items-center gap-md p-3 hover:bg-surface-container rounded-xl transition-colors">
<span class="material-symbols-outlined text-tertiary-container" data-icon="description">description</span>
<span class="text-label-md">Document</span>
</button>
<button class="w-full flex items-center gap-md p-3 hover:bg-surface-container rounded-xl transition-colors">
<span class="material-symbols-outlined text-error" data-icon="person">person</span>
<span class="text-label-md">Contact</span>
</button>
</div>
<button class="p-3 bg-surface-container hover:bg-surface-container-highest rounded-full transition-all text-on-surface-variant shrink-0 active:scale-95" id="attachment-btn">
<span class="material-symbols-outlined" data-icon="add">add</span>
</button>
<div class="flex-1 bg-surface-container rounded-2xl flex items-center px-lg py-2 border border-transparent focus-within:border-primary transition-colors">
<textarea class="flex-1 bg-transparent border-none focus:ring-0 resize-none py-1 text-body-md max-h-32 custom-scrollbar outline-none" placeholder="Type a message..." rows="1"></textarea>
<button class="p-2 text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined" data-icon="sentiment_satisfied">sentiment_satisfied</span>
</button>
</div>
<button class="p-3 bg-primary text-on-primary rounded-full transition-all hover:shadow-lg active:scale-90 shrink-0" id="send-btn">
<span class="material-symbols-outlined" data-icon="mic" id="mic-icon">mic</span>
</button>
</div>
</footer>
</main>
<script>
        // Micro-interactions and UI state management
        const attachmentBtn = document.getElementById('attachment-btn');
        const attachmentMenu = document.getElementById('attachment-menu');
        const textarea = document.querySelector('textarea');
        const sendBtn = document.getElementById('send-btn');
        const micIcon = document.getElementById('mic-icon');

        attachmentBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            attachmentMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            attachmentMenu.classList.add('hidden');
        });

        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            
            if (this.value.trim().length > 0) {
                micIcon.innerText = 'send';
                sendBtn.classList.add('bg-primary');
            } else {
                micIcon.innerText = 'mic';
            }
        });

        // Simulate typing animation
        setInterval(() => {
            const typingDots = document.querySelectorAll('.typing-dot');
            typingDots.forEach(dot => {
                dot.style.opacity = dot.style.opacity === '0' ? '1' : '0';
            });
        }, 1000);

        // Smooth scroll to bottom on load
        const messageFeed = document.querySelector('.overflow-y-auto.p-lg');
        messageFeed.scrollTop = messageFeed.scrollHeight;
    </script>
</body></html>