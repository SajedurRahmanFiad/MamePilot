<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

/**
 * Facebook Page Messenger Platform integration.
 *
 * Meta remains the transport source of truth. Webhooks are mirrored locally
 * so MamePilot can provide a durable shared inbox without exposing Graph API
 * concepts to day-to-day operators.
 */
final class MessengerApi extends BaseService
{
    private const SETTINGS_ID = 'messenger-default';
    private const DEFAULT_GRAPH_VERSION = 'v25.0';
    private const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
    private const SUBSCRIBED_FIELDS = [
        'messages',
        'messaging_postbacks',
        'message_deliveries',
        'message_reads',
        'message_echoes',
        'message_edits',
        'message_reactions',
        'messaging_referrals',
        'messaging_optins',
    ];

    public function fetchMessengerSettings(array $params = []): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        return $this->settingsResponse($this->settingsRow());
    }

    public function updateMessengerSettings(array $params): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        $existing = $this->settingsRow() ?? [];
        $this->upsertSettings([
            'page_access_token' => $this->stringOrNull($params['pageAccessToken'] ?? ($existing['page_access_token'] ?? null)),
            'page_id' => $this->stringOrNull($params['pageId'] ?? ($existing['page_id'] ?? null)),
            'verify_token' => $this->stringOrNull($params['verifyToken'] ?? ($existing['verify_token'] ?? null)),
            'app_secret' => $this->stringOrNull($params['appSecret'] ?? ($existing['app_secret'] ?? null)),
            'graph_version' => $this->normalizeGraphVersion($params['graphVersion'] ?? ($existing['graph_version'] ?? self::DEFAULT_GRAPH_VERSION)),
            'human_agent_enabled' => !empty($params['humanAgentEnabled'] ?? ($existing['human_agent_enabled'] ?? false)) ? 1 : 0,
        ]);
        return $this->settingsResponse($this->settingsRow());
    }

    public function testMessengerConnection(array $params = []): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        $settings = $this->requireConfiguredSettings();
        $pageId = (string) $settings['page_id'];
        $page = $this->graphRequest('GET', '/' . rawurlencode($pageId), null, $settings, [
            'fields' => 'id,name,username,picture.type(large)',
        ]);
        $subscription = $this->subscriptionState($settings);
        $picture = (string) ($page['picture']['data']['url'] ?? '');
        $this->database->execute(
            'UPDATE messenger_settings
             SET page_name = :name, page_username = :username, page_picture_url = :picture,
                 subscribed = :subscribed, subscribed_fields = :fields, updated_at = :updated
             WHERE id = :id',
            [
                ':name' => $this->stringOrNull($page['name'] ?? null),
                ':username' => $this->stringOrNull($page['username'] ?? null),
                ':picture' => $this->stringOrNull($picture),
                ':subscribed' => $subscription['subscribed'] ? 1 : 0,
                ':fields' => $this->jsonEncode($subscription['fields']),
                ':updated' => $this->database->nowUtc(),
                ':id' => self::SETTINGS_ID,
            ]
        );
        return [
            'ok' => true,
            'pageId' => (string) ($page['id'] ?? $pageId),
            'pageName' => (string) ($page['name'] ?? ''),
            'pageUsername' => (string) ($page['username'] ?? ''),
            'pagePictureUrl' => $picture,
            'subscribed' => $subscription['subscribed'],
            'subscribedFields' => $subscription['fields'],
        ];
    }

    public function subscribeMessengerPage(array $params = []): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        $settings = $this->requireConfiguredSettings(true);
        $pageId = (string) $settings['page_id'];
        $this->graphRequest('POST', '/' . rawurlencode($pageId) . '/subscribed_apps', null, $settings, [
            'subscribed_fields' => implode(',', self::SUBSCRIBED_FIELDS),
        ]);
        $subscription = $this->subscriptionState($settings);
        $this->database->execute(
            'UPDATE messenger_settings SET subscribed = :subscribed, subscribed_fields = :fields, updated_at = :updated WHERE id = :id',
            [
                ':subscribed' => $subscription['subscribed'] ? 1 : 0,
                ':fields' => $this->jsonEncode($subscription['fields']),
                ':updated' => $this->database->nowUtc(),
                ':id' => self::SETTINGS_ID,
            ]
        );
        return ['ok' => true, 'subscribed' => $subscription['subscribed'], 'subscribedFields' => $subscription['fields']];
    }

    public function fetchMessengerProfile(array $params = []): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        $row = $this->settingsRow() ?? [];
        return $this->profileResponse($row);
    }

    public function updateMessengerProfile(array $params): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        $settings = $this->requireConfiguredSettings();
        $greeting = trim((string) ($params['greeting'] ?? ''));
        if (mb_strlen($greeting) > 160) {
            throw new RuntimeException('The Messenger greeting can be up to 160 characters.');
        }
        $iceBreakers = [];
        foreach ((array) ($params['iceBreakers'] ?? []) as $question) {
            $question = trim((string) $question);
            if ($question === '') continue;
            if (mb_strlen($question) > 80) throw new RuntimeException('Each conversation starter can be up to 80 characters.');
            $iceBreakers[] = $question;
            if (count($iceBreakers) === 4) break;
        }
        $getStarted = !empty($params['getStartedEnabled']);
        $profile = [];
        if ($greeting !== '') {
            $profile['greeting'] = [['locale' => 'default', 'text' => $greeting]];
        }
        if ($getStarted) {
            $profile['get_started'] = ['payload' => 'MAMEPILOT_GET_STARTED'];
        }
        if ($iceBreakers !== []) {
            $profile['ice_breakers'] = array_map(static fn(string $question, int $index): array => [
                'question' => $question,
                'payload' => 'MAMEPILOT_ICE_BREAKER_' . ($index + 1),
            ], $iceBreakers, array_keys($iceBreakers));
        }
        if ($profile !== []) {
            $this->graphRequest('POST', '/' . rawurlencode((string) $settings['page_id']) . '/messenger_profile', $profile, $settings);
        }
        $deleteFields = [];
        if ($greeting === '') $deleteFields[] = 'greeting';
        if (!$getStarted) $deleteFields[] = 'get_started';
        if ($iceBreakers === []) $deleteFields[] = 'ice_breakers';
        if ($deleteFields !== []) {
            $this->graphRequest('DELETE', '/' . rawurlencode((string) $settings['page_id']) . '/messenger_profile', ['fields' => $deleteFields], $settings);
        }
        $this->database->execute(
            'UPDATE messenger_settings SET greeting = :greeting, get_started_enabled = :started, ice_breakers_json = :ice, updated_at = :updated WHERE id = :id',
            [
                ':greeting' => $this->stringOrNull($greeting),
                ':started' => $getStarted ? 1 : 0,
                ':ice' => $this->jsonEncode($iceBreakers),
                ':updated' => $this->database->nowUtc(),
                ':id' => self::SETTINGS_ID,
            ]
        );
        return $this->profileResponse($this->settingsRow() ?? []);
    }

    public function fetchMessengerContacts(array $params = []): array
    {
        $this->currentUser();
        $this->ensureTables();
        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = min(100, max(10, (int) ($params['pageSize'] ?? 50)));
        $search = trim((string) ($params['search'] ?? ''));
        $filter = trim((string) ($params['filter'] ?? 'all'));
        $where = [];
        $bindings = [];
        if ($search !== '') {
            $where[] = '(name LIKE :name OR first_name LIKE :first OR last_name LIKE :last OR psid LIKE :psid OR last_message_preview LIKE :preview)';
            foreach ([':name', ':first', ':last', ':psid', ':preview'] as $key) $bindings[$key] = '%' . $search . '%';
        }
        if ($filter === 'unread') $where[] = 'unread_count > 0';
        $whereSql = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);
        $count = $this->database->fetchOne('SELECT COUNT(*) AS total FROM messenger_contacts ' . $whereSql, $bindings);
        $offset = ($page - 1) * $pageSize;
        $rows = $this->database->fetchAll(
            'SELECT * FROM messenger_contacts ' . $whereSql . ' ORDER BY last_message_at DESC, updated_at DESC LIMIT ' . $pageSize . ' OFFSET ' . $offset,
            $bindings
        );
        $settings = $this->settingsRow();
        return [
            'data' => array_map(fn(array $row): array => $this->mapContact($row, $settings), $rows),
            'count' => (int) ($count['total'] ?? 0),
            'configured' => $this->isConfigured($settings),
        ];
    }

    public function fetchMessengerMessages(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $contactId = trim((string) ($params['contactId'] ?? ''));
        $contact = $this->database->fetchOne('SELECT * FROM messenger_contacts WHERE id = :id LIMIT 1', [':id' => $contactId]);
        if ($contact === null) throw new RuntimeException('Messenger conversation not found.');
        $limit = min(250, max(20, (int) ($params['limit'] ?? 150)));
        $rows = array_reverse($this->database->fetchAll(
            'SELECT * FROM messenger_messages WHERE contact_id = :contact ORDER BY message_at DESC, created_at DESC LIMIT ' . $limit,
            [':contact' => $contactId]
        ));
        return [
            'contact' => $this->mapContact($contact, $this->settingsRow()),
            'data' => array_map(fn(array $row): array => $this->mapMessage($row), $rows),
        ];
    }

    public function markMessengerConversationRead(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        try {
            $this->sendSenderAction((string) $contact['psid'], 'mark_seen');
        } catch (\Throwable $exception) {
            // Local read state is still valuable if Meta no longer accepts an old action.
        }
        $now = $this->database->nowUtc();
        $this->database->execute("UPDATE messenger_messages SET status = 'read', updated_at = :updated WHERE contact_id = :contact AND direction = 'inbound'", [':updated' => $now, ':contact' => $contact['id']]);
        $this->database->execute('UPDATE messenger_contacts SET unread_count = 0, updated_at = :updated WHERE id = :id', [':updated' => $now, ':id' => $contact['id']]);
        return ['ok' => true, 'contactId' => (string) $contact['id']];
    }

    public function sendMessengerSenderAction(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        $action = trim((string) ($params['senderAction'] ?? ''));
        if (!in_array($action, ['typing_on', 'typing_off', 'mark_seen'], true)) {
            throw new RuntimeException('Unsupported Messenger action.');
        }
        $this->sendSenderAction((string) $contact['psid'], $action);
        return ['ok' => true, 'contactId' => (string) $contact['id'], 'senderAction' => $action];
    }

    public function sendMessengerMessage(array $params): array
    {
        $user = $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        $text = trim((string) ($params['text'] ?? ''));
        if ($text === '') throw new RuntimeException('Message text cannot be empty.');
        if (mb_strlen($text) > 2000) throw new RuntimeException('Messenger messages can be up to 2,000 characters.');
        $replyToMid = $this->validReplyMid($contact, $params['replyToMid'] ?? null);
        $response = $this->sendMessagePayload($contact, ['text' => $text], $replyToMid);
        $mid = (string) (($response['message_id'] ?? '') ?: $this->uuid4());
        return $this->mapMessage($this->storeOutboundMessage($contact, $mid, 'text', $text, null, null, null, 'sent', $user['id'] ?? null, $replyToMid));
    }

    public function sendMessengerMediaMessage(array $params): array
    {
        $user = $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        $dataUrl = trim((string) ($params['dataUrl'] ?? ''));
        $fileName = trim((string) ($params['fileName'] ?? 'attachment')) ?: 'attachment';
        $requestedMime = strtolower(trim((string) ($params['mimeType'] ?? 'application/octet-stream')));
        $decoded = $this->decodeDataUrl($dataUrl);
        if ($decoded === null) throw new RuntimeException('The selected Messenger file could not be read.');
        [$decodedMime, $bytes] = $decoded;
        $mime = $requestedMime === '' || $requestedMime === 'application/octet-stream' ? $decodedMime : $requestedMime;
        if (strlen($bytes) > self::MAX_MEDIA_BYTES) throw new RuntimeException('Messenger attachments in this inbox are limited to 25 MB.');
        $type = $this->mediaMessageType($mime);
        $settings = $this->requireConfiguredSettings();
        $attachmentId = $this->uploadAttachment($bytes, $mime, $fileName, $type, $settings);
        $replyToMid = $this->validReplyMid($contact, $params['replyToMid'] ?? null);
        $response = $this->sendMessagePayload($contact, [
            'attachment' => ['type' => $type, 'payload' => ['attachment_id' => $attachmentId]],
        ], $replyToMid);
        $mid = (string) (($response['message_id'] ?? '') ?: $this->uuid4());
        $localUrl = $this->saveUploadedFileFromDataUrl('data:' . $mime . ';base64,' . base64_encode($bytes), 'messenger', $fileName);
        return $this->mapMessage($this->storeOutboundMessage($contact, $mid, $type, '', $localUrl, $attachmentId, $mime, 'sent', $user['id'] ?? null, $replyToMid, $fileName));
    }

    public function sendMessengerQuickReplies(array $params): array
    {
        $user = $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        $text = trim((string) ($params['text'] ?? ''));
        if ($text === '' || mb_strlen($text) > 2000) throw new RuntimeException('Add a prompt up to 2,000 characters.');
        $options = [];
        foreach ((array) ($params['options'] ?? []) as $index => $option) {
            $title = trim((string) (is_array($option) ? ($option['title'] ?? '') : $option));
            if ($title === '') continue;
            if (mb_strlen($title) > 20) throw new RuntimeException('Each quick reply can be up to 20 characters.');
            $options[] = ['content_type' => 'text', 'title' => $title, 'payload' => 'MAMEPILOT_QUICK_' . ($index + 1) . '_' . substr(hash('sha256', $title), 0, 12)];
            if (count($options) === 13) break;
        }
        if ($options === []) throw new RuntimeException('Add at least one quick reply.');
        $replyToMid = $this->validReplyMid($contact, $params['replyToMid'] ?? null);
        $response = $this->sendMessagePayload($contact, ['text' => $text, 'quick_replies' => $options], $replyToMid);
        $mid = (string) (($response['message_id'] ?? '') ?: $this->uuid4());
        return $this->mapMessage($this->storeOutboundMessage($contact, $mid, 'quick_replies', $text, null, null, null, 'sent', $user['id'] ?? null, $replyToMid, null, ['quickReplies' => $options]));
    }

    public function sendMessengerCard(array $params): array
    {
        $user = $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        $title = trim((string) ($params['title'] ?? ''));
        $subtitle = trim((string) ($params['subtitle'] ?? ''));
        $imageUrl = trim((string) ($params['imageUrl'] ?? ''));
        if ($title === '') throw new RuntimeException('Add a title for the Messenger card.');
        if (mb_strlen($title) > 80 || mb_strlen($subtitle) > 80) throw new RuntimeException('Card titles and descriptions can be up to 80 characters.');
        if ($imageUrl !== '' && !filter_var($imageUrl, FILTER_VALIDATE_URL)) throw new RuntimeException('Enter a valid image URL.');
        $buttons = [];
        foreach ((array) ($params['buttons'] ?? []) as $index => $button) {
            if (!is_array($button)) continue;
            $label = trim((string) ($button['title'] ?? ''));
            $value = trim((string) ($button['value'] ?? ''));
            $kind = (string) ($button['type'] ?? 'web_url');
            if ($label === '' || $value === '') continue;
            if (mb_strlen($label) > 20) throw new RuntimeException('Card button labels can be up to 20 characters.');
            if ($kind === 'web_url') {
                if (!filter_var($value, FILTER_VALIDATE_URL)) throw new RuntimeException('Enter a valid URL for each link button.');
                $buttons[] = ['type' => 'web_url', 'title' => $label, 'url' => $value];
            } else {
                $buttons[] = ['type' => 'postback', 'title' => $label, 'payload' => 'MAMEPILOT_CARD_' . ($index + 1) . '_' . substr(hash('sha256', $value), 0, 16)];
            }
            if (count($buttons) === 3) break;
        }
        $element = array_filter(['title' => $title, 'subtitle' => $subtitle ?: null, 'image_url' => $imageUrl ?: null, 'buttons' => $buttons ?: null], static fn($value): bool => $value !== null);
        $message = ['attachment' => ['type' => 'template', 'payload' => ['template_type' => 'generic', 'elements' => [$element]]]];
        $replyToMid = $this->validReplyMid($contact, $params['replyToMid'] ?? null);
        $response = $this->sendMessagePayload($contact, $message, $replyToMid);
        $mid = (string) (($response['message_id'] ?? '') ?: $this->uuid4());
        return $this->mapMessage($this->storeOutboundMessage($contact, $mid, 'template', $title, $imageUrl ?: null, null, null, 'sent', $user['id'] ?? null, $replyToMid, null, ['card' => $element]));
    }

    public function sendMessengerReaction(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        $messageId = trim((string) ($params['messageId'] ?? ''));
        $message = $this->database->fetchOne('SELECT * FROM messenger_messages WHERE id = :id AND contact_id = :contact LIMIT 1', [':id' => $messageId, ':contact' => $contact['id']]);
        if ($message === null || trim((string) ($message['mid'] ?? '')) === '') throw new RuntimeException('This message cannot be reacted to.');
        $reaction = trim((string) ($params['reaction'] ?? ''));
        $settings = $this->requireConfiguredSettings();
        $payload = ['recipient' => ['id' => (string) $contact['psid']], 'sender_action' => $reaction === '' ? 'unreact' : 'react', 'payload' => ['message_id' => (string) $message['mid']]];
        if ($reaction !== '') $payload['payload']['reaction'] = $reaction;
        $this->graphRequest('POST', '/' . rawurlencode((string) $settings['page_id']) . '/messages', $payload, $settings);
        $this->database->execute('UPDATE messenger_messages SET reaction = :reaction, reaction_actor = :actor, updated_at = :updated WHERE id = :id', [
            ':reaction' => $this->stringOrNull($reaction), ':actor' => $reaction === '' ? null : 'page', ':updated' => $this->database->nowUtc(), ':id' => $messageId,
        ]);
        return $this->mapMessage($this->database->fetchOne('SELECT * FROM messenger_messages WHERE id = :id', [':id' => $messageId]) ?: $message);
    }

    /** Called only by the public Meta webhook endpoint. */
    public function webhookVerification(string $mode, string $token, string $challenge): ?string
    {
        $this->ensureTables();
        $settings = $this->settingsRow();
        if ($mode !== 'subscribe' || $token === '' || $challenge === '' || $settings === null) return null;
        $expected = trim((string) ($settings['verify_token'] ?? ''));
        return $expected !== '' && hash_equals($expected, $token) ? $challenge : null;
    }

    public function handleWebhook(string $rawBody, ?string $signature): array
    {
        $this->ensureTables();
        $settings = $this->settingsRow();
        $secret = trim((string) ($settings['app_secret'] ?? ''));
        if ($secret === '' || $signature === null || !hash_equals('sha256=' . hash_hmac('sha256', $rawBody, $secret), trim($signature))) {
            throw new RuntimeException('Invalid Messenger webhook signature.');
        }
        $payload = json_decode($rawBody, true);
        if (!is_array($payload) || (string) ($payload['object'] ?? '') !== 'page') throw new RuntimeException('Invalid Messenger webhook JSON.');
        $processed = 0;
        foreach ((array) ($payload['entry'] ?? []) as $entry) {
            if (!is_array($entry)) continue;
            $configuredPageId = trim((string) ($settings['page_id'] ?? ''));
            $entryPageId = trim((string) ($entry['id'] ?? ''));
            if ($configuredPageId !== '' && $entryPageId !== '' && !hash_equals($configuredPageId, $entryPageId)) continue;
            foreach ((array) ($entry['messaging'] ?? []) as $event) {
                if (!is_array($event)) continue;
                $processed += $this->handleMessagingEvent($event, $settings) ? 1 : 0;
            }
        }
        return ['ok' => true, 'processed' => $processed];
    }

    private function handleMessagingEvent(array $event, ?array $settings): bool
    {
        $pageId = trim((string) ($settings['page_id'] ?? ''));
        $senderId = trim((string) ($event['sender']['id'] ?? ''));
        $recipientId = trim((string) ($event['recipient']['id'] ?? ''));
        $isEcho = !empty($event['message']['is_echo']);
        $psid = $isEcho || ($pageId !== '' && $senderId === $pageId) ? $recipientId : $senderId;
        if ($psid === '' || ($pageId !== '' && $psid === $pageId)) return false;
        $contact = $this->findOrCreateContact($psid, $settings);
        $at = $this->timestampToDatabase($event['timestamp'] ?? null);

        if (is_array($event['message'] ?? null)) {
            $message = $event['message'];
            $mid = trim((string) ($message['mid'] ?? ''));
            if ($mid === '') $mid = 'event_' . hash('sha256', $this->jsonEncode($event) ?? serialize($event));
            if ($this->database->fetchOne('SELECT id FROM messenger_messages WHERE mid = :mid LIMIT 1', [':mid' => $mid]) !== null) return false;
            $attachments = array_values(array_filter((array) ($message['attachments'] ?? []), 'is_array'));
            $primary = $attachments[0] ?? [];
            $type = trim((string) ($primary['type'] ?? '')) ?: (!empty($message['sticker_id']) ? 'sticker' : (!empty($message['quick_reply']) ? 'quick_reply' : 'text'));
            $attachmentUrl = (string) ($primary['payload']['url'] ?? '');
            $attachmentId = (string) ($primary['payload']['attachment_id'] ?? '');
            $text = trim((string) ($message['text'] ?? ''));
            if ($text === '' && $attachments !== []) $text = $this->attachmentPreview($type);
            $direction = $isEcho ? 'outbound' : 'inbound';
            $this->insertMessage([
                'id' => $this->uuid4(), 'contact_id' => $contact['id'], 'mid' => $mid, 'direction' => $direction,
                'message_type' => $type, 'message_text' => $text, 'attachment_url' => $attachmentUrl ?: null,
                'attachment_id' => $attachmentId ?: null, 'attachments_json' => $this->jsonEncode($attachments),
                'status' => $direction === 'inbound' ? 'received' : 'sent',
                'reply_to_mid' => $this->stringOrNull($message['reply_to']['mid'] ?? null),
                'quick_reply_payload' => $this->stringOrNull($message['quick_reply']['payload'] ?? null),
                'payload_json' => $this->jsonEncode($event), 'message_at' => $at,
            ]);
            $this->touchConversation($contact, $text ?: $this->attachmentPreview($type), $type, $at, $direction === 'inbound');
            return true;
        }

        if (is_array($event['delivery'] ?? null)) {
            $delivery = $event['delivery'];
            $mids = array_values(array_filter(array_map('strval', (array) ($delivery['mids'] ?? []))));
            foreach ($mids as $mid) $this->updateMessageStatus($mid, 'delivered');
            if ($mids === []) $this->updateStatusByWatermark((string) $contact['id'], (int) ($delivery['watermark'] ?? $event['timestamp'] ?? 0), 'delivered');
            return true;
        }
        if (is_array($event['read'] ?? null)) {
            $this->updateStatusByWatermark((string) $contact['id'], (int) ($event['read']['watermark'] ?? $event['timestamp'] ?? 0), 'read');
            return true;
        }
        if (is_array($event['reaction'] ?? null)) {
            $reaction = $event['reaction'];
            $mid = trim((string) ($reaction['mid'] ?? ''));
            if ($mid !== '') {
                $value = (string) ($reaction['emoji'] ?? $reaction['reaction'] ?? '');
                if ((string) ($reaction['action'] ?? 'react') === 'unreact') $value = '';
                $this->database->execute('UPDATE messenger_messages SET reaction = :reaction, reaction_actor = :actor, updated_at = :updated WHERE mid = :mid', [
                    ':reaction' => $this->stringOrNull($value), ':actor' => $value === '' ? null : 'contact', ':updated' => $this->database->nowUtc(), ':mid' => $mid,
                ]);
                $this->touchUserWindow($contact, $at);
            }
            return true;
        }
        if (is_array($event['message_edit'] ?? null)) {
            $edit = $event['message_edit'];
            $mid = trim((string) ($edit['mid'] ?? ''));
            if ($mid !== '') $this->database->execute('UPDATE messenger_messages SET message_text = :text, payload_json = :payload, updated_at = :updated WHERE mid = :mid', [':text' => (string) ($edit['text'] ?? ''), ':payload' => $this->jsonEncode($event), ':updated' => $this->database->nowUtc(), ':mid' => $mid]);
            return true;
        }
        if (is_array($event['message_unsend'] ?? null)) {
            $mid = trim((string) ($event['message_unsend']['mid'] ?? ''));
            if ($mid !== '') $this->database->execute("UPDATE messenger_messages SET message_type = 'unsent', message_text = 'Message was removed', attachment_url = NULL, attachments_json = NULL, updated_at = :updated WHERE mid = :mid", [':updated' => $this->database->nowUtc(), ':mid' => $mid]);
            return true;
        }
        foreach (['postback' => 'postback', 'referral' => 'referral', 'optin' => 'optin'] as $eventKey => $type) {
            if (!is_array($event[$eventKey] ?? null)) continue;
            $data = $event[$eventKey];
            $text = trim((string) ($data['title'] ?? $data['ref'] ?? $data['payload'] ?? ucfirst($type)));
            $mid = 'event_' . hash('sha256', $this->jsonEncode($event) ?? serialize($event));
            if ($this->database->fetchOne('SELECT id FROM messenger_messages WHERE mid = :mid LIMIT 1', [':mid' => $mid]) !== null) return false;
            $this->insertMessage(['id' => $this->uuid4(), 'contact_id' => $contact['id'], 'mid' => $mid, 'direction' => 'inbound', 'message_type' => $type, 'message_text' => $text, 'status' => 'received', 'payload_json' => $this->jsonEncode($event), 'message_at' => $at]);
            $this->touchConversation($contact, $text, $type, $at, true);
            return true;
        }
        return false;
    }

    private function sendMessagePayload(array $contact, array $message, ?string $replyToMid): array
    {
        $settings = $this->requireConfiguredSettings();
        $policy = $this->messagingPolicy($contact, $settings);
        $payload = ['recipient' => ['id' => (string) $contact['psid']], 'messaging_type' => $policy['type'], 'message' => $message];
        if ($policy['tag'] !== null) $payload['tag'] = $policy['tag'];
        if ($replyToMid !== null) $payload['reply_to'] = ['mid' => $replyToMid];
        return $this->graphRequest('POST', '/' . rawurlencode((string) $settings['page_id']) . '/messages', $payload, $settings);
    }

    private function messagingPolicy(array $contact, array $settings): array
    {
        $last = trim((string) ($contact['last_user_message_at'] ?? ''));
        if ($last === '') throw new RuntimeException('You can reply after this customer sends a new message.');
        $timestamp = strtotime($last . ' UTC');
        $age = $timestamp === false ? PHP_INT_MAX : max(0, time() - $timestamp);
        if ($age <= 86400) return ['type' => 'RESPONSE', 'tag' => null];
        if (!empty($settings['human_agent_enabled']) && $age <= 604800) return ['type' => 'MESSAGE_TAG', 'tag' => 'HUMAN_AGENT'];
        throw new RuntimeException('You can reply after this customer sends a new message.');
    }

    private function sendSenderAction(string $psid, string $action): void
    {
        $settings = $this->requireConfiguredSettings();
        $this->graphRequest('POST', '/' . rawurlencode((string) $settings['page_id']) . '/messages', ['recipient' => ['id' => $psid], 'sender_action' => $action], $settings);
    }

    private function validReplyMid(array $contact, $value): ?string
    {
        $mid = trim((string) ($value ?? ''));
        if ($mid === '') return null;
        $row = $this->database->fetchOne('SELECT mid FROM messenger_messages WHERE contact_id = :contact AND mid = :mid LIMIT 1', [':contact' => $contact['id'], ':mid' => $mid]);
        return $row === null ? null : $mid;
    }

    private function settingsRow(): ?array
    {
        return $this->database->fetchOne('SELECT * FROM messenger_settings WHERE id = :id LIMIT 1', [':id' => self::SETTINGS_ID]);
    }

    private function settingsWithEnvironment(?array $row): array
    {
        $row = $row ?? [];
        $fallbacks = [
            'page_access_token' => $this->config->get('MESSENGER_PAGE_ACCESS_TOKEN'),
            'page_id' => $this->config->get('MESSENGER_PAGE_ID'),
            'verify_token' => $this->config->get('MESSENGER_VERIFY_TOKEN'),
            'app_secret' => $this->config->get('MESSENGER_APP_SECRET'),
            'graph_version' => $this->config->get('MESSENGER_GRAPH_VERSION', self::DEFAULT_GRAPH_VERSION),
        ];
        foreach ($fallbacks as $key => $value) {
            if (trim((string) ($row[$key] ?? '')) === '' && trim((string) ($value ?? '')) !== '') $row[$key] = $value;
        }
        return $row;
    }

    private function settingsResponse(?array $row): array
    {
        $settings = $this->settingsWithEnvironment($row);
        $webhookUrl = trim((string) ($this->config->get('MESSENGER_WEBHOOK_URL', '') ?? '')) ?: $this->inferredWebhookUrl();
        return [
            'pageAccessToken' => (string) ($settings['page_access_token'] ?? ''),
            'pageId' => (string) ($settings['page_id'] ?? ''),
            'verifyToken' => (string) ($settings['verify_token'] ?? ''),
            'appSecret' => (string) ($settings['app_secret'] ?? ''),
            'graphVersion' => $this->normalizeGraphVersion($settings['graph_version'] ?? self::DEFAULT_GRAPH_VERSION),
            'pageName' => (string) ($settings['page_name'] ?? ''),
            'pageUsername' => (string) ($settings['page_username'] ?? ''),
            'pagePictureUrl' => (string) ($settings['page_picture_url'] ?? ''),
            'humanAgentEnabled' => !empty($settings['human_agent_enabled']),
            'webhookUrl' => $webhookUrl,
            'configured' => $this->isConfigured($settings),
            'webhookConfigured' => trim((string) ($settings['verify_token'] ?? '')) !== '' && trim((string) ($settings['app_secret'] ?? '')) !== '',
            'subscribed' => !empty($settings['subscribed']),
            'subscribedFields' => array_values(array_filter(array_map('strval', $this->jsonDecodeList($settings['subscribed_fields'] ?? null)))),
        ];
    }

    private function profileResponse(array $row): array
    {
        return [
            'greeting' => (string) ($row['greeting'] ?? ''),
            'getStartedEnabled' => !empty($row['get_started_enabled']),
            'iceBreakers' => array_values(array_slice(array_filter(array_map('strval', $this->jsonDecodeList($row['ice_breakers_json'] ?? null))), 0, 4)),
        ];
    }

    private function inferredWebhookUrl(): string
    {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? 'http');
        $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
        if ($host === '') return '';
        $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'));
        $directory = trim(str_replace('\\', '/', dirname($script)), '/.');
        return $scheme . '://' . $host . ($directory !== '' ? '/' . $directory : '') . '/messenger-webhook.php';
    }

    private function requireConfiguredSettings(bool $requireWebhook = false): array
    {
        $settings = $this->settingsWithEnvironment($this->settingsRow());
        if (!$this->isConfigured($settings)) throw new RuntimeException('Messenger is not ready yet. Ask an administrator to finish the setup in Settings.');
        if ($requireWebhook && (trim((string) ($settings['verify_token'] ?? '')) === '' || trim((string) ($settings['app_secret'] ?? '')) === '')) throw new RuntimeException('Add the Verify Token and Meta App Secret before subscribing the Page.');
        return $settings;
    }

    private function isConfigured(?array $settings): bool
    {
        $settings = $this->settingsWithEnvironment($settings);
        return trim((string) ($settings['page_access_token'] ?? '')) !== '' && trim((string) ($settings['page_id'] ?? '')) !== '';
    }

    private function upsertSettings(array $updates): void
    {
        $existing = $this->settingsRow();
        $now = $this->database->nowUtc();
        if ($existing !== null) {
            $sets = [];
            $bindings = [':id' => self::SETTINGS_ID, ':updated' => $now];
            foreach ($updates as $column => $value) { $sets[] = $column . ' = :' . $column; $bindings[':' . $column] = $value; }
            $sets[] = 'updated_at = :updated';
            $this->database->execute('UPDATE messenger_settings SET ' . implode(', ', $sets) . ' WHERE id = :id', $bindings);
            return;
        }
        $columns = array_merge(['id'], array_keys($updates), ['created_at', 'updated_at']);
        $bindings = [':id' => self::SETTINGS_ID, ':created_at' => $now, ':updated_at' => $now];
        foreach ($updates as $column => $value) $bindings[':' . $column] = $value;
        $this->database->execute('INSERT INTO messenger_settings (' . implode(', ', $columns) . ') VALUES (' . implode(', ', array_map(static fn(string $column): string => ':' . $column, $columns)) . ')', $bindings);
    }

    private function resolveContact(array $params): array
    {
        $contactId = trim((string) ($params['contactId'] ?? ''));
        if ($contactId === '') throw new RuntimeException('Choose a Messenger conversation.');
        $contact = $this->database->fetchOne('SELECT * FROM messenger_contacts WHERE id = :id LIMIT 1', [':id' => $contactId]);
        if ($contact === null) throw new RuntimeException('Messenger conversation not found.');
        return $contact;
    }

    private function findOrCreateContact(string $psid, ?array $settings): array
    {
        $existing = $this->database->fetchOne('SELECT * FROM messenger_contacts WHERE psid = :psid LIMIT 1', [':psid' => $psid]);
        if ($existing !== null) return $existing;
        $profile = [];
        try {
            if ($this->isConfigured($settings)) $profile = $this->graphRequest('GET', '/' . rawurlencode($psid), null, $settings, ['fields' => 'first_name,last_name,name,profile_pic,locale'], 5);
        } catch (\Throwable $exception) {
            $profile = [];
        }
        $first = trim((string) ($profile['first_name'] ?? ''));
        $last = trim((string) ($profile['last_name'] ?? ''));
        $name = trim((string) ($profile['name'] ?? trim($first . ' ' . $last))) ?: 'Messenger customer';
        $now = $this->database->nowUtc();
        $id = $this->uuid4();
        $this->database->execute(
            'INSERT INTO messenger_contacts (id, psid, name, first_name, last_name, profile_picture_url, locale, created_at, updated_at)
             VALUES (:id, :psid, :name, :first, :last, :picture, :locale, :created, :updated)',
            [
                ':id' => $id, ':psid' => $psid, ':name' => $name, ':first' => $this->stringOrNull($first), ':last' => $this->stringOrNull($last),
                ':picture' => $this->stringOrNull($profile['profile_pic'] ?? null), ':locale' => $this->stringOrNull($profile['locale'] ?? null), ':created' => $now, ':updated' => $now,
            ]
        );
        return $this->database->fetchOne('SELECT * FROM messenger_contacts WHERE id = :id', [':id' => $id]) ?: ['id' => $id, 'psid' => $psid, 'name' => $name];
    }

    private function touchConversation(array $contact, string $preview, string $type, string $at, bool $inbound): void
    {
        $sql = 'UPDATE messenger_contacts SET last_message_preview = :preview, last_message_type = :type, last_message_at = :at, updated_at = :updated';
        if ($inbound) $sql .= ', unread_count = unread_count + 1, last_user_message_at = :at';
        $sql .= ' WHERE id = :id';
        $this->database->execute($sql, [':preview' => $this->preview($preview), ':type' => $type, ':at' => $at, ':updated' => $this->database->nowUtc(), ':id' => $contact['id']]);
    }

    private function touchUserWindow(array $contact, string $at): void
    {
        $this->database->execute('UPDATE messenger_contacts SET last_user_message_at = :at, updated_at = :updated WHERE id = :id', [':at' => $at, ':updated' => $this->database->nowUtc(), ':id' => $contact['id']]);
    }

    private function insertMessage(array $values): array
    {
        $defaults = ['attachment_url' => null, 'attachment_id' => null, 'attachments_json' => null, 'media_mime_type' => null, 'file_name' => null, 'error_code' => null, 'error_message' => null, 'reply_to_mid' => null, 'reaction' => null, 'reaction_actor' => null, 'quick_reply_payload' => null, 'quick_replies_json' => null, 'payload_json' => null, 'created_by' => null];
        $values = array_merge($defaults, $values);
        $values['created_at'] = $values['created_at'] ?? $this->database->nowUtc();
        $values['updated_at'] = $values['updated_at'] ?? $values['created_at'];
        $columns = array_keys($values);
        $bindings = [];
        foreach ($values as $column => $value) $bindings[':' . $column] = $value;
        $this->database->execute('INSERT INTO messenger_messages (' . implode(', ', $columns) . ') VALUES (' . implode(', ', array_keys($bindings)) . ')', $bindings);
        return $this->database->fetchOne('SELECT * FROM messenger_messages WHERE id = :id', [':id' => $values['id']]) ?: $values;
    }

    private function storeOutboundMessage(array $contact, string $mid, string $type, string $text, ?string $url, ?string $attachmentId, ?string $mime, string $status, ?string $createdBy, ?string $replyToMid = null, ?string $fileName = null, array $metadata = []): array
    {
        $now = $this->database->nowUtc();
        $existing = $this->database->fetchOne('SELECT * FROM messenger_messages WHERE mid = :mid LIMIT 1', [':mid' => $mid]);
        if ($existing !== null) {
            $this->touchConversation($contact, $text !== '' ? $text : $this->attachmentPreview($type), $type, $now, false);
            return $existing;
        }
        $row = $this->insertMessage([
            'id' => $this->uuid4(), 'contact_id' => $contact['id'], 'mid' => $mid, 'direction' => 'outbound', 'message_type' => $type,
            'message_text' => $text, 'attachment_url' => $url, 'attachment_id' => $attachmentId, 'media_mime_type' => $mime, 'file_name' => $fileName,
            'status' => $status, 'reply_to_mid' => $replyToMid, 'quick_replies_json' => isset($metadata['quickReplies']) ? $this->jsonEncode($metadata['quickReplies']) : null,
            'payload_json' => $metadata === [] ? null : $this->jsonEncode($metadata), 'message_at' => $now, 'created_by' => $createdBy,
        ]);
        $this->touchConversation($contact, $text !== '' ? $text : $this->attachmentPreview($type), $type, $now, false);
        return $row;
    }

    private function updateMessageStatus(string $mid, string $status): void
    {
        $allowed = $status === 'delivered' ? "AND status IN ('sent', 'accepted', 'received')" : "AND status <> 'failed'";
        $this->database->execute("UPDATE messenger_messages SET status = :status, updated_at = :updated WHERE mid = :mid AND direction = 'outbound' " . $allowed, [':status' => $status, ':updated' => $this->database->nowUtc(), ':mid' => $mid]);
    }

    private function updateStatusByWatermark(string $contactId, int $watermark, string $status): void
    {
        if ($watermark <= 0) return;
        $at = gmdate('Y-m-d H:i:s', (int) floor($watermark / 1000));
        $allowed = $status === 'delivered' ? "AND status IN ('sent', 'accepted', 'received')" : "AND status <> 'failed'";
        $this->database->execute("UPDATE messenger_messages SET status = :status, updated_at = :updated WHERE contact_id = :contact AND direction = 'outbound' AND message_at <= :at " . $allowed, [':status' => $status, ':updated' => $this->database->nowUtc(), ':at' => $at, ':contact' => $contactId]);
    }

    private function uploadAttachment(string $bytes, string $mime, string $fileName, string $type, array $settings): string
    {
        if (!function_exists('curl_init')) throw new RuntimeException('PHP cURL is required for Messenger attachments.');
        $temporary = tempnam(sys_get_temp_dir(), 'mamepilot_messenger_');
        if ($temporary === false || file_put_contents($temporary, $bytes) === false) throw new RuntimeException('Could not prepare the Messenger attachment.');
        try {
            $url = $this->graphBase($settings) . '/' . rawurlencode((string) $settings['page_id']) . '/message_attachments';
            $handle = curl_init($url);
            curl_setopt_array($handle, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 90,
                CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . (string) $settings['page_access_token']],
                CURLOPT_POSTFIELDS => [
                    'message' => $this->jsonEncode(['attachment' => ['type' => $type, 'payload' => ['is_reusable' => true]]]),
                    'filedata' => new \CURLFile($temporary, $mime, $fileName),
                ],
            ]);
            $raw = curl_exec($handle); $error = curl_error($handle); $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE); curl_close($handle);
            $decoded = is_string($raw) ? json_decode($raw, true) : null;
            if ($raw === false || $error !== '') throw new RuntimeException('Messenger attachment upload failed: ' . $error);
            if ($status < 200 || $status >= 300 || !is_array($decoded) || isset($decoded['error'])) throw new RuntimeException($this->metaError($decoded, 'Messenger attachment upload failed.'));
            $id = trim((string) ($decoded['attachment_id'] ?? ''));
            if ($id === '') throw new RuntimeException('Meta did not return an attachment ID.');
            return $id;
        } finally {
            @unlink($temporary);
        }
    }

    private function graphRequest(string $method, string $path, ?array $body, ?array $settings, array $query = [], int $timeoutSeconds = 60): array
    {
        $settings = $this->settingsWithEnvironment($settings);
        if (!function_exists('curl_init')) throw new RuntimeException('PHP cURL is required for Messenger.');
        $url = $this->graphBase($settings) . '/' . ltrim($path, '/');
        if ($query !== []) $url .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
        $handle = curl_init($url);
        $headers = ['Accept: application/json', 'Authorization: Bearer ' . (string) ($settings['page_access_token'] ?? '')];
        $options = [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => min(10, max(2, $timeoutSeconds)), CURLOPT_TIMEOUT => max(2, $timeoutSeconds), CURLOPT_CUSTOMREQUEST => strtoupper($method), CURLOPT_HTTPHEADER => $headers];
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            $options[CURLOPT_HTTPHEADER] = $headers;
            $options[CURLOPT_POSTFIELDS] = $this->jsonEncode($body);
        }
        curl_setopt_array($handle, $options);
        $raw = curl_exec($handle); $error = curl_error($handle); $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE); curl_close($handle);
        if ($raw === false || $error !== '') throw new RuntimeException('Meta Messenger API request failed: ' . $error);
        $decoded = json_decode((string) $raw, true);
        if ($status < 200 || $status >= 300 || !is_array($decoded) || isset($decoded['error'])) throw new RuntimeException($this->metaError($decoded, 'Meta Messenger API request failed.') . ($status > 0 ? ' (HTTP ' . $status . ')' : ''));
        return $decoded;
    }

    private function graphBase(array $settings): string
    {
        return 'https://graph.facebook.com/' . $this->normalizeGraphVersion($settings['graph_version'] ?? self::DEFAULT_GRAPH_VERSION);
    }

    private function subscriptionState(array $settings): array
    {
        $response = $this->graphRequest('GET', '/' . rawurlencode((string) $settings['page_id']) . '/subscribed_apps', null, $settings, ['fields' => 'id,subscribed_fields']);
        $fields = [];
        $subscribed = false;
        foreach ((array) ($response['data'] ?? []) as $row) {
            if (!is_array($row) || (string) ($row['id'] ?? '') === '') continue;
            $subscribed = true;
            $fields = array_values(array_unique(array_merge($fields, array_map('strval', (array) ($row['subscribed_fields'] ?? [])))));
        }
        sort($fields);
        return ['subscribed' => $subscribed, 'fields' => $fields];
    }

    private function metaError($response, string $fallback): string
    {
        if (!is_array($response)) return $fallback;
        $error = is_array($response['error'] ?? null) ? $response['error'] : [];
        return trim((string) ($error['error_user_msg'] ?? $error['message'] ?? $fallback)) ?: $fallback;
    }

    private function normalizeGraphVersion($value): string
    {
        $version = strtolower(trim((string) ($value ?? self::DEFAULT_GRAPH_VERSION)));
        if (!preg_match('/^v\d+\.\d+$/', $version)) return self::DEFAULT_GRAPH_VERSION;
        return $version;
    }

    private function mediaMessageType(string $mime): string
    {
        if (str_starts_with($mime, 'image/')) return 'image';
        if (str_starts_with($mime, 'audio/')) return 'audio';
        if (str_starts_with($mime, 'video/')) return 'video';
        return 'file';
    }

    private function attachmentPreview(string $type): string
    {
        return match ($type) { 'image' => 'Photo', 'audio' => 'Voice message', 'video' => 'Video', 'file' => 'File', 'sticker' => 'Sticker', 'template' => 'Card', default => ucfirst($type) };
    }

    private function timestampToDatabase($value): string
    {
        $timestamp = (int) $value;
        if ($timestamp > 9999999999) $timestamp = (int) floor($timestamp / 1000);
        return $timestamp > 0 ? gmdate('Y-m-d H:i:s', $timestamp) : $this->database->nowUtc();
    }

    private function mapContact(array $row, ?array $settings): array
    {
        $last = trim((string) ($row['last_user_message_at'] ?? ''));
        $age = $last === '' ? PHP_INT_MAX : max(0, time() - (strtotime($last . ' UTC') ?: 0));
        $humanEnabled = !empty($this->settingsWithEnvironment($settings)['human_agent_enabled']);
        $window = $age <= 86400 ? 'standard' : (($humanEnabled && $age <= 604800) ? 'human_agent' : 'closed');
        $name = trim((string) ($row['name'] ?? '')) ?: trim((string) (($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? ''))) ?: 'Messenger customer';
        return [
            'id' => (string) ($row['id'] ?? ''), 'psid' => (string) ($row['psid'] ?? ''), 'name' => $name,
            'firstName' => (string) ($row['first_name'] ?? ''), 'lastName' => (string) ($row['last_name'] ?? ''),
            'profilePictureUrl' => (string) ($row['profile_picture_url'] ?? ''), 'locale' => (string) ($row['locale'] ?? ''),
            'unreadCount' => (int) ($row['unread_count'] ?? 0), 'lastMessagePreview' => (string) ($row['last_message_preview'] ?? ''),
            'lastMessageType' => (string) ($row['last_message_type'] ?? ''), 'lastMessageAt' => $this->toIso($row['last_message_at'] ?? null),
            'lastUserMessageAt' => $this->toIso($row['last_user_message_at'] ?? null), 'canReply' => $window !== 'closed', 'replyWindow' => $window,
            'createdAt' => $this->toIso($row['created_at'] ?? null), 'updatedAt' => $this->toIso($row['updated_at'] ?? null),
        ];
    }

    private function mapMessage(array $row): array
    {
        $quickReplies = [];
        foreach ($this->jsonDecodeList($row['quick_replies_json'] ?? null) as $reply) {
            if (!is_array($reply)) continue;
            $quickReplies[] = ['title' => (string) ($reply['title'] ?? ''), 'payload' => (string) ($reply['payload'] ?? ''), 'imageUrl' => (string) ($reply['image_url'] ?? '')];
        }
        $attachments = [];
        foreach ($this->jsonDecodeList($row['attachments_json'] ?? null) as $attachment) {
            if (!is_array($attachment)) continue;
            $attachments[] = ['type' => (string) ($attachment['type'] ?? ''), 'url' => (string) ($attachment['payload']['url'] ?? ''), 'title' => (string) ($attachment['title'] ?? '')];
        }
        return [
            'id' => (string) ($row['id'] ?? ''), 'mid' => (string) ($row['mid'] ?? ''), 'contactId' => (string) ($row['contact_id'] ?? ''),
            'direction' => (string) ($row['direction'] ?? ''), 'type' => (string) ($row['message_type'] ?? 'text'), 'text' => (string) ($row['message_text'] ?? ''),
            'attachmentUrl' => (string) ($row['attachment_url'] ?? ''), 'attachmentId' => (string) ($row['attachment_id'] ?? ''),
            'attachments' => $attachments, 'mimeType' => (string) ($row['media_mime_type'] ?? ''), 'fileName' => (string) ($row['file_name'] ?? ''),
            'status' => (string) ($row['status'] ?? ''), 'errorCode' => (string) ($row['error_code'] ?? ''), 'errorMessage' => (string) ($row['error_message'] ?? ''),
            'replyToMid' => (string) ($row['reply_to_mid'] ?? ''), 'reaction' => (string) ($row['reaction'] ?? ''), 'reactionActor' => (string) ($row['reaction_actor'] ?? ''),
            'quickReplies' => $quickReplies, 'messageAt' => $this->toIso($row['message_at'] ?? null), 'createdAt' => $this->toIso($row['created_at'] ?? null),
        ];
    }

    private function preview(string $text): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text) ?: '');
        return mb_strlen($text) > 500 ? mb_substr($text, 0, 497) . '...' : $text;
    }

    private function stringOrNull($value): ?string
    {
        $value = trim((string) ($value ?? ''));
        return $value === '' ? null : $value;
    }

    private function ensureTables(): void
    {
        if (!$this->tableExists('messenger_settings')) $this->database->execute("CREATE TABLE IF NOT EXISTS messenger_settings (id VARCHAR(64) NOT NULL, page_access_token TEXT NULL, page_id VARCHAR(64) NULL, verify_token VARCHAR(255) NULL, app_secret VARCHAR(500) NULL, graph_version VARCHAR(16) NOT NULL DEFAULT 'v25.0', page_name VARCHAR(191) NULL, page_username VARCHAR(191) NULL, page_picture_url VARCHAR(1000) NULL, human_agent_enabled TINYINT(1) NOT NULL DEFAULT 0, subscribed TINYINT(1) NOT NULL DEFAULT 0, subscribed_fields LONGTEXT NULL, greeting VARCHAR(160) NULL, get_started_enabled TINYINT(1) NOT NULL DEFAULT 0, ice_breakers_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        if (!$this->tableExists('messenger_contacts')) $this->database->execute("CREATE TABLE IF NOT EXISTS messenger_contacts (id VARCHAR(64) NOT NULL, psid VARCHAR(191) NOT NULL, name VARCHAR(191) NULL, first_name VARCHAR(100) NULL, last_name VARCHAR(100) NULL, profile_picture_url VARCHAR(1000) NULL, locale VARCHAR(32) NULL, unread_count INT NOT NULL DEFAULT 0, last_message_preview VARCHAR(500) NULL, last_message_type VARCHAR(32) NULL, last_message_at DATETIME NULL, last_user_message_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_messenger_contacts_psid (psid), KEY idx_messenger_contacts_last_message (last_message_at), KEY idx_messenger_contacts_unread (unread_count)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        if (!$this->tableExists('messenger_messages')) $this->database->execute("CREATE TABLE IF NOT EXISTS messenger_messages (id VARCHAR(64) NOT NULL, contact_id VARCHAR(64) NOT NULL, mid VARCHAR(255) NULL, direction VARCHAR(16) NOT NULL, message_type VARCHAR(32) NOT NULL DEFAULT 'text', message_text LONGTEXT NULL, attachment_url VARCHAR(1500) NULL, attachment_id VARCHAR(255) NULL, attachments_json LONGTEXT NULL, media_mime_type VARCHAR(127) NULL, file_name VARCHAR(255) NULL, status VARCHAR(32) NOT NULL DEFAULT 'received', error_code VARCHAR(64) NULL, error_message TEXT NULL, reply_to_mid VARCHAR(255) NULL, reaction VARCHAR(64) NULL, reaction_actor VARCHAR(16) NULL, quick_reply_payload VARCHAR(500) NULL, quick_replies_json LONGTEXT NULL, payload_json LONGTEXT NULL, message_at DATETIME NOT NULL, created_by VARCHAR(64) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_messenger_messages_mid (mid), KEY idx_messenger_messages_contact_time (contact_id, message_at), KEY idx_messenger_messages_status (status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
