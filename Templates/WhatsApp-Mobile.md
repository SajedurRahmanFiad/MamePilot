<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>ProChat | Premium Messaging</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
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
        .chat-transition {
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .scroll-hide::-webkit-scrollbar {
            display: none;
        }
        .message-bubble-out {
            border-bottom-right-radius: 4px;
        }
        .message-bubble-in {
            border-bottom-left-radius: 4px;
        }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background text-on-surface font-body-md selection:bg-primary-container selection:text-on-primary-container overflow-hidden h-screen w-screen flex flex-col">
<!-- Screen 1: Chat List -->
<div class="flex-1 flex flex-col relative bg-surface z-10 chat-transition w-full h-full overflow-hidden" id="chat-list-screen">
<!-- TopAppBar (Small) -->
<header class="bg-surface/80 backdrop-blur-md sticky top-0 z-40 border-b border-outline-variant flex justify-between items-center px-lg h-16 w-full">
<h1 class="font-headline-sm text-headline-sm font-bold text-primary">ProChat</h1>
<div class="flex items-center gap-md">
<button class="p-xs hover:bg-surface-variant/50 rounded-full transition-all active:opacity-80">
<span class="material-symbols-outlined text-primary" data-icon="search">search</span>
</button>
<button class="p-xs hover:bg-surface-variant/50 rounded-full transition-all active:opacity-80">
<span class="material-symbols-outlined text-primary" data-icon="more_vert">more_vert</span>
</button>
</div>
</header>
<!-- Chats Container -->
<main class="flex-1 overflow-y-auto scroll-hide pb-xl">
<!-- Pinned section hint -->
<div class="px-lg pt-md pb-xs">
<span class="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">Recent Conversations</span>
</div>
<!-- Chat List Items -->
<div class="flex flex-col">
<!-- Chat Item 1 (Active/Unread) -->
<div class="flex items-center gap-md px-lg py-md hover:bg-surface-container-highest transition-colors cursor-pointer border-l-4 border-primary bg-primary-container/5" onclick="openChat('Alexander Sterling', 'image-1')">
<div class="relative">
<img class="w-14 h-14 rounded-full object-cover bg-surface-container" data-alt="A professional portrait of a man in his late 30s with short groomed hair, wearing a high-quality charcoal business suit. The background is a soft-focus corporate office environment with warm, ambient morning light. The visual style is premium and editorial, emphasizing clarity and focus." src="https://lh3.googleusercontent.com/aida-public/AB6AXuB5QKvw3jOWaBtUEkz9QbGXzAr2Wtx4GenqwXVMTNW4dc3dwvUqBy7EYqjjdERmKuy3nAKvgPpdxY6PbQKCTyzKdWc1kNR0Wr--UtiHQJkYIa5_Bj9IcU8KHxArlq7r_z5mXaUbPwQKNWn8lf3l8xMI-DI4cmzEFN7qt05YhP0V0Qi3PiIrnLWLiaY5T0myPAr4UeEEetQDERHnHjmJ8PJs0IdtbU7jxp1qHctQv3NX1fwatJunppbYlA"/>
<div class="absolute bottom-0 right-0 w-3.5 h-3.5 bg-secondary border-2 border-surface rounded-full"></div>
</div>
<div class="flex-1 min-w-0">
<div class="flex justify-between items-baseline mb-1">
<h3 class="font-headline-sm text-headline-sm font-bold truncate">Alexander Sterling</h3>
<span class="font-label-xs text-label-xs text-primary font-bold">10:42 AM</span>
</div>
<div class="flex justify-between items-center">
<p class="font-body-sm text-body-sm text-on-surface-variant truncate pr-md">The quarterly review documents are ready for your final approval. Please check...</p>
<span class="bg-secondary text-on-secondary w-5 h-5 flex items-center justify-center rounded-full font-label-xs text-label-xs shrink-0">2</span>
</div>
</div>
</div>
<!-- Chat Item 2 -->
<div class="flex items-center gap-md px-lg py-md hover:bg-surface-container-highest transition-colors cursor-pointer" onclick="openChat('Design Synergies', 'image-2')">
<div class="flex -space-x-4">
<img class="w-14 h-14 rounded-full object-cover border-2 border-surface" data-alt="A clean, minimalist abstract logo for a design studio, featuring geometric interlocking circles in shades of forest green and mint. The aesthetic is modern and corporate, set against a crisp white background. High-quality digital render." src="https://lh3.googleusercontent.com/aida-public/AB6AXuBMO7F5cAnmpqcmEWJp0Mpyctw7EVdaDLDqrGsHdQQ02302szKGLv793uDlaryYmr7hOZ_zzm5ZifLcgk3cP089pZQ95EfgFxoYdm0YxxAfMO2CFCXcyovfWDMPG9ldsXC3vckjxFtQWZ0axEPXtn4NmLIsf91gD6VcRXN13SwReQsdNhXeMPcXG4JOQtIxYK--ocyUUqjYHJGncBLvDoZP1m7rsAspioPb8CUh1NPTFnhWQrRTZAH0pA"/>
</div>
<div class="flex-1 min-w-0">
<div class="flex justify-between items-baseline mb-1">
<h3 class="font-headline-sm text-headline-sm font-bold truncate">Design Synergies</h3>
<span class="font-label-xs text-label-xs text-on-surface-variant">Yesterday</span>
</div>
<div class="flex justify-between items-center">
<p class="font-body-sm text-body-sm text-on-surface-variant truncate pr-md">Marcus: I've updated the Figma prototypes with the new Veridian palette.</p>
</div>
</div>
</div>
<!-- Chat Item 3 -->
<div class="flex items-center gap-md px-lg py-md hover:bg-surface-container-highest transition-colors cursor-pointer" onclick="openChat('Elena Rodriguez', 'image-3')">
<img class="w-14 h-14 rounded-full object-cover bg-surface-container" data-alt="A high-fashion portrait of a woman with elegant features and dark hair tied back, wearing a minimalist white silk blouse. The lighting is soft and flattering, creating a premium professional feel. The background is a clean, neutral grey tone." src="https://lh3.googleusercontent.com/aida-public/AB6AXuDHhsAPVnDWqn9m_z1Mmx66VBD71hoSQpdJNbnThJdVY87uZl5TXXQueb6YxPHXEVvwCa9oBC1bV7RmdSTPqcZ-GuaSLxFaxFC6Ri_-8-2R4JS9P0EsbmDdue4ju3CiKuvBrwo4PZFmHXOkBEmcyWi-EOI-atwq6yYBEDW5jwb1aWDbX5xqfTmNwef2yTlrhRd_d2XJO9_zaTwnQOtF-bS_fjg0WIrSThIXhaU9x_pYGSvo-LthSnw8jw"/>
<div class="flex-1 min-w-0">
<div class="flex justify-between items-baseline mb-1">
<h3 class="font-headline-sm text-headline-sm font-bold truncate">Elena Rodriguez</h3>
<span class="font-label-xs text-label-xs text-on-surface-variant">Yesterday</span>
</div>
<div class="flex justify-between items-center">
<div class="flex items-center gap-1 min-w-0">
<span class="material-symbols-outlined text-outline text-[16px]" data-icon="done_all">done_all</span>
<p class="font-body-sm text-body-sm text-on-surface-variant truncate">Let's schedule the sync for tomorrow at 9 AM.</p>
</div>
</div>
</div>
</div>
<!-- Chat Item 4 -->
<div class="flex items-center gap-md px-lg py-md hover:bg-surface-container-highest transition-colors cursor-pointer" onclick="openChat('Tech Innovations HQ', 'image-4')">
<div class="w-14 h-14 rounded-full bg-primary-container flex items-center justify-center">
<span class="material-symbols-outlined text-on-primary-container" data-icon="groups">groups</span>
</div>
<div class="flex-1 min-w-0">
<div class="flex justify-between items-baseline mb-1">
<h3 class="font-headline-sm text-headline-sm font-bold truncate">Tech Innovations HQ</h3>
<span class="font-label-xs text-label-xs text-on-surface-variant">Monday</span>
</div>
<div class="flex justify-between items-center">
<p class="font-body-sm text-body-sm text-on-surface-variant truncate pr-md">Sarah invited you to the "Spring Launch" sub-group.</p>
</div>
</div>
</div>
<!-- Chat Item 5 -->
<div class="flex items-center gap-md px-lg py-md hover:bg-surface-container-highest transition-colors cursor-pointer" onclick="openChat('Jonathan Thorne', 'image-5')">
<img class="w-14 h-14 rounded-full object-cover bg-surface-container" data-alt="A candid, high-resolution photo of a man in his late 20s with glasses and a friendly expression, wearing a casual navy blue tech hoodie. The background is a modern co-working space with large windows and plants. Soft natural daylight illuminates the scene." src="https://lh3.googleusercontent.com/aida-public/AB6AXuB7dEwCK4k3C-PQO4BdeMU_6z-bMHvk-1RrvzHI09hO-O6qBsxKdDtm8UdTTaLJOGOpNro487ZrP48JQsHxcYdv3QUv0ctoeNAJssvW85Aw9uQk7t-YX5EzJstOJjvOTf_TfuffZKU9GVrX8fMZ0v9trMZ2EQzY2puP0qa3jXbehqm46rHndf1oN8eajBw9k-3hCw8xwUvp2flnRnSiQbnnw_ifeVYHDEyda2y8zAWLRifwINZGKWuRgg"/>
<div class="flex-1 min-w-0">
<div class="flex justify-between items-baseline mb-1">
<h3 class="font-headline-sm text-headline-sm font-bold truncate">Jonathan Thorne</h3>
<span class="font-label-xs text-label-xs text-on-surface-variant">Oct 24</span>
</div>
<div class="flex justify-between items-center">
<div class="flex items-center gap-1 min-w-0 text-primary">
<span class="material-symbols-outlined text-[16px]" data-icon="mic">mic</span>
<p class="font-body-sm text-body-sm font-medium truncate">Voice message (0:45)</p>
</div>
</div>
</div>
</div>
</div>
</main>
<!-- FAB (New Chat) -->
<button class="fixed right-lg bottom-[5rem] w-14 h-14 rounded-2xl bg-secondary text-on-secondary shadow-lg flex items-center justify-center hover:scale-105 transition-transform active:scale-95 z-50">
<span class="material-symbols-outlined" data-icon="chat">chat</span>
</button>
<!-- BottomNavBar (Label + Icon) -->
<nav class="fixed bottom-0 left-0 w-full flex justify-around items-center h-16 px-md bg-surface border-t border-outline-variant z-50">
<div class="flex flex-col items-center justify-center bg-secondary-container text-on-secondary-container rounded-full px-5 py-1 scale-95 transition-all duration-150">
<span class="material-symbols-outlined" data-icon="chat" style="font-variation-settings: 'FILL' 1;">chat</span>
<span class="font-label-xs text-label-xs">Chats</span>
</div>
<div class="flex flex-col items-center justify-center text-on-surface-variant">
<span class="material-symbols-outlined" data-icon="status_heart">settings_heart</span>
<span class="font-label-xs text-label-xs">Status</span>
</div>
<div class="flex flex-col items-center justify-center text-on-surface-variant">
<span class="material-symbols-outlined" data-icon="groups">groups</span>
<span class="font-label-xs text-label-xs">Communities</span>
</div>
<div class="flex flex-col items-center justify-center text-on-surface-variant">
<span class="material-symbols-outlined" data-icon="call">call</span>
<span class="font-label-xs text-label-xs">Calls</span>
</div>
</nav>
</div>
<!-- Screen 2: Active Chat (Initially Off-screen) -->
<div class="fixed inset-0 bg-background flex flex-col z-60 translate-x-full chat-transition w-full h-full overflow-hidden" id="active-chat-screen">
<!-- Chat Header -->
<header class="bg-surface/90 backdrop-blur-md sticky top-0 z-40 border-b border-outline-variant flex items-center gap-md px-md h-16 w-full">
<button class="p-xs hover:bg-surface-variant/50 rounded-full transition-all active:opacity-80" onclick="closeChat()">
<span class="material-symbols-outlined text-primary" data-icon="arrow_back">arrow_back</span>
</button>
<div class="flex-1 flex items-center gap-sm overflow-hidden">
<img class="w-10 h-10 rounded-full object-cover" data-alt="Default user avatar" id="active-chat-avatar" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBPN-YP_9rUgpJWFZpXP9kKkkVjg3CUnAI91lrYO70jH8LqzR3WhMT8geGcxiAH_NIM1mNolwpH4wgYQk_VDppJru9NDoJ6xvsrXb3Z4D9lzYyDSSccGl8F1JDnY_ND1i6KL-P8_xnv9sTkWYgP4QlNp3W0_WSheJXEIq2IZDusor7e94WMv_Ir9_TrCGNJ-Lj3uDOSkpdX94KOaJIadydv7Vam7Xl0KfncA8OeD_9B_F2G0o061LYRpw"/>
<div class="min-w-0">
<h2 class="font-headline-sm text-headline-sm font-bold truncate" id="active-chat-name">Contact Name</h2>
<p class="font-label-xs text-label-xs text-secondary">online</p>
</div>
</div>
<div class="flex items-center gap-xs">
<button class="p-xs hover:bg-surface-variant/50 rounded-full transition-all active:opacity-80">
<span class="material-symbols-outlined text-primary" data-icon="videocam">videocam</span>
</button>
<button class="p-xs hover:bg-surface-variant/50 rounded-full transition-all active:opacity-80">
<span class="material-symbols-outlined text-primary" data-icon="call">call</span>
</button>
<button class="p-xs hover:bg-surface-variant/50 rounded-full transition-all active:opacity-80">
<span class="material-symbols-outlined text-primary" data-icon="more_vert">more_vert</span>
</button>
</div>
</header>
<!-- Messages Area -->
<main class="flex-1 overflow-y-auto scroll-hide p-lg flex flex-col gap-md bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-fixed opacity-[0.03]" style="background-color: #fcf9f8;">
<!-- Dates/Dividers -->
<div class="flex justify-center my-md">
<span class="bg-surface-container-high px-md py-xs rounded-full font-label-xs text-label-xs text-on-surface-variant">TODAY</span>
</div>
<!-- Incoming Message -->
<div class="flex flex-col max-w-[85%] self-start">
<div class="bg-surface border border-outline-variant p-md rounded-2xl rounded-tl-none message-bubble-in shadow-sm">
<p class="font-body-sm text-body-sm text-on-surface">Did you see the final mockups for the Veridian redesign?</p>
<div class="flex justify-end mt-1">
<span class="font-label-xs text-label-xs text-on-surface-variant/70">10:40 AM</span>
</div>
</div>
</div>
<!-- Outgoing Message -->
<div class="flex flex-col max-w-[85%] self-end">
<div class="bg-primary text-on-primary p-md rounded-2xl rounded-tr-none message-bubble-out shadow-md">
<p class="font-body-sm text-body-sm">Just checking them now. The minimalism is really strong. I love the glassmorphism elements in the header.</p>
<div class="flex justify-end mt-1 items-center gap-1">
<span class="font-label-xs text-label-xs text-on-primary-container/80">10:42 AM</span>
<span class="material-symbols-outlined text-[14px]" data-icon="done_all">done_all</span>
</div>
</div>
</div>
<!-- Incoming Message with Image -->
<div class="flex flex-col max-w-[85%] self-start">
<div class="bg-surface border border-outline-variant p-sm rounded-2xl rounded-tl-none message-bubble-in shadow-sm">
<div class="overflow-hidden rounded-xl mb-md">
<img class="w-full aspect-square object-cover" data-alt="A clean, minimalist UI design mockup of a messaging application on a sleek smartphone screen. The design features soft green and white tones with high contrast and premium typography. The phone is held in a hand with a professional studio background." src="https://lh3.googleusercontent.com/aida-public/AB6AXuBwdBHoDg0IPS44nBBwUkPCZ1JCs3T1EFu_EYMGfPHAcUa6fKVZ5_Tvk0x3Bt53E7sqH4Mr6K3PF3M5jK7nm-9nOXebL-5MFJ5JOZNmR8ff1p1PbfyfMBAWQhr0evCzdQu7EhNw6YBKo30VcFJS9YuGg6tdR51Q4-3BbOBp5v_Z4CeyRbFL05_fBI-EQupdHgKbuW5rQ2OrzuyKmFOEDFF8qpXdp6XUkVPR7safQGoprJrMCYQEmZrnyQ"/>
</div>
<div class="px-xs pb-xs">
<p class="font-body-sm text-body-sm text-on-surface">Here's a preview of the login screen.</p>
<div class="flex justify-end mt-1">
<span class="font-label-xs text-label-xs text-on-surface-variant/70">10:43 AM</span>
</div>
</div>
</div>
</div>
<!-- Outgoing Message (Short) -->
<div class="flex flex-col max-w-[85%] self-end">
<div class="bg-primary text-on-primary p-md rounded-2xl rounded-tr-none message-bubble-out shadow-md">
<p class="font-body-sm text-body-sm">Stunning! Let's ship it. 🚀</p>
<div class="flex justify-end mt-1 items-center gap-1">
<span class="font-label-xs text-label-xs text-on-primary-container/80">10:45 AM</span>
<span class="material-symbols-outlined text-[14px]" data-icon="done_all">done_all</span>
</div>
</div>
</div>
</main>
<!-- Chat Input Bar -->
<footer class="bg-surface p-md border-t border-outline-variant flex items-end gap-sm">
<div class="flex-1 bg-surface-container flex items-end px-md py-sm rounded-3xl min-h-[48px]">
<button class="p-xs text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined" data-icon="mood">mood</span>
</button>
<textarea class="flex-1 bg-transparent border-none focus:ring-0 font-body-sm text-body-sm py-xs resize-none" placeholder="Type a message..." rows="1"></textarea>
<button class="p-xs text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined" data-icon="attach_file">attach_file</span>
</button>
<button class="p-xs text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined" data-icon="photo_camera">photo_camera</span>
</button>
</div>
<button class="w-12 h-12 rounded-full bg-secondary text-on-secondary flex items-center justify-center shadow-sm active:scale-90 transition-transform">
<span class="material-symbols-outlined" data-icon="mic" style="font-variation-settings: 'FILL' 1;">mic</span>
</button>
</footer>
</div>
<script>
        function openChat(name, avatar) {
            const listScreen = document.getElementById('chat-list-screen');
            const chatScreen = document.getElementById('active-chat-screen');
            const chatName = document.getElementById('active-chat-name');
            const chatAvatar = document.getElementById('active-chat-avatar');

            chatName.innerText = name;
            // Note: In real production, we'd swap the src. For this demo, we keep the placeholder mechanism.
            
            listScreen.classList.add('-translate-x-full');
            chatScreen.classList.remove('translate-x-full');
            chatScreen.classList.add('translate-x-0');
        }

        function closeChat() {
            const listScreen = document.getElementById('chat-list-screen');
            const chatScreen = document.getElementById('active-chat-screen');

            listScreen.classList.remove('-translate-x-full');
            chatScreen.classList.add('translate-x-full');
            chatScreen.classList.remove('translate-x-0');
        }

        // Auto-expand textarea (simple version)
        const textarea = document.querySelector('textarea');
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    </script>
</body></html>