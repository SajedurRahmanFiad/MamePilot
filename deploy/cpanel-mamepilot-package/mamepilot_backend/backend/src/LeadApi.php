<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

/** Lead intelligence, model-driven lookup tools, and lead projections. */
final class LeadApi extends BaseService
{
    public function __construct(Database $database, Auth $auth, Config $config, private MasterDataApi $masterData, private OperationsApi $operations)
    {
        parent::__construct($database, $auth, $config);
    }

    public function fetchLeadsPage(array $params = []): array
    {
        $this->currentUser();
        $this->ensureTables();
        $this->syncChannelLeads();
        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = min(100, max(10, (int) ($params['pageSize'] ?? 25)));
        $search = trim((string) ($params['search'] ?? ''));
        $status = trim((string) ($params['status'] ?? ''));
        $channel = trim((string) ($params['channel'] ?? ''));
        $where = ['l.archived_at IS NULL'];
        $bindings = [];
        if ($status !== '') { $where[] = 'l.status = :status'; $bindings[':status'] = $status; }
        if ($channel !== '') { $where[] = 'l.source_channel = :channel'; $bindings[':channel'] = $channel; }
        if ($search !== '') { $where[] = '(COALESCE(mc.name, wc.name, wc.profile_name, \'\') LIKE :search OR COALESCE(wc.phone_number, \'\') LIKE :search OR JSON_UNQUOTE(JSON_EXTRACT(l.profile_json, \'$.identity.phone.value\')) LIKE :search)'; $bindings[':search'] = '%' . $search . '%'; }
        $whereSql = implode(' AND ', $where);
        $count = $this->database->fetchOne('SELECT COUNT(*) AS total FROM lead_profiles l LEFT JOIN messenger_contacts mc ON mc.id = l.messenger_contact_id LEFT JOIN whatsapp_contacts wc ON wc.id = l.whatsapp_contact_id WHERE ' . $whereSql, $bindings);
        $offset = ($page - 1) * $pageSize;
        $rows = $this->database->fetchAll('SELECT l.*, mc.name AS messenger_name, wc.name AS whatsapp_name, wc.profile_name AS whatsapp_profile, wc.phone_number AS whatsapp_phone, mc.last_message_preview AS messenger_preview, wc.last_message_preview AS whatsapp_preview FROM lead_profiles l LEFT JOIN messenger_contacts mc ON mc.id = l.messenger_contact_id LEFT JOIN whatsapp_contacts wc ON wc.id = l.whatsapp_contact_id WHERE ' . $whereSql . ' ORDER BY l.updated_at DESC LIMIT ' . $pageSize . ' OFFSET ' . $offset, $bindings);
        return ['data' => array_map(fn(array $row): array => $this->mapLead($row), $rows), 'count' => (int) ($count['total'] ?? 0)];
    }

    public function fetchLeadById(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $lead = $this->leadRow((string) ($params['leadId'] ?? $params['id'] ?? ''));
        if ($lead === null) throw new RuntimeException('Lead not found.');
        return $this->leadResponse($lead);
    }

    /** Called by the chat surfaces; it creates the projection if the contact is new. */
    public function fetchLeadIntelligence(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $lead = $this->resolveLead($params);
        if ($lead === null) throw new RuntimeException('Conversation lead could not be resolved.');
        $latest = $this->latestMessageId($lead);
        if ($latest !== '' && (string) ($lead['last_analyzed_message_id'] ?? '') !== $latest && $this->activeModelRow($lead) !== null) {
            try { $lead = $this->runAnalysis($lead, false); $this->maybeCreateConfirmedOrder($lead); } catch (\Throwable $exception) {
                $this->saveEvent((string) $lead['id'], 'analysis_failed', ['message' => $exception->getMessage()]);
            }
        }
        return $this->leadResponse($this->leadRow((string) $lead['id']) ?: $lead);
    }

    public function analyzeLead(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $lead = $this->resolveLead($params);
        if ($lead === null) throw new RuntimeException('Conversation lead could not be resolved.');
        $lead = $this->runAnalysis($lead, true);
        $this->maybeCreateConfirmedOrder($lead);
        return $this->leadResponse($this->leadRow((string) $lead['id']) ?: $lead);
    }

    public function fetchLeadEvents(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $since = max(0, (int) ($params['since'] ?? 0));
        $leadId = trim((string) ($params['leadId'] ?? ''));
        $where = $leadId !== '' ? 'WHERE id > :since AND lead_id = :lead' : 'WHERE id > :since';
        $bindings = [':since' => $since];
        if ($leadId !== '') $bindings[':lead'] = $leadId;
        $rows = $this->database->fetchAll('SELECT id, lead_id, event_type, payload_json, created_at FROM lead_events ' . $where . ' ORDER BY id ASC LIMIT 100', $bindings);
        $last = $since;
        $events = [];
        foreach ($rows as $row) { $last = max($last, (int) $row['id']); $events[] = ['id' => (int) $row['id'], 'leadId' => (string) $row['lead_id'], 'type' => (string) $row['event_type'], 'payload' => $this->jsonDecodeAssoc($row['payload_json'] ?? []), 'createdAt' => $this->toIso($row['created_at'] ?? null)]; }
        return ['cursor' => $last, 'events' => $events];
    }

    public function markLeadSuggestionSent(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $id = trim((string) ($params['suggestionId'] ?? ''));
        if ($id === '') throw new RuntimeException('A suggestion is required.');
        $this->database->execute("UPDATE lead_suggestions SET status = 'sent', sent_message_id = :message WHERE id = :id", [':message' => $this->stringOrNull($params['messageId'] ?? null), ':id' => $id]);
        return ['ok' => true];
    }

    /** Creates a lead projection from a webhook without requiring an authenticated app user. */
    public function ensureLeadFromChannel(string $channel, string $contactId): ?array
    {
        $this->ensureTables();
        return $this->resolveLead(['channel' => $channel, 'contactId' => $contactId]);
    }

    private function runAnalysis(array $lead, bool $allowOrder): array
    {
        $model = $this->activeModelRow($lead);
        if ($model === null) return $lead;
        $messages = $this->conversationMessages($lead);
        if ($messages === []) return $lead;
        $runId = $this->uuid4();
        $this->database->execute('INSERT INTO lead_analysis_runs (id, lead_id, trigger_message_id, model_id, status, created_at) VALUES (:id, :lead, :message, :model, \'running\', :created)', [':id' => $runId, ':lead' => $lead['id'], ':message' => $messages[count($messages) - 1]['id'], ':model' => $model['id'], ':created' => $this->database->nowUtc()]);
        try {
            $system = $this->analysisSystemPrompt($model);
            $history = array_map(static fn(array $message): array => ['role' => $message['direction'] === 'outbound' ? 'assistant' : 'user', 'content' => $message['text']], array_slice($messages, -30));
            $media = [];
            foreach (array_slice($messages, -4) as $message) {
                if ($message['mediaUrl'] === '') continue;
                $type = strtolower((string) $message['type']);
                if ($type === 'image' && empty($model['supports_vision'])) continue;
                if ($type === 'audio' && empty($model['supports_audio'])) continue;
                $media[] = $this->prepareMediaInput($message);
            }
            $prompt = $this->analysisUserPrompt($lead, $messages);
            $result = '';
            for ($attempt = 0; $attempt < 3; $attempt++) {
                $result = (new LlmClient($this->database, $this->config))->generateMultimodal($this->mapModel($model), $system, $prompt, $history, $media, ['temperature' => (float) $model['temperature'], 'maxTokens' => (int) $model['max_tokens']]);
                $decoded = json_decode($this->extractJson($result), true);
                if (!is_array($decoded)) throw new RuntimeException('Lead analysis did not return valid JSON.');
                if (isset($decoded['toolCall']) && is_array($decoded['toolCall'])) {
                    $toolResult = $this->runTool($decoded['toolCall'], $lead);
                    $prompt .= "\n\nTOOL RESULT (use this data; do not invent IDs):\n" . ($this->jsonEncode($toolResult) ?? '{}') . "\nReturn the final profile JSON now.";
                    continue;
                }
                $profile = $this->normalizeAnalysis($decoded, $lead, $messages);
                $this->saveAnalysis($lead, $runId, $profile, $messages[count($messages) - 1]['id']);
                $this->database->execute("UPDATE lead_analysis_runs SET status = 'completed', result_json = :result, completed_at = :completed WHERE id = :id", [':result' => $this->jsonEncode($profile), ':completed' => $this->database->nowUtc(), ':id' => $runId]);
                return $this->leadRow((string) $lead['id']) ?: $lead;
            }
            throw new RuntimeException('The analysis model did not return a final profile.');
        } catch (\Throwable $exception) {
            $this->database->execute("UPDATE lead_analysis_runs SET status = 'failed', error_message = :error, completed_at = :completed WHERE id = :id", [':error' => mb_substr($exception->getMessage(), 0, 1000), ':completed' => $this->database->nowUtc(), ':id' => $runId]);
            throw $exception;
        }
    }

    private function normalizeAnalysis(array $decoded, array $lead, array $messages): array
    {
        $profile = is_array($decoded['profile'] ?? null) ? $decoded['profile'] : $decoded;
        $profile['schemaVersion'] = 1;
        if (!isset($profile['suggestions']) && isset($decoded['suggestions'])) $profile['suggestions'] = $decoded['suggestions'];
        $profile['sales'] = is_array($profile['sales'] ?? null) ? $profile['sales'] : [];
        $profile['recommendation'] = is_array($profile['recommendation'] ?? null) ? $profile['recommendation'] : [];
        $profile['orderConfirmation'] = is_array($profile['orderConfirmation'] ?? null) ? $profile['orderConfirmation'] : [];
        $profile['analysis'] = ['notices' => array_values(array_filter(array_map('strval', (array) ($decoded['notices'] ?? $profile['analysis']['notices'] ?? [])))), 'updatedAt' => gmdate('c')];
        $score = max(0, min(100, (float) ($decoded['score'] ?? $profile['sales']['orderProbability'] ?? 0)));
        $probability = max(0, min(100, (float) ($decoded['orderProbability'] ?? $profile['sales']['orderProbability'] ?? $score)));
        $profile['sales']['orderProbability'] = $probability;
        $stage = trim((string) ($decoded['stage'] ?? $profile['sales']['stage'] ?? 'active')) ?: 'active';
        $status = $probability >= 80 ? 'high_intent' : ($probability >= 50 ? 'qualified' : 'active');
        $this->database->execute('UPDATE lead_profiles SET status = :status, stage = :stage, score = :score, order_probability = :probability, profile_json = :profile, last_analyzed_message_id = :message, last_message_at = :at, updated_at = :updated WHERE id = :id', [':status' => $status, ':stage' => $stage, ':score' => $score, ':probability' => $probability, ':profile' => $this->jsonEncode($profile), ':message' => $messages[count($messages) - 1]['id'], ':at' => $messages[count($messages) - 1]['messageAt'], ':updated' => $this->database->nowUtc(), ':id' => $lead['id']]);
        return $profile;
    }

    private function saveAnalysis(array $lead, string $runId, array $profile, string $messageId): void
    {
        $this->database->execute('DELETE FROM lead_suggestions WHERE lead_id = :lead AND status = \'available\'', [':lead' => $lead['id']]);
        foreach ((array) ($profile['suggestions'] ?? []) as $suggestion) {
            if (!is_array($suggestion) || trim((string) ($suggestion['text'] ?? '')) === '') continue;
            $this->database->execute('INSERT INTO lead_suggestions (id, lead_id, analysis_run_id, suggestion_type, text, reason, confidence, status, created_at) VALUES (:id, :lead, :run, :type, :text, :reason, :confidence, \'available\', :created)', [':id' => $this->uuid4(), ':lead' => $lead['id'], ':run' => $runId, ':type' => trim((string) ($suggestion['type'] ?? 'next_step')), ':text' => trim((string) $suggestion['text']), ':reason' => $this->stringOrNull($suggestion['reason'] ?? null), ':confidence' => max(0, min(100, (float) ($suggestion['confidence'] ?? 0))), ':created' => $this->database->nowUtc()]);
        }
        $this->saveEvent((string) $lead['id'], 'analysis_updated', ['messageId' => $messageId, 'score' => $profile['sales']['orderProbability'] ?? 0]);
        if (($profile['orderConfirmation']['status'] ?? '') === 'confirmed') $this->saveEvent((string) $lead['id'], 'order_confirmation_detected', ['evidenceMessageIds' => $profile['orderConfirmation']['evidenceMessageIds'] ?? []]);
    }

    private function maybeCreateConfirmedOrder(array $lead): void
    {
        $profile = $this->jsonDecodeAssoc($lead['profile_json'] ?? []);
        if ((string) ($profile['orderConfirmation']['status'] ?? '') !== 'confirmed') return;
        $existing = $this->database->fetchOne("SELECT id FROM lead_events WHERE lead_id = :lead AND event_type = 'order_created' LIMIT 1", [':lead' => $lead['id']]);
        if ($existing !== null) return;
        $name = trim((string) ($profile['identity']['name']['value'] ?? ''));
        $phone = trim((string) ($profile['identity']['phone']['value'] ?? ''));
        $address = trim((string) ($profile['identity']['address']['value'] ?? ''));
        $interest = is_array($profile['interest'][0] ?? null) ? $profile['interest'][0] : [];
        $productId = trim((string) ($interest['productId'] ?? ''));
        $quantity = max(0, (float) ($interest['quantity'] ?? 0));
        if ($name === '' || $phone === '' || $address === '' || $productId === '' || $quantity <= 0) {
            $this->saveEvent((string) $lead['id'], 'order_blocked_missing_information', ['missing' => array_values(array_filter(['name' => $name === '' ? 'name' : '', 'phone' => $phone === '' ? 'phone' : '', 'address' => $address === '' ? 'address' : '', 'product' => $productId === '' ? 'product' : '', 'quantity' => $quantity <= 0 ? 'quantity' : '']))]);
            return;
        }
        $product = $this->database->fetchOne('SELECT id, name, sale_price, stock FROM products WHERE id = :id AND deleted_at IS NULL LIMIT 1', [':id' => $productId]);
        if ($product === null) { $this->saveEvent((string) $lead['id'], 'order_blocked_product_not_found', ['productId' => $productId]); return; }
        $normalizedPhone = preg_replace('/\D+/', '', $phone) ?: $phone;
        $customer = $this->database->fetchOne('SELECT * FROM customers WHERE deleted_at IS NULL AND REPLACE(REPLACE(phone, \'+\', \'\'), \'-\', \'\') LIKE :phone ORDER BY created_at ASC LIMIT 1', [':phone' => '%' . $normalizedPhone]);
        if ($customer === null) $customer = $this->masterData->createCustomer(['name' => $name, 'phone' => $phone, 'address' => $address]);
        $rate = (float) $product['sale_price']; $subtotal = $rate * $quantity;
        $order = $this->operations->createOrder(['id' => 'lead-order-' . $lead['id'], 'customerId' => $customer['id'], 'status' => 'On Hold', 'items' => [['productId' => $product['id'], 'productName' => $product['name'], 'rate' => $rate, 'quantity' => $quantity, 'amount' => $subtotal]], 'subtotal' => $subtotal, 'discount' => 0, 'shipping' => (float) ($profile['delivery']['shipping'] ?? 0), 'total' => $subtotal + (float) ($profile['delivery']['shipping'] ?? 0), 'paidAmount' => 0, 'notes' => 'Created from confirmed lead conversation.', 'sourceAd' => (string) ($profile['attribution']['adId'] ?? $profile['attribution']['adName'] ?? ''), 'history' => ['created' => $this->database->nowUtc()]]);
        $profile['order'] = ['id' => $order['id'] ?? null, 'orderNumber' => $order['orderNumber'] ?? null, 'customerId' => $customer['id'], 'createdAt' => gmdate('c')];
        $this->database->execute('UPDATE lead_profiles SET status = \'converted\', stage = \'converted\', profile_json = :profile, updated_at = :updated WHERE id = :id', [':profile' => $this->jsonEncode($profile), ':updated' => $this->database->nowUtc(), ':id' => $lead['id']]);
        $this->saveEvent((string) $lead['id'], 'order_created', ['orderId' => $order['id'] ?? null, 'orderNumber' => $order['orderNumber'] ?? null, 'customerId' => $customer['id']]);
    }

    private function runTool(array $call, array $lead): array
    {
        $name = trim((string) ($call['name'] ?? ''));
        $arguments = is_array($call['arguments'] ?? null) ? $call['arguments'] : [];
        if ($name === 'search_products') return ['tool' => $name, 'results' => $this->searchProducts((string) ($arguments['query'] ?? ''), (int) ($arguments['limit'] ?? 8))];
        if ($name === 'find_customer') return ['tool' => $name, 'results' => $this->findCustomers((string) ($arguments['phone'] ?? ''), (string) ($arguments['name'] ?? ''))];
        if ($name === 'find_ads') return ['tool' => $name, 'results' => $this->searchAds((string) ($arguments['query'] ?? ''), (int) ($arguments['limit'] ?? 8))];
        if ($name === 'get_lead_context') return ['tool' => $name, 'result' => $this->jsonDecodeAssoc($lead['profile_json'] ?? [])];
        return ['tool' => $name, 'error' => 'Unknown or disallowed database tool.'];
    }

    private function searchProducts(string $query, int $limit): array
    {
        $query = trim($query); $limit = max(1, min(12, $limit)); if ($query === '') return [];
        $terms = array_values(array_filter(preg_split('/\s+/u', $query) ?: []));
        $where = ['deleted_at IS NULL']; $bindings = [];
        foreach ($terms as $index => $term) { $key = ':product_term_' . $index; $where[] = 'name LIKE ' . $key; $bindings[$key] = '%' . $term . '%'; }
        $rows = $this->database->fetchAll('SELECT id, name, category, sale_price, stock, image FROM products WHERE ' . implode(' AND ', $where) . ' ORDER BY created_at DESC LIMIT ' . $limit, $bindings);
        return array_map(static fn(array $row): array => ['id' => $row['id'], 'name' => $row['name'], 'category' => $row['category'], 'salePrice' => (float) $row['sale_price'], 'stock' => (float) $row['stock'], 'image' => $row['image'] ?? ''], $rows);
    }

    private function findCustomers(string $phone, string $name): array
    {
        $phone = preg_replace('/\D+/', '', $phone) ?: ''; $name = trim($name);
        if ($phone !== '') return $this->database->fetchAll('SELECT id, name, phone, address, total_orders FROM customers WHERE deleted_at IS NULL AND REPLACE(REPLACE(phone, \'+\', \'\'), \'-\', \'\') LIKE :phone LIMIT 5', [':phone' => '%' . $phone]);
        if ($name === '') return [];
        return $this->database->fetchAll('SELECT id, name, phone, address, total_orders FROM customers WHERE deleted_at IS NULL AND name LIKE :name ORDER BY created_at DESC LIMIT 5', [':name' => '%' . $name . '%']);
    }

    private function searchAds(string $query, int $limit): array
    {
        if (!$this->tableExists('meta_ads')) return [];
        $query = trim($query); $limit = max(1, min(12, $limit));
        if ($query === '') return $this->database->fetchAll('SELECT ma.id, ma.meta_ad_id, ma.name, mc.name AS campaign_name FROM meta_ads ma LEFT JOIN meta_campaigns mc ON mc.id = ma.campaign_id ORDER BY ma.updated_at DESC LIMIT ' . $limit);
        return $this->database->fetchAll('SELECT ma.id, ma.meta_ad_id, ma.name, mc.name AS campaign_name FROM meta_ads ma LEFT JOIN meta_campaigns mc ON mc.id = ma.campaign_id WHERE ma.name LIKE :query OR mc.name LIKE :query ORDER BY ma.updated_at DESC LIMIT ' . $limit, [':query' => '%' . $query . '%']);
    }

    private function analysisSystemPrompt(array $model): string
    {
        return trim((string) ($model['system_prompt'] ?? '')) . "\n\nYou are MamePilot's internal lead analyst. Return JSON only. Never invent customer facts, ad IDs, product IDs, prices, or order confirmations. When product/customer/ad data is needed, stop and return exactly {\"toolCall\":{\"name\":\"search_products\"|\"find_customer\"|\"find_ads\"|\"get_lead_context\",\"arguments\":{...}}}. Use only returned database results. Mark uncertain values with confidence and sourceMessageIds. Produce profile, score (0-100), orderProbability (0-100), stage, notices, and up to three suggestions with type, text, reason, confidence. An order is confirmed only by an explicit customer confirmation.";
    }

    private function analysisUserPrompt(array $lead, array $messages): string
    {
        $compact = ['leadId' => $lead['id'], 'currentProfile' => $this->jsonDecodeAssoc($lead['profile_json'] ?? []), 'attributionSignals' => array_values(array_filter(array_map(static fn(array $message): array => is_array($message['rawPayload'] ?? null) ? ($message['rawPayload']['message']['referral'] ?? $message['rawPayload']['referral'] ?? []) : [], $messages))), 'messages' => array_map(static fn(array $message): array => ['id' => $message['id'], 'direction' => $message['direction'], 'type' => $message['type'], 'text' => $message['text'], 'messageAt' => $message['messageAt']], array_slice($messages, -30))];
        return 'Analyze this lead and update the profile. Ask a database tool for products or customers only when necessary. Do not repeat the catalog in the prompt.\n' . ($this->jsonEncode($compact) ?? '{}');
    }

    private function prepareMediaInput(array $message): array
    {
        $url = trim((string) ($message['mediaUrl'] ?? ''));
        $mime = trim((string) ($message['mimeType'] ?? 'application/octet-stream'));
        $input = ['type' => (string) ($message['type'] ?? 'file'), 'url' => $this->absoluteMediaUrl($url), 'mimeType' => $mime];
        $path = $this->localMediaPath($url);
        if ($path !== null && is_file($path) && filesize($path) !== false && filesize($path) <= 8 * 1024 * 1024) {
            $bytes = file_get_contents($path);
            if ($bytes !== false) $input['base64'] = base64_encode($bytes);
        }
        return $input;
    }

    private function absoluteMediaUrl(string $url): string
    {
        if ($url === '' || preg_match('#^https?://#i', $url) === 1) return $url;
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
        return $host !== '' ? $scheme . '://' . $host . '/' . ltrim($url, '/') : $url;
    }

    private function localMediaPath(string $url): ?string
    {
        if ($url === '' || preg_match('#^https?://#i', $url) === 1) return null;
        $relative = '/' . ltrim(parse_url($url, PHP_URL_PATH) ?: $url, '/');
        $roots = [trim((string) ($_SERVER['DOCUMENT_ROOT'] ?? '')), dirname(dirname(__DIR__)) . DIRECTORY_SEPARATOR . 'public', dirname(dirname(dirname(__DIR__))) . DIRECTORY_SEPARATOR . 'public'];
        foreach ($roots as $root) {
            if ($root === '') continue;
            $candidate = rtrim($root, '/\\') . str_replace('/', DIRECTORY_SEPARATOR, $relative);
            if (is_file($candidate)) return $candidate;
        }
        return null;
    }

    private function extractJson(string $text): string
    {
        $text = trim(preg_replace('/^```(?:json)?|```$/mi', '', $text) ?? $text);
        $start = strpos($text, '{'); $end = strrpos($text, '}');
        return $start !== false && $end !== false && $end >= $start ? substr($text, $start, $end - $start + 1) : $text;
    }

    private function mapModel(array $row): array
    {
        return (new LlmClient($this->database, $this->config))->mapMultimodalConfiguration($row);
    }

    private function activeModelRow(array $lead): ?array
    {
        $id = trim((string) ($lead['assigned_model_id'] ?? ''));
        if ($id !== '') { $row = $this->database->fetchOne('SELECT * FROM multimodal_llm_configurations WHERE id = :id AND enabled = 1 LIMIT 1', [':id' => $id]); if ($row !== null) return $row; }
        if ($this->tableExists('multimodal_llm_assignments')) {
            $selected = $this->database->fetchOne("SELECT c.* FROM multimodal_llm_assignments a INNER JOIN multimodal_llm_configurations c ON c.id = a.configuration_id WHERE a.id = 'default' AND c.enabled = 1 LIMIT 1");
            if ($selected !== null) return $selected;
        }
        return $this->database->fetchOne('SELECT * FROM multimodal_llm_configurations WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 1');
    }

    private function conversationMessages(array $lead): array
    {
        if ((string) ($lead['source_channel'] ?? '') === 'messenger') {
            $rows = $this->database->fetchAll('SELECT id, direction, message_type, message_text, attachment_url, media_mime_type, payload_json, message_at FROM messenger_messages WHERE contact_id = :contact ORDER BY message_at DESC, created_at DESC LIMIT 50', [':contact' => $lead['messenger_contact_id']]);
        } else {
            $rows = $this->database->fetchAll('SELECT id, direction, message_type, message_text, media_url, media_mime_type, payload_json, message_at FROM whatsapp_messages WHERE contact_id = :contact ORDER BY message_at DESC, created_at DESC LIMIT 50', [':contact' => $lead['whatsapp_contact_id']]);
        }
        $rows = array_reverse($rows);
        return array_map(fn(array $row): array => ['id' => (string) $row['id'], 'direction' => (string) $row['direction'], 'type' => (string) $row['message_type'], 'text' => trim((string) ($row['message_text'] ?? '')), 'mediaUrl' => (string) ($row['attachment_url'] ?? $row['media_url'] ?? ''), 'mimeType' => (string) ($row['media_mime_type'] ?? ''), 'rawPayload' => $this->jsonDecodeAssoc($row['payload_json'] ?? []), 'messageAt' => (string) $row['message_at']], $rows);
    }

    private function latestMessageId(array $lead): string
    {
        $messages = $this->conversationMessages($lead); return $messages === [] ? '' : (string) $messages[count($messages) - 1]['id'];
    }

    private function resolveLead(array $params): ?array
    {
        $leadId = trim((string) ($params['leadId'] ?? $params['id'] ?? '')); if ($leadId !== '') return $this->leadRow($leadId);
        $channel = strtolower(trim((string) ($params['channel'] ?? ''))); $contactId = trim((string) ($params['contactId'] ?? '')); if (!in_array($channel, ['messenger', 'whatsapp'], true) || $contactId === '') return null;
        $column = $channel === 'messenger' ? 'messenger_contact_id' : 'whatsapp_contact_id'; $existing = $this->database->fetchOne('SELECT * FROM lead_profiles WHERE ' . $column . ' = :contact LIMIT 1', [':contact' => $contactId]);
        if ($existing !== null) return $existing;
        $id = $this->uuid4(); $this->database->execute('INSERT INTO lead_profiles (id, source_channel, ' . $column . ', profile_json, created_at, updated_at) VALUES (:id, :channel, :contact, :profile, :created, :updated)', [':id' => $id, ':channel' => $channel, ':contact' => $contactId, ':profile' => $this->jsonEncode(['schemaVersion' => 1, 'identity' => [], 'interest' => [], 'missingInformation' => [], 'orderConfirmation' => ['status' => 'not_detected']]), ':created' => $this->database->nowUtc(), ':updated' => $this->database->nowUtc()]);
        return $this->leadRow($id);
    }

    private function leadRow(string $id): ?array
    {
        if ($id === '') return null;
        return $this->database->fetchOne('SELECT l.*, mc.name AS messenger_name, mc.last_message_preview AS messenger_preview, wc.name AS whatsapp_name, wc.profile_name AS whatsapp_profile, wc.phone_number AS whatsapp_phone, wc.last_message_preview AS whatsapp_preview FROM lead_profiles l LEFT JOIN messenger_contacts mc ON mc.id = l.messenger_contact_id LEFT JOIN whatsapp_contacts wc ON wc.id = l.whatsapp_contact_id WHERE l.id = :id LIMIT 1', [':id' => $id]);
    }

    private function leadResponse(array $lead): array
    {
        $suggestions = $this->database->fetchAll("SELECT id, lead_id, suggestion_type, text, reason, confidence, status, created_at FROM lead_suggestions WHERE lead_id = :lead AND status = 'available' ORDER BY created_at DESC LIMIT 3", [':lead' => $lead['id']]);
        $mapped = $this->mapLead($lead); $mapped['suggestions'] = array_map(fn(array $row): array => ['id' => $row['id'], 'leadId' => $row['lead_id'], 'suggestionType' => $row['suggestion_type'], 'text' => $row['text'], 'reason' => $row['reason'] ?? '', 'confidence' => (float) $row['confidence'], 'status' => $row['status'], 'createdAt' => $this->toIso($row['created_at'] ?? null)], $suggestions);
        return $mapped;
    }

    private function mapLead(array $row): array
    {
        $profile = $this->jsonDecodeAssoc($row['profile_json'] ?? []);
        $name = trim((string) ($row['messenger_name'] ?? $row['whatsapp_name'] ?? $row['whatsapp_profile'] ?? '')) ?: (string) ($profile['identity']['name']['value'] ?? 'Unknown lead');
        $phone = (string) ($row['whatsapp_phone'] ?? ($profile['identity']['phone']['value'] ?? ''));
        return ['id' => (string) $row['id'], 'name' => $name, 'phone' => $phone, 'lastMessagePreview' => (string) ($row['messenger_preview'] ?? $row['whatsapp_preview'] ?? ''), 'sourceChannel' => (string) $row['source_channel'], 'messengerContactId' => $row['messenger_contact_id'] ?? null, 'whatsappContactId' => $row['whatsapp_contact_id'] ?? null, 'assignedModelId' => $row['assigned_model_id'] ?? null, 'status' => (string) $row['status'], 'stage' => (string) $row['stage'], 'score' => (float) $row['score'], 'orderProbability' => (float) $row['order_probability'], 'profile' => $profile, 'lastAnalyzedMessageId' => $row['last_analyzed_message_id'] ?? null, 'lastMessageAt' => $this->toIso($row['last_message_at'] ?? null), 'createdAt' => $this->toIso($row['created_at'] ?? null), 'updatedAt' => $this->toIso($row['updated_at'] ?? null)];
    }

    private function saveEvent(string $leadId, string $type, array $payload): void { $this->database->execute('INSERT INTO lead_events (lead_id, event_type, payload_json, created_at) VALUES (:lead, :type, :payload, :created)', [':lead' => $leadId, ':type' => $type, ':payload' => $this->jsonEncode($payload), ':created' => $this->database->nowUtc()]); }

    private function ensureTables(): void
    {
        if (!$this->tableExists('lead_profiles')) throw new RuntimeException('Lead intelligence tables are not installed. Run the latest database migration first.');
        if (!$this->tableExists('lead_suggestions') || !$this->tableExists('lead_events') || !$this->tableExists('lead_analysis_runs')) throw new RuntimeException('Lead intelligence tables are incomplete. Run the latest database migration first.');
    }

    private function syncChannelLeads(): void
    {
        if ($this->tableExists('messenger_contacts')) {
            foreach ($this->database->fetchAll('SELECT id FROM messenger_contacts') as $row) $this->resolveLead(['channel' => 'messenger', 'contactId' => (string) $row['id']]);
        }
        if ($this->tableExists('whatsapp_contacts')) {
            foreach ($this->database->fetchAll('SELECT id FROM whatsapp_contacts') as $row) $this->resolveLead(['channel' => 'whatsapp', 'contactId' => (string) $row['id']]);
        }
    }
}
