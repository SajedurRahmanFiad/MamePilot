<?php

declare(strict_types=1);

namespace App;

final class BusinessGrowthApi extends BaseService
{
    protected Config $config;

    public function __construct(Database $database, Auth $auth, Config $config)
    {
        $this->database = $database;
        $this->auth = $auth;
        $this->config = $config;
    }

    private function requireDeveloperUser(): array
    {
        $user = $this->currentUser();
        if (trim((string) ($user['role'] ?? '')) !== 'Developer') {
            throw new ApiException('Developer access required.', 403, 'DEVELOPER_ACCESS_REQUIRED');
        }
        return $user;
    }

    /**
     * Fetch business recommendations. Returns cached results if fresh, otherwise regenerates.
     */
    public function fetchBusinessRecommendations(array $params = []): array
    {
        $this->requireDeveloperUser();

        if (!$this->tableExists('business_recommendations')) {
            return ['recommendations' => [], 'generatedAt' => null, 'expiresAt' => null];
        }

        $settings = $this->loadGrowthSettings();
        $cacheHours = max(1, (int) ($settings['recommendation_cache_hours'] ?? 6));

        // Check for fresh cached recommendations
        $cutoff = date('Y-m-d H:i:s', time() - ($cacheHours * 3600));
        $existing = $this->database->fetchAll(
            'SELECT * FROM business_recommendations WHERE generated_at > :cutoff ORDER BY priority ASC, generated_at DESC',
            [':cutoff' => $cutoff]
        );

        if (!empty($existing)) {
            return [
                'recommendations' => array_map([$this, 'mapRecommendation'], $existing),
                'generatedAt' => (string) ($existing[0]['generated_at'] ?? ''),
                'expiresAt' => date('Y-m-d H:i:s', time() + ($cacheHours * 3600)),
                'cached' => true,
            ];
        }

        // No fresh cache — generate new recommendations
        return $this->generateRecommendations($settings);
    }

    /**
     * Force-refresh recommendations (ignores cache).
     */
    public function refreshBusinessRecommendations(array $params = []): array
    {
        $this->requireDeveloperUser();

        if (!$this->tableExists('business_recommendations')) {
            return ['recommendations' => [], 'generatedAt' => null, 'expiresAt' => null];
        }

        $settings = $this->loadGrowthSettings();
        return $this->generateRecommendations($settings);
    }

    /**
     * Load business growth settings from DB.
     */
    private function loadGrowthSettings(): array
    {
        if (!$this->tableExists('business_growth_settings')) {
            return [];
        }
        return $this->database->fetchOne('SELECT * FROM business_growth_settings LIMIT 1') ?? [];
    }

    /**
     * Core recommendation generation logic.
     * Runs aggregate SQL queries (small data), sends summaries to LLM, stores results.
     */
    private function generateRecommendations(array $settings): array
    {
        // Step 1: Run aggregate analysis queries (small, bounded results)
        $summaries = $this->buildDataSummaries();

        // Step 2: Call LLM with compact summaries
        try {
            $rawContent = (new LlmClient($this->database, $this->config))->generateForFeature(
                'business_growth',
                $this->buildSystemPrompt(),
                "Based on the following real business data, generate 3-4 actionable product recommendations.\n\n" . $summaries,
                [],
                ['temperature' => 0.3, 'maxTokens' => 4096]
            );
            $llmResponse = ['content' => $rawContent];
        } catch (\Throwable $exception) {
            return [
                'recommendations' => [],
                'generatedAt' => null,
                'expiresAt' => null,
                'error' => $exception->getMessage(),
            ];
        }

        // Step 3: Parse LLM response into structured recommendations
        $recommendations = $this->parseRecommendations($rawContent);

        // If parsing produced nothing, surface the raw response for debugging
        if (empty($recommendations) && $rawContent !== '') {
            // Try to give useful debug info
            $jsonTest = trim($rawContent);
            $jsonTest = preg_replace('/^```(?:json)?\s*\n?/i', '', $jsonTest);
            $jsonTest = preg_replace('/\n?```\s*$/', '', $jsonTest);
            $jsonTest = trim($jsonTest);
            if (!str_starts_with($jsonTest, '[')) {
                $s = strpos($jsonTest, '[');
                $e = strrpos($jsonTest, ']');
                if ($s !== false && $e !== false && $e > $s) $jsonTest = substr($jsonTest, $s, $e - $s + 1);
            }
            json_decode($jsonTest, true);
            $jsonErr = json_last_error_msg();

            return [
                'recommendations' => [],
                'generatedAt' => date('Y-m-d H:i:s'),
                'expiresAt' => null,
                'error' => "Parse failed (JSON: {$jsonErr}). Length: " . strlen($rawContent) . ". FinishReason: " . ($llmResponse['finishReason'] ?? 'n/a') . ". Text: " . substr($rawContent, 0, 300),
            ];
        }

        // Step 4: Enrich recommendations with product details
        $allProductIds = [];
        foreach ($recommendations as $rec) {
            foreach (($rec['productIds'] ?? []) as $pid) {
                if ($pid !== '') $allProductIds[$pid] = true;
            }
        }
        $productDetails = $this->fetchProductDetails(array_keys($allProductIds));

        // Step 5: Clear old cache and store new recommendations
        $this->database->execute('DELETE FROM business_recommendations');
        $now = date('Y-m-d H:i:s');
        $cacheHours = max(1, (int) ($settings['recommendation_cache_hours'] ?? 6));
        $expiresAt = date('Y-m-d H:i:s', time() + ($cacheHours * 3600));

        foreach ($recommendations as $i => $rec) {
            $id = 'rec-' . bin2hex(random_bytes(8));
            $recProductIds = array_values(array_filter(array_map('strval', $rec['productIds'] ?? [])));
            $recProducts = [];
            foreach ($recProductIds as $pid) {
                if (isset($productDetails[$pid])) {
                    $recProducts[] = $productDetails[$pid];
                }
            }
            $metadata = $rec['metadata'] ?? [];
            if (!is_array($metadata)) $metadata = [];
            $metadata['products'] = $recProducts;

            $this->database->execute(
                'INSERT INTO business_recommendations (id, recommendation_type, title, description, badge_color, priority, product_ids_json, metadata_json, generated_at, expires_at) VALUES (:id, :type, :title, :desc, :color, :priority, :pids, :meta, :gen, :exp)',
                [
                    ':id' => $id,
                    ':type' => $rec['type'] ?? 'general',
                    ':title' => $rec['title'] ?? '',
                    ':desc' => $rec['description'] ?? '',
                    ':color' => $rec['badgeColor'] ?? 'green',
                    ':priority' => $i + 1,
                    ':pids' => json_encode($recProductIds),
                    ':meta' => json_encode($metadata),
                    ':gen' => $now,
                    ':exp' => $expiresAt,
                ]
            );
        }

        // Return the freshly generated recommendations
        $rows = $this->database->fetchAll(
            'SELECT * FROM business_recommendations ORDER BY priority ASC',
            []
        );

        return [
            'recommendations' => array_map([$this, 'mapRecommendation'], $rows),
            'generatedAt' => $now,
            'expiresAt' => $expiresAt,
            'cached' => false,
        ];
    }

    /**
     * Build compact data summaries from the database.
     * Returns a structured string with aggregated metrics — NOT raw data.
     */
    private function buildDataSummaries(): string
    {
        $parts = [];

        // Build product sales data from orders (items stored as JSON)
        $salesData = $this->buildProductSalesData();

        // Fetch all active products
        $products = $this->database->fetchAll(
            "SELECT id, name, stock, sale_price AS salePrice FROM products WHERE deleted_at IS NULL ORDER BY name"
        );

        // 1. Low stock + high demand products
        $lowStockHighDemand = [];
        foreach ($products as $p) {
            $pid = $p['id'];
            $recentQty = $salesData[$pid]['recent30'] ?? 0;
            $priorQty = $salesData[$pid]['prior30'] ?? 0;
            if ((int) $p['stock'] <= 10 && $recentQty > 0) {
                $lowStockHighDemand[] = array_merge($p, ['recentQty' => $recentQty, 'priorQty' => $priorQty]);
            }
        }
        usort($lowStockHighDemand, fn($a, $b) => $b['recentQty'] <=> $a['recentQty']);
        $lowStockHighDemand = array_slice($lowStockHighDemand, 0, 15);

        if (!empty($lowStockHighDemand)) {
            $parts[] = "LOW STOCK + ACTIVE DEMAND:\n" . $this->formatProductTable($lowStockHighDemand);
        }

        // 2. Overstocked + no/low sales
        $overstockedLowSales = [];
        foreach ($products as $p) {
            $pid = $p['id'];
            $recentQty = $salesData[$pid]['recent60'] ?? 0;
            if ((int) $p['stock'] > 30 && $recentQty < 3) {
                $overstockedLowSales[] = array_merge($p, ['recentQty' => $recentQty]);
            }
        }
        usort($overstockedLowSales, fn($a, $b) => (int) $b['stock'] <=> (int) $a['stock']);
        $overstockedLowSales = array_slice($overstockedLowSales, 0, 15);

        if (!empty($overstockedLowSales)) {
            $parts[] = "OVERSTOCKED + LOW SALES (last 60 days):\n" . $this->formatProductTable($overstockedLowSales);
        }

        // 3. Trending products (recent 7 days vs prior 7 days)
        // Sort by absolute quantity growth (not %) to avoid bias from 0→1 jumps
        $trending = [];
        foreach ($products as $p) {
            $pid = $p['id'];
            $thisWeek = $salesData[$pid]['thisWeek'] ?? 0;
            $lastWeek = $salesData[$pid]['lastWeek'] ?? 0;
            // Require at least 2 orders this week to be considered "trending"
            if ($thisWeek >= 2 && $thisWeek > $lastWeek) {
                $absGrowth = $thisWeek - $lastWeek;
                $growthPct = $lastWeek > 0 ? round($absGrowth / $lastWeek * 100, 1) : 100;
                $trending[] = array_merge($p, ['thisWeekQty' => $thisWeek, 'lastWeekQty' => $lastWeek, 'growthPct' => $growthPct, 'absGrowth' => $absGrowth]);
            }
        }
        // Primary: absolute growth (bigger jumps rank higher), secondary: percentage
        usort($trending, fn($a, $b) => $b['absGrowth'] !== $a['absGrowth'] ? $b['absGrowth'] <=> $a['absGrowth'] : $b['growthPct'] <=> $a['growthPct']);
        $trending = array_slice($trending, 0, 10);

        if (!empty($trending)) {
            $parts[] = "TRENDING UP (this week vs last week):\n" . $this->formatProductTable($trending, true);
        }

        // 4. Declining products (had sales before, dropping now)
        $declining = [];
        foreach ($products as $p) {
            $pid = $p['id'];
            $thisWeek = $salesData[$pid]['thisWeek'] ?? 0;
            $lastWeek = $salesData[$pid]['lastWeek'] ?? 0;
            if ($lastWeek >= 3 && $thisWeek < $lastWeek * 0.5) {
                $growthPct = $lastWeek > 0 ? round(($thisWeek - $lastWeek) / $lastWeek * 100, 1) : 0;
                $declining[] = array_merge($p, ['thisWeekQty' => $thisWeek, 'lastWeekQty' => $lastWeek, 'growthPct' => $growthPct]);
            }
        }
        usort($declining, fn($a, $b) => $a['growthPct'] <=> $b['growthPct']);
        $declining = array_slice($declining, 0, 10);

        if (!empty($declining)) {
            $parts[] = "DECLINING SALES (this week vs last week):\n" . $this->formatProductTable($declining, true);
        }

        // 5. Overall inventory health summary
        $totalProducts = $this->database->fetchOne(
            "SELECT COUNT(*) AS cnt FROM products WHERE deleted_at IS NULL"
        );
        $totalStock = $this->database->fetchOne(
            "SELECT SUM(stock) AS total FROM products WHERE deleted_at IS NULL"
        );
        $zeroStock = $this->database->fetchOne(
            "SELECT COUNT(*) AS cnt FROM products WHERE deleted_at IS NULL AND stock = 0"
        );

        $parts[] = "INVENTORY OVERVIEW:\n" .
            "- Total active products: " . ((int) ($totalProducts['cnt'] ?? 0)) . "\n" .
            "- Total stock units: " . ((int) ($totalStock['total'] ?? 0)) . "\n" .
            "- Products with zero stock: " . ((int) ($zeroStock['cnt'] ?? 0));

        return implode("\n\n", $parts);
    }

    /**
     * Build aggregated product sales data by parsing JSON items from orders.
     * Returns: [productId => ['recent30' => qty, 'prior30' => qty, 'recent60' => qty, 'thisWeek' => qty, 'lastWeek' => qty]]
     */
    private function buildProductSalesData(): array
    {
        $now = time();
        $day7 = 7 * 86400;
        $day14 = 14 * 86400;
        $day30 = 30 * 86400;
        $day60 = 60 * 86400;

        // Fetch orders from the last 60 days with items
        $orders = $this->database->fetchAll(
            "SELECT items, created_at FROM orders WHERE deleted_at IS NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY)"
        );

        $data = [];

        foreach ($orders as $order) {
            $itemsJson = (string) ($order['items'] ?? '[]');
            $items = json_decode($itemsJson, true);
            if (!is_array($items)) continue;

            $createdAt = strtotime((string) ($order['created_at'] ?? ''));
            if ($createdAt === false) continue;

            $ageSeconds = $now - $createdAt;

            foreach ($items as $item) {
                $pid = (string) ($item['productId'] ?? '');
                $qty = (int) ($item['quantity'] ?? 0);
                if ($pid === '' || $qty <= 0) continue;

                if (!isset($data[$pid])) {
                    $data[$pid] = ['recent30' => 0, 'prior30' => 0, 'recent60' => 0, 'thisWeek' => 0, 'lastWeek' => 0];
                }

                $data[$pid]['recent60'] += $qty;

                if ($ageSeconds <= $day30) {
                    $data[$pid]['recent30'] += $qty;
                } elseif ($ageSeconds <= $day60) {
                    $data[$pid]['prior30'] += $qty;
                }

                if ($ageSeconds <= $day7) {
                    $data[$pid]['thisWeek'] += $qty;
                } elseif ($ageSeconds <= $day14) {
                    $data[$pid]['lastWeek'] += $qty;
                }
            }
        }

        return $data;
    }

    /**
     * Fetch product details (name, image, stock) for a list of product IDs.
     * Returns [productId => ['id' => ..., 'name' => ..., 'image' => ..., 'stock' => ...]]
     */
    private function fetchProductDetails(array $productIds): array
    {
        if (empty($productIds)) return [];

        $result = [];
        // Fetch in batches of 50 to avoid overly long IN clauses
        foreach (array_chunk($productIds, 50) as $batch) {
            $placeholders = implode(',', array_fill(0, count($batch), '?'));
            $rows = $this->database->fetchAll(
                "SELECT id, name, image, stock FROM products WHERE id IN ({$placeholders}) AND deleted_at IS NULL",
                $batch
            );
            foreach ($rows as $r) {
                $result[(string) $r['id']] = [
                    'id' => (string) $r['id'],
                    'name' => (string) $r['name'],
                    'image' => (string) ($r['image'] ?? ''),
                    'stock' => (int) $r['stock'],
                ];
            }
        }
        return $result;
    }

    /**
     * Format product rows into a compact text table for the LLM.
     */
    private function formatProductTable(array $rows, bool $includeGrowth = false): string
    {
        $lines = [];
        foreach ($rows as $r) {
            $recentQty = $r['recentQty'] ?? $r['thisWeekQty'] ?? 0;
            $line = "- \"{$r['name']}\" | ref_id={$r['id']} | stock={$r['stock']} | price={$r['salePrice']} | recent_qty={$recentQty}";
            if ($includeGrowth) {
                $line .= ", this_week={$r['thisWeekQty']}, last_week={$r['lastWeekQty']}, growth={$r['growthPct']}%";
            }
            $lines[] = $line;
        }
        return implode("\n", $lines);
    }

    /**
     * Call the configured LLM provider with the data summaries.
     */
    private function callLLM(string $provider, string $apiKey, string $model, string $baseUrl, string $dataSummary): array
    {
        $systemPrompt = $this->buildSystemPrompt();
        $userMessage = "Based on the following real business data, generate 3-4 actionable product recommendations.\n\n" . $dataSummary;

        return match ($provider) {
            'openai', 'openrouter', 'groq' => $this->callOpenAICompatible($provider, $apiKey, $model, $baseUrl, $systemPrompt, $userMessage),
            'anthropic' => $this->callAnthropic($apiKey, $model, $baseUrl, $systemPrompt, $userMessage),
            'google' => $this->callGemini($apiKey, $model, $baseUrl, $systemPrompt, $userMessage),
            default => ['error' => 'Unsupported provider: ' . $provider],
        };
    }

    /**
     * Build the system prompt for recommendation generation.
     */
    private function buildSystemPrompt(): string
    {
        return <<<'PROMPT'
You are a business analyst for an e-commerce/retail business. Analyze the provided product data and generate actionable recommendations.

All prices and monetary values are in BDT (Bangladeshi Taka). Use "BDT" or "৳" when mentioning prices. Do NOT use "$" or "USD".

Output MUST be a valid JSON array. Each recommendation object must have:
- "type": one of "restock", "run_ads", "discontinue", "trending_opportunity", "price_adjustment", "clearance"
- "title": short catchy title (max 60 chars)
- "description": 2-3 sentence explanation with specific numbers from the data
- "badgeColor": "green" for positive opportunities (restock trending items, capitalize on growth), "yellow" for moderate actions (run ads, price adjustments), "red" for urgent/negative actions (low stock risks, dead stock, discontinue)
- "productIds": array of relevant product IDs from the data
- "metadata": object with optional extra info like "action", "urgency", "estimatedImpact"

Rules:
- Generate exactly 3-4 recommendations — only genuinely important ones
- Use real numbers from the data in your descriptions
- Be specific and actionable
- Prioritize by business impact
- NEVER include product IDs in the "title" or "description" text — use only the product name. The productIds field is separate and used for linking, not for display.
- Output ONLY the JSON array, no other text
PROMPT;
    }

    /**
     * Call an OpenAI-compatible API (OpenAI, OpenRouter, Groq).
     */
    private function callOpenAICompatible(string $provider, string $apiKey, string $model, string $configuredBaseUrl, string $systemPrompt, string $userMessage): array
    {
        $defaultBase = match ($provider) {
            'openrouter' => 'https://openrouter.ai/api/v1',
            'groq' => 'https://api.groq.com/openai/v1',
            default => 'https://api.openai.com/v1',
        };
        $baseUrl = $configuredBaseUrl !== '' ? rtrim($configuredBaseUrl, '/') : $defaultBase;

        $endpoint = $baseUrl . '/chat/completions';

        $headers = [
            'Content-Type' => 'application/json',
            'Authorization' => 'Bearer ' . $apiKey,
        ];

        if ($provider === 'openrouter') {
            $headers['HTTP-Referer'] = 'https://mamepilot.com';
            $headers['X-Title'] = 'MamePilot Business Growth';
        }

        $body = [
            'model' => $model,
            'messages' => [
                ['role' => 'system', 'content' => $systemPrompt],
                ['role' => 'user', 'content' => $userMessage],
            ],
            'temperature' => 0.3,
            'max_tokens' => 4096,
        ];

        try {
            $response = $this->httpJson('POST', $endpoint, $headers, $body);
        } catch (\Throwable $ex) {
            return ['error' => 'LLM request failed: ' . $ex->getMessage()];
        }

        $status = (int) ($response['status'] ?? 0);
        if ($status !== 200) {
            $errMsg = $response['json']['error']['message'] ?? $response['body'] ?? 'Unknown error';
            return ['error' => "LLM HTTP {$status}: {$errMsg}"];
        }

        $content = $response['json']['choices'][0]['message']['content'] ?? '';
        $finishReason = $response['json']['choices'][0]['finish_reason'] ?? 'unknown';
        if ($content === '') {
            return ['error' => 'Empty response from LLM. finish_reason=' . $finishReason];
        }

        return ['content' => $content, 'finishReason' => $finishReason];
    }

    /**
     * Call Anthropic API.
     */
    private function callAnthropic(string $apiKey, string $model, string $configuredBaseUrl, string $systemPrompt, string $userMessage): array
    {
        $base = $configuredBaseUrl !== '' ? rtrim($configuredBaseUrl, '/') : 'https://api.anthropic.com';
        $endpoint = $base . '/v1/messages';

        $headers = [
            'Content-Type' => 'application/json',
            'x-api-key' => $apiKey,
            'anthropic-version' => '2023-06-01',
        ];

        $body = [
            'model' => $model,
            'max_tokens' => 2048,
            'system' => $systemPrompt,
            'messages' => [
                ['role' => 'user', 'content' => $userMessage],
            ],
            'temperature' => 0.3,
        ];

        try {
            $response = $this->httpJson('POST', $endpoint, $headers, $body);
        } catch (\Throwable $ex) {
            return ['error' => 'LLM request failed: ' . $ex->getMessage()];
        }

        $status = (int) ($response['status'] ?? 0);
        if ($status !== 200) {
            $errMsg = $response['json']['error']['message'] ?? $response['body'] ?? 'Unknown error';
            return ['error' => "LLM HTTP {$status}: {$errMsg}"];
        }

        $content = $response['json']['content'][0]['text'] ?? '';
        if ($content === '') {
            return ['error' => 'Empty response from LLM.'];
        }

        return ['content' => $content];
    }

    /**
     * Call Google Gemini API.
     */
    private function callGemini(string $apiKey, string $model, string $configuredBaseUrl, string $systemPrompt, string $userMessage): array
    {
        if ($model === '') {
            $model = 'gemini-2.0-flash';
        }

        $base = $configuredBaseUrl !== '' ? rtrim($configuredBaseUrl, '/') : 'https://generativelanguage.googleapis.com';
        $endpoint = $base . '/v1beta/models/' . rawurlencode($model) . ':generateContent';

        $headers = [
            'Content-Type' => 'application/json',
            'x-goog-api-key' => $apiKey,
        ];

        $body = [
            'systemInstruction' => [
                'parts' => [['text' => $systemPrompt]],
            ],
            'contents' => [
                ['role' => 'user', 'parts' => [['text' => $userMessage]]],
            ],
            'generationConfig' => [
                'temperature' => 0.3,
                'maxOutputTokens' => 4096,
            ],
        ];

        try {
            $response = $this->httpJson('POST', $endpoint, $headers, $body);
        } catch (\Throwable $ex) {
            return ['error' => 'LLM request failed: ' . $ex->getMessage()];
        }

        $status = (int) ($response['status'] ?? 0);
        if ($status !== 200) {
            $errMsg = $response['json']['error']['message'] ?? $response['body'] ?? 'Unknown error';
            return ['error' => "LLM HTTP {$status}: {$errMsg}"];
        }

        $content = $response['json']['candidates'][0]['content']['parts'][0]['text'] ?? '';
        if ($content === '') {
            return ['error' => 'Empty response from LLM.'];
        }

        return ['content' => $content];
    }

    /**
     * Parse LLM response into structured recommendations.
     */
    private function parseRecommendations(string $content): array
    {
        $jsonStr = trim($content);

        // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
        $jsonStr = preg_replace('/^```(?:json)?\s*\n?/i', '', $jsonStr);
        $jsonStr = preg_replace('/\n?```\s*$/', '', $jsonStr);
        $jsonStr = trim($jsonStr);

        // If it doesn't start with [, try to find the JSON array in the text
        if (!str_starts_with($jsonStr, '[')) {
            $start = strpos($jsonStr, '[');
            $end = strrpos($jsonStr, ']');
            if ($start !== false && $end !== false && $end > $start) {
                $jsonStr = substr($jsonStr, $start, $end - $start + 1);
            }
        }

        $decoded = json_decode($jsonStr, true);

        // If JSON decode failed, try cleaning control characters inside strings and retry
        if (!is_array($decoded)) {
            $decoded = json_decode($this->escapeJsonControlChars($jsonStr), true);
        }

        if (!is_array($decoded)) {
            error_log('BusinessGrowthApi: JSON parse failed - ' . json_last_error_msg() . ' input=' . substr($jsonStr, 0, 500));
            return [];
        }
        if (!is_array($decoded)) {
            // Debug: log why JSON parsing failed
            error_log('BusinessGrowthApi: JSON parse failed - json_last_error=' . json_last_error() . ' msg=' . json_last_error_msg() . ' input_start=' . substr($jsonStr, 0, 200));
            return [];
        }

        $valid = [];
        $validTypes = ['restock', 'run_ads', 'discontinue', 'trending_opportunity', 'price_adjustment', 'clearance'];
        $validColors = ['green', 'yellow', 'red'];

        foreach ($decoded as $item) {
            if (!is_array($item)) continue;

            $type = trim((string) ($item['type'] ?? 'general'));
            if (!in_array($type, $validTypes, true)) {
                $type = 'general';
            }

            $badgeColor = trim((string) ($item['badgeColor'] ?? 'green'));
            if (!in_array($badgeColor, $validColors, true)) {
                $badgeColor = 'green';
            }

            $valid[] = [
                'type' => $type,
                'title' => trim((string) ($item['title'] ?? '')),
                'description' => trim((string) ($item['description'] ?? '')),
                'badgeColor' => $badgeColor,
                'productIds' => array_filter(array_map('strval', $item['productIds'] ?? [])),
                'metadata' => is_array($item['metadata'] ?? null) ? $item['metadata'] : null,
            ];
        }

        return $valid;
    }

    /**
     * Escape control characters inside JSON string values.
     * Walks the JSON character by character, tracking string context,
     * and replaces literal control chars (U+0000..U+001F) with their JSON escape sequences.
     */
    private function escapeJsonControlChars(string $json): string
    {
        $len = strlen($json);
        $result = '';
        $inString = false;
        $i = 0;

        while ($i < $len) {
            $ch = $json[$i];

            if ($inString) {
                if ($ch === '\\') {
                    // Escaped character — pass through both the backslash and the next char
                    $result .= $ch;
                    $i++;
                    if ($i < $len) {
                        $result .= $json[$i];
                    }
                } elseif ($ch === '"') {
                    // End of string
                    $inString = false;
                    $result .= $ch;
                } elseif (ord($ch) <= 0x1F) {
                    // Control character inside a string — escape it
                    $result .= '\\u' . sprintf('%04x', ord($ch));
                } else {
                    $result .= $ch;
                }
            } else {
                if ($ch === '"') {
                    $inString = true;
                }
                $result .= $ch;
            }
            $i++;
        }

        return $result;
    }

    /**
     * Map a DB row to a recommendation object.
     */
    private function mapRecommendation(array $row): array
    {
        $productIds = json_decode((string) ($row['product_ids_json'] ?? '[]'), true);
        $metadata = json_decode((string) ($row['metadata_json'] ?? 'null'), true);

        return [
            'id' => (string) ($row['id'] ?? ''),
            'type' => (string) ($row['recommendation_type'] ?? ''),
            'title' => (string) ($row['title'] ?? ''),
            'description' => (string) ($row['description'] ?? ''),
            'badgeColor' => (string) ($row['badge_color'] ?? 'green'),
            'priority' => (int) ($row['priority'] ?? 0),
            'productIds' => is_array($productIds) ? $productIds : [],
            'metadata' => is_array($metadata) ? $metadata : null,
            'generatedAt' => (string) ($row['generated_at'] ?? ''),
            'expiresAt' => (string) ($row['expires_at'] ?? ''),
        ];
    }

    /**
     * Make an HTTP JSON request.
     */
    private function httpJson(string $method, string $url, array $headers, ?array $jsonBody = null): array
    {
        $body = $jsonBody !== null ? json_encode($jsonBody, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;

        if (!function_exists('curl_init')) {
            throw new \RuntimeException('curl extension is required for LLM API calls.');
        }

        $handle = curl_init($url);
        if ($handle === false) {
            throw new \RuntimeException('Failed to initialize HTTP request.');
        }

        $headerList = [];
        foreach ($headers as $name => $value) {
            $headerList[] = $name . ': ' . $value;
        }

        curl_setopt_array($handle, [
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headerList,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);

        if ($body !== null) {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
        }

        $responseBody = curl_exec($handle);
        $httpCode = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $error = curl_error($handle);
        curl_close($handle);

        if ($responseBody === false) {
            throw new \RuntimeException('HTTP request failed: ' . $error);
        }

        $json = json_decode($responseBody, true);

        return [
            'status' => $httpCode,
            'body' => $responseBody,
            'json' => is_array($json) ? $json : null,
        ];
    }
}
