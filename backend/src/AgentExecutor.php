<?php

declare(strict_types=1);

namespace App;

final class AgentExecutor extends BaseService
{
    public function startRun(array $params): array
    {
        $user = $this->currentUser();
        $message = trim((string) ($params['message'] ?? ''));
        if ($message === '') {
            throw new ApiException('Message cannot be empty.', 400);
        }

        $settings = $this->loadAgentSettings();
        $conversationId = $this->ensureConversation((string) ($user['id'] ?? $this->uuid4()), (string) ($params['conversationId'] ?? ''));
        $runId = $this->uuid4();
        $streamToken = $this->uuid4();
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO agent_runs (
                id, conversation_id, user_id, status, main_provider, main_model,
                deterministic_provider, deterministic_model, current_step, max_steps,
                stream_token, started_at, created_at, updated_at
            ) VALUES (
                :id, :conversation_id, :user_id, :status, :main_provider, :main_model,
                :deterministic_provider, :deterministic_model, :current_step, :max_steps,
                :stream_token, :started_at, :created_at, :updated_at
            )',
            [
                ':id' => $runId,
                ':conversation_id' => $conversationId,
                ':user_id' => (string) ($user['id'] ?? ''),
                ':status' => 'queued',
                ':main_provider' => $settings['mainProvider'] ?? 'anthropic',
                ':main_model' => $settings['mainModel'] ?? null,
                ':deterministic_provider' => 'groq',
                ':deterministic_model' => $settings['groq']['model'] ?? null,
                ':current_step' => 0,
                ':max_steps' => 4,
                ':stream_token' => $streamToken,
                ':started_at' => $now,
                ':created_at' => $now,
                ':updated_at' => $now,
            ]
        );

        $this->persistMessage($conversationId, $runId, 'user', $message);
        $this->appendEvent($runId, 'started', [
            'message' => $message,
            'provider' => $settings['mainProvider'] ?? 'anthropic',
            'enabled' => !empty($settings['enabled'] ?? false),
        ], 1);

        if (empty($settings['enabled'] ?? false)) {
            $answer = 'Mame AI is currently disabled in agent settings.';
            $this->appendEvent($runId, 'completed', ['answer' => $answer], 2);
            $this->markRunCompleted($runId, $answer, $now);
            return $this->buildRunSnapshot($runId, $conversationId, $streamToken, 'completed', $answer, [
                ['type' => 'completed', 'payload' => ['answer' => $answer]],
            ]);
        }

        $this->appendEvent($runId, 'queued', ['summary' => 'Your request has been queued for processing.'], 2);

        return $this->buildRunSnapshot($runId, $conversationId, $streamToken, 'queued', '', [
            ['type' => 'started', 'payload' => ['message' => $message]],
            ['type' => 'queued', 'payload' => ['summary' => 'Your request has been queued for processing.']],
        ]);
    }

    public function fetchRunStream(array $params): array
    {
        $this->currentUser();
        $runId = trim((string) ($params['runId'] ?? ''));
        if ($runId === '') {
            throw new ApiException('Run id is required.', 400);
        }

        $run = $this->database->fetchOne(
            'SELECT r.*, c.id AS conversation_id FROM agent_runs r INNER JOIN agent_conversations c ON c.id = r.conversation_id WHERE r.id = :id LIMIT 1',
            [':id' => $runId]
        );
        if ($run === null) {
            throw new ApiException('Run was not found.', 404);
        }

        $events = $this->database->fetchAll(
            'SELECT event_type, payload_json, sequence_no, created_at FROM agent_run_events WHERE run_id = :run_id ORDER BY sequence_no ASC, created_at ASC',
            [':run_id' => $runId]
        );

        $messages = $this->database->fetchAll(
            'SELECT role, content, created_at FROM agent_messages WHERE conversation_id = :conversation_id ORDER BY created_at ASC',
            [':conversation_id' => (string) ($run['conversation_id'] ?? '')]
        );

        $answer = '';
        foreach ($events as $event) {
            $payload = $this->decodePayload((string) ($event['payload_json'] ?? '{}'));
            if (($event['event_type'] ?? '') === 'completed' && isset($payload['answer'])) {
                $answer = (string) $payload['answer'];
            }
        }

        return [
            'runId' => $runId,
            'conversationId' => (string) ($run['conversation_id'] ?? ''),
            'status' => (string) ($run['status'] ?? 'running'),
            'answer' => $answer,
            'events' => array_map(function (array $event): array {
                return [
                    'type' => (string) ($event['event_type'] ?? ''),
                    'sequence' => (int) ($event['sequence_no'] ?? 0),
                    'payload' => $this->decodePayload((string) ($event['payload_json'] ?? '{}')),
                    'createdAt' => (string) ($event['created_at'] ?? ''),
                ];
            }, $events),
            'messages' => $messages,
        ];
    }

    public function processQueuedRun(array $params): array
    {
        if (function_exists('set_time_limit')) {
            @set_time_limit(300);
        }
        $runId = trim((string) ($params['runId'] ?? ''));
        if ($runId === '') {
            throw new ApiException('Run id is required.', 400);
        }

        $run = $this->database->fetchOne('SELECT * FROM agent_runs WHERE id = :id LIMIT 1', [':id' => $runId]);
        if ($run === null) {
            throw new ApiException('Run was not found.', 404);
        }

        $status = (string) ($run['status'] ?? 'queued');
        if (in_array($status, ['completed', 'failed'], true)) {
            return $this->buildRunSnapshot((string) ($run['id'] ?? ''), (string) ($run['conversation_id'] ?? ''), (string) ($run['stream_token'] ?? ''), $status, '', []);
        }

        $this->database->execute(
            'UPDATE agent_runs SET status = :status, current_step = :current_step, updated_at = :updated_at WHERE id = :id',
            [
                ':status' => 'running',
                ':current_step' => 1,
                ':updated_at' => $this->database->nowUtc(),
                ':id' => $runId,
            ]
        );

        $conversationId = (string) ($run['conversation_id'] ?? '');
        $now = $this->database->nowUtc();

        try {
            $settings = $this->loadAgentSettings();
            $message = $this->fetchLatestUserMessage($runId);

            if (empty($settings['enabled'] ?? false)) {
                $answer = 'Mame AI is currently disabled in agent settings.';
                $this->appendEvent($runId, 'completed', ['answer' => $answer], $this->nextSequenceNumber($runId));
                $this->markRunCompleted($runId, $answer, $now);
                return $this->buildRunSnapshot($runId, $conversationId, (string) ($run['stream_token'] ?? ''), 'completed', $answer, []);
            }

            $schema = $this->buildSchemaDescription();
            $rowLimit = (int) ($settings['query_row_limit'] ?? 100);

            $this->appendEvent($runId, 'reasoning_plan', [
                'mode' => 'pipeline',
                'steps' => [
                    ['id' => 'plan', 'name' => 'Planning the query', 'kind' => 'planning'],
                    ['id' => 'query', 'name' => 'Querying the database', 'kind' => 'tool'],
                    ['id' => 'synthesize', 'name' => 'Synthesizing the answer', 'kind' => 'synthesis'],
                ],
                'followUpSuggestions' => [
                    'Ask about a specific customer or product',
                    'Request a trend comparison over time',
                    'Ask for a detailed breakdown',
                ],
            ], $this->nextSequenceNumber($runId));

            // ====== STEP 1: Ask LLM to generate SQL (or say no query needed) ======
            $this->appendEvent($runId, 'step_started', [
                'stepId' => 'plan',
                'name' => 'Planning the query',
            ], $this->nextSequenceNumber($runId));

            $this->appendEvent($runId, 'thought', [
                'summary' => 'Analyzing your question.',
            ], $this->nextSequenceNumber($runId));

            $sqlPrompt = $this->buildSqlGenerationPrompt($schema, $rowLimit, date('Y-m-d'));
            $history = $this->loadConversationHistory($conversationId, $runId);

            $step1 = $this->callGeminiText($sqlPrompt, $history, $message, $settings);
            if (!empty($step1['error'])) {
                throw new \RuntimeException($step1['error']);
            }
            $step1Text = trim($step1['text'] ?? '');

            $this->appendEvent($runId, 'step_completed', [
                'stepId' => 'plan',
                'name' => 'Planning the query',
            ], $this->nextSequenceNumber($runId));

            // ====== Check if query is needed ======
            $sql = $this->extractSqlFromResponse($step1Text);
            $hasNoQueryMarker = stripos($step1Text, 'NO_QUERY_NEEDED') !== false;

            if ($hasNoQueryMarker || ($sql === '' && !$hasNoQueryMarker && stripos($step1Text, 'SELECT') === false)) {
                // No database query needed — greeting, general knowledge, etc.
                // Strip any SQL artifacts and use the text directly
                $finalAnswer = preg_replace('/^```(?:sql)?\s*/m', '', $step1Text);
                $finalAnswer = preg_replace('/```\s*$/', '', $finalAnswer);
                $finalAnswer = trim(preg_replace('/^--.*$/m', '', $finalAnswer));
                if ($finalAnswer === '' || stripos($finalAnswer, 'NO_QUERY_NEEDED') !== false) {
                    $finalAnswer = 'Hello! I\'m Mame, your business assistant. How can I help you today? You can ask me about your orders, customers, products, sales, expenses, and more.';
                }
            } else {
                // SQL was generated — execute it and synthesize
                if ($sql === '') {
                    // LLM returned something with SELECT but we couldn't extract clean SQL
                    // Try one more time with a more direct prompt
                    $retryPrompt = 'Output ONLY a SQL SELECT query. No explanation. No markdown. Just raw SQL.\n\n' . $sqlPrompt;

                    $retry = $this->callGeminiText($retryPrompt, $history, $message, $settings);
                    if (empty($retry['error'])) {
                        $sql = $this->extractSqlFromResponse(trim($retry['text'] ?? ''));
                    }
                }

                if ($sql === '') {
                    // Still couldn't get SQL — ask LLM to answer directly without data
                    $fallbackPrompt = 'The user asked: ' . $message . "\n\n"
                        . 'I could not generate a valid SQL query for this question. '
                        . 'Answer the user directly based on general business knowledge, and suggest they rephrase if needed. Be brief and helpful.';
                    $fallback = $this->callGeminiText($fallbackPrompt, $history, '', $settings);
                    $finalAnswer = $fallback['text'] ?? 'I had trouble understanding your question. Could you rephrase it?';
                } else {
                // ====== STEP 2a: Execute the SQL ======
                $this->appendEvent($runId, 'step_started', [
                    'stepId' => 'query',
                    'name' => 'Querying the database',
                ], $this->nextSequenceNumber($runId));

                $this->appendEvent($runId, 'thought', [
                    'summary' => 'Running: ' . mb_substr($sql, 0, 120),
                ], $this->nextSequenceNumber($runId));

                $toolId = $this->uuid4();
                $queryResult = $this->executeAgentQuery($runId, $toolId, $sql, $rowLimit);

                $summary = $queryResult['error']
                    ? 'Query error: ' . $queryResult['error']
                    : 'Found ' . $queryResult['rowCount'] . ' row(s).';

                $this->appendEvent($runId, 'tool_result', [
                    'summary' => $summary,
                    'toolName' => 'execute_sql_query',
                    'details' => [
                        'sql' => $sql,
                        'rowCount' => $queryResult['rowCount'],
                        'columns' => $queryResult['columns'],
                        'rows' => array_slice($queryResult['rows'], 0, 20),
                        'error' => $queryResult['error'],
                    ],
                ], $this->nextSequenceNumber($runId));

                $this->appendEvent($runId, 'step_completed', [
                    'stepId' => 'query',
                    'name' => 'Querying the database',
                ], $this->nextSequenceNumber($runId));

                if ($queryResult['error']) {
                    // Query had an error — ask LLM to explain gracefully
                    $this->appendEvent($runId, 'step_started', [
                        'stepId' => 'synthesize',
                        'name' => 'Synthesizing the answer',
                    ], $this->nextSequenceNumber($runId));

                    $errorPrompt = 'The user asked: ' . $message . "\n\n"
                        . 'The SQL query I tried failed with error: ' . $queryResult['error'] . "\n\n"
                        . 'Explain to the user what happened in plain language and suggest a different approach. Be brief.';
                    $errorResponse = $this->callGeminiText($errorPrompt, $history, '', $settings);
                    $finalAnswer = $errorResponse['text'] ?? 'The query encountered an error. Please try rephrasing your question.';

                    $this->appendEvent($runId, 'step_completed', [
                        'stepId' => 'synthesize',
                        'name' => 'Synthesizing the answer',
                    ], $this->nextSequenceNumber($runId));
                } else {
                    // ====== STEP 2b: Synthesize the answer from query results ======
                    $this->appendEvent($runId, 'step_started', [
                        'stepId' => 'synthesize',
                        'name' => 'Synthesizing the answer',
                    ], $this->nextSequenceNumber($runId));

                    $this->appendEvent($runId, 'synthesis', [
                        'summary' => 'Compiling findings into a clear answer.',
                    ], $this->nextSequenceNumber($runId));

                    $synthPrompt = $this->buildSynthesisPrompt($message, $sql, $queryResult, $rowLimit);
                    $step2 = $this->callGeminiText($synthPrompt, $history, '', $settings);

                    if (!empty($step2['error'])) {
                        // Fallback: format the raw data
                        $finalAnswer = $this->formatRawQueryResult($queryResult);
                    } else {
                        $finalAnswer = trim($step2['text'] ?? '');
                        if ($finalAnswer === '') {
                            $finalAnswer = $this->formatRawQueryResult($queryResult);
                        }
                    }

                    $this->appendEvent($runId, 'step_completed', [
                        'stepId' => 'synthesize',
                        'name' => 'Synthesizing the answer',
                    ], $this->nextSequenceNumber($runId));
                }
                } // end else (SQL was extracted)
            }

            $this->appendEvent($runId, 'follow_up_suggestions', [
                'suggestions' => [
                    'Ask about a specific customer or product',
                    'Request a trend comparison over time',
                    'Ask for a detailed breakdown',
                ],
            ], $this->nextSequenceNumber($runId));

            $this->appendEvent($runId, 'completed', ['answer' => $finalAnswer], $this->nextSequenceNumber($runId));
            $this->markRunCompleted($runId, $finalAnswer, $now);

            return $this->buildRunSnapshot($runId, $conversationId, (string) ($run['stream_token'] ?? ''), 'completed', $finalAnswer, []);
        } catch (\Throwable $ex) {
            $errorMsg = $ex->getMessage();
            $errorAnswer = 'I could not complete the analysis. ' . $this->humanizeError($errorMsg);
            $this->appendEvent($runId, 'failed', ['error' => $errorMsg, 'answer' => $errorAnswer], $this->nextSequenceNumber($runId));
            $this->appendEvent($runId, 'completed', ['answer' => $errorAnswer], $this->nextSequenceNumber($runId));
            $this->markRunFailed($runId, $errorAnswer, $now, $errorMsg);
            return $this->buildRunSnapshot($runId, $conversationId, (string) ($run['stream_token'] ?? ''), 'failed', $errorAnswer, []);
        }
    }

    private function loadAgentSettings(): array
    {
        $row = $this->tableExists('agent_settings')
            ? $this->database->fetchOne('SELECT * FROM agent_settings LIMIT 1')
            : null;

        if ($row === null) {
            return [
                'enabled' => false,
                'mainProvider' => 'anthropic',
                'mainModel' => null,
                'groq' => ['model' => null],
            ];
        }

        return [
            'enabled' => !empty($row['enabled'] ?? 0),
            'mainProvider' => (string) ($row['main_provider'] ?? 'anthropic'),
            'mainModel' => (string) ($row['google_model'] ?? $row['anthropic_model'] ?? $row['openai_model'] ?? $row['groq_model'] ?? ''),
            'groq' => ['model' => (string) ($row['groq_model'] ?? '')],
            'google_api_key' => (string) ($row['google_api_key'] ?? ''),
            'anthropic_api_key' => (string) ($row['anthropic_api_key'] ?? ''),
            'openai_api_key' => (string) ($row['openai_api_key'] ?? ''),
            'max_tool_calls' => (int) ($row['max_tool_calls'] ?? 4),
            'query_row_limit' => (int) ($row['query_row_limit'] ?? 100),
        ];
    }

    private function ensureConversation(string $userId, string $conversationId): string
    {
        $conversation = trim($conversationId);
        if ($conversation !== '') {
            $existing = $this->database->fetchOne('SELECT id FROM agent_conversations WHERE id = :id AND user_id = :user_id LIMIT 1', [':id' => $conversation, ':user_id' => $userId]);
            if ($existing !== null) {
                return $conversation;
            }
        }

        $id = $conversation !== '' ? $conversation : $this->uuid4();
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO agent_conversations (id, user_id, title, status, created_at, updated_at) VALUES (:id, :user_id, :title, :status, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':user_id' => $userId,
                ':title' => 'New conversation',
                ':status' => 'active',
                ':created_at' => $now,
                ':updated_at' => $now,
            ]
        );

        return $id;
    }

    private function persistMessage(string $conversationId, string $runId, string $role, string $content): void
    {
        $this->database->execute(
            'INSERT INTO agent_messages (id, conversation_id, run_id, role, content, created_at) VALUES (:id, :conversation_id, :run_id, :role, :content, :created_at)',
            [
                ':id' => $this->uuid4(),
                ':conversation_id' => $conversationId,
                ':run_id' => $runId,
                ':role' => $role,
                ':content' => $content,
                ':created_at' => $this->database->nowUtc(),
            ]
        );
    }

    private function appendEvent(string $runId, string $eventType, array $payload, int $sequence): void
    {
        $this->database->execute(
            'INSERT INTO agent_run_events (id, run_id, event_type, sequence_no, payload_json, created_at) VALUES (:id, :run_id, :event_type, :sequence_no, :payload_json, :created_at)',
            [
                ':id' => $this->uuid4(),
                ':run_id' => $runId,
                ':event_type' => $eventType,
                ':sequence_no' => $sequence,
                ':payload_json' => $this->encodePayload($payload),
                ':created_at' => $this->database->nowUtc(),
            ]
        );
    }

    private function nextSequenceNumber(string $runId): int
    {
        $row = $this->database->fetchOne(
            'SELECT COALESCE(MAX(sequence_no), 0) AS max_sequence FROM agent_run_events WHERE run_id = :run_id',
            [':run_id' => $runId]
        );
        return (int) ($row['max_sequence'] ?? 0) + 1;
    }

    private function dispatchBackgroundWorker(string $runId): void
    {
        $scriptPath = dirname(__DIR__) . '/bin/process_agent_queue.php';
        if (!is_file($scriptPath)) {
            return;
        }

        $phpBinary = getenv('PHP_BINARY');
        if ($phpBinary === false || trim((string) $phpBinary) === '') {
            $phpBinary = PHP_BINARY;
        }

        $command = escapeshellarg((string) $phpBinary) . ' ' . escapeshellarg($scriptPath) . ' --run-id ' . escapeshellarg($runId);
        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
            $command = 'start /B ' . $command . ' > NUL 2>&1';
        } else {
            $command .= ' > /dev/null 2>&1 &';
        }

        @exec($command);
    }

    /**
     * @return array{lane:string, provider:string, model:string|null}
     */
    private function buildExecutionPlan(array $settings, string $message): array
    {
        $messageLower = strtolower($message);
        $isFinanceRequest = preg_match('/\b(profit|loss|sales|purchase|purchases|expense|expenses|income|revenue|cost|declin|lower|higher|trend|why)\b/', $messageLower) === 1;
        $isDeterministic = $isFinanceRequest || preg_match('/\b(count|total|summary|latest|status|report|order|customer|product|bill|transaction|how many)\b/', $messageLower) === 1;
        $lane = $isDeterministic ? 'deterministic' : 'main';
        $provider = $lane === 'deterministic' ? ($settings['deterministic_provider'] ?? 'groq') : ($settings['mainProvider'] ?? 'anthropic');
        $model = $lane === 'deterministic'
            ? ($settings['groq']['model'] ?? ($settings['mainModel'] ?? null))
            : ($settings['mainModel'] ?? null);

        return [
            'lane' => $lane,
            'provider' => $provider,
            'model' => $model,
        ];
    }

    /**
     * @param array<string, mixed> $settings
     * @return array{finance: bool, steps: list<array<string, mixed>>}
     */
    public function buildReasoningPlan(array $settings, string $message): array
    {
        $analysisMode = $this->detectAnalysisMode($message);
        $steps = [];
        $followUpSuggestions = [];

        if ($analysisMode === 'finance') {
            $steps[] = ['id' => 'inspect_metrics', 'name' => 'Inspect recent income and expense metrics', 'kind' => 'tool'];
            $steps[] = ['id' => 'compare_periods', 'name' => 'Compare current and prior periods', 'kind' => 'analysis'];
            $steps[] = ['id' => 'explain_cause', 'name' => 'Explain likely causes of the trend', 'kind' => 'synthesis'];
            $steps[] = ['id' => 'recommend_action', 'name' => 'Suggest follow-up actions', 'kind' => 'recommendation'];
            $followUpSuggestions = [
                'Break down expenses by category',
                'Compare this month vs last month',
                'Show the biggest spending drivers',
            ];
        } elseif ($analysisMode === 'inventory') {
            $steps[] = ['id' => 'inspect_context', 'name' => 'Inspect inventory and product trends', 'kind' => 'tool'];
            $steps[] = ['id' => 'evaluate_findings', 'name' => 'Evaluate restocking and demand signals', 'kind' => 'analysis'];
            $steps[] = ['id' => 'explain_insights', 'name' => 'Explain inventory and product health', 'kind' => 'synthesis'];
            $steps[] = ['id' => 'recommend_action', 'name' => 'Recommend replenishment actions', 'kind' => 'recommendation'];
            $followUpSuggestions = [
                'Show low-stock products',
                'Compare product demand and inventory',
                'Identify products that should be restocked first',
            ];
        } else {
            $steps[] = ['id' => 'inspect_context', 'name' => 'Inspect the current business context', 'kind' => 'tool'];
            $steps[] = ['id' => 'evaluate_findings', 'name' => 'Evaluate the findings and relevance to your question', 'kind' => 'analysis'];
            $steps[] = ['id' => 'explain_insights', 'name' => 'Explain the key insights', 'kind' => 'synthesis'];
            $steps[] = ['id' => 'recommend_action', 'name' => 'Suggest next steps or follow-up analysis', 'kind' => 'recommendation'];
            $followUpSuggestions = [
                'Ask for a specific product or customer segment',
                'Request a trend comparison over time',
                'Ask me to investigate a sales or inventory pattern',
            ];
        }

        return [
            'mode' => $analysisMode,
            'steps' => $steps,
            'followUpSuggestions' => $followUpSuggestions,
        ];
    }

    private function fetchLatestUserMessage(string $runId): string
    {
        $row = $this->database->fetchOne(
            'SELECT content FROM agent_messages WHERE run_id = :run_id AND role = :role ORDER BY created_at ASC LIMIT 1',
            [':run_id' => $runId, ':role' => 'user']
        );

        return trim((string) ($row['content'] ?? ''));
    }

    /**
     * Load previous conversation messages (excluding the current run) so the AI has context.
     * Returns Gemini-compatible contents array with alternating user/model roles.
     */
    private function loadConversationHistory(string $conversationId, string $currentRunId): array
    {
        if ($conversationId === '') {
            return [];
        }

        $messages = $this->database->fetchAll(
            'SELECT role, content FROM agent_messages WHERE conversation_id = :conversation_id AND run_id != :run_id ORDER BY created_at ASC LIMIT 20',
            [':conversation_id' => $conversationId, ':run_id' => $currentRunId]
        );

        $history = [];
        foreach ($messages as $msg) {
            $role = (string) ($msg['role'] ?? '');
            $content = (string) ($msg['content'] ?? '');
            if ($content === '') {
                continue;
            }
            $geminiRole = $role === 'user' ? 'user' : 'model';
            $history[] = [
                'role' => $geminiRole,
                'parts' => [['text' => $content]],
            ];
        }

        return $history;
    }

    private function runBusinessSnapshotTool(string $runId, string $conversationId, array $settings): array
    {
        $toolId = $this->uuid4();
        $startedAt = microtime(true);
        $queries = [
            [
                'label' => 'orders',
                'sql' => 'SELECT COUNT(*) AS count FROM orders WHERE deleted_at IS NULL',
            ],
            [
                'label' => 'products',
                'sql' => 'SELECT COUNT(*) AS count FROM products WHERE deleted_at IS NULL',
            ],
            [
                'label' => 'customers',
                'sql' => 'SELECT COUNT(*) AS count FROM customers WHERE deleted_at IS NULL',
            ],
            [
                'label' => 'bills',
                'sql' => 'SELECT COUNT(*) AS count FROM bills WHERE deleted_at IS NULL',
            ],
            [
                'label' => 'transactions',
                'sql' => 'SELECT COUNT(*) AS count FROM transactions WHERE deleted_at IS NULL',
            ],
        ];

        $rows = [];
        foreach ($queries as $query) {
            $row = $this->executeSafeQuery($runId, $toolId, $query['sql'], $query['params'] ?? []);
            $rows[] = [
                'label' => $query['label'],
                'count' => (int) ($row['count'] ?? 0),
            ];
        }

        $lowStockProducts = $this->database->fetchAll(
            'SELECT id, name, stock, sale_price FROM products WHERE deleted_at IS NULL ORDER BY stock ASC, name ASC LIMIT 5'
        );

        $topSellingProducts = $this->fetchTopSellingProducts($runId, $toolId, 5);

        $summaryParts = array_map(static fn(array $row): string => $row['label'] . ' ' . $row['count'], $rows);
        $summary = 'I checked the current records and found ' . implode(', ', $summaryParts) . '.';

        if ($lowStockProducts !== []) {
            $summary .= ' I also identified low-stock products like ' . implode(', ', array_map(static fn(array $row): string => sprintf('%s (%s)', $row['name'] ?? 'Unnamed Product', $row['stock']), $lowStockProducts)) . '.';
        }

        if ($topSellingProducts !== []) {
            $summary .= ' Top sellers recently include ' . implode(', ', array_map(static fn(array $row): string => sprintf('%s (%s sold)', $row['productName'], $row['quantity']), $topSellingProducts)) . '.';
        }

        $duration = (int) round((microtime(true) - $startedAt) * 1000);
        $this->database->execute(
            'INSERT INTO agent_tool_calls (id, run_id, step_no, tool_name, tool_input_json, tool_result_json, status, duration_ms, created_at) VALUES (:id, :run_id, :step_no, :tool_name, :tool_input_json, :tool_result_json, :status, :duration_ms, :created_at)',
            [
                ':id' => $toolId,
                ':run_id' => $runId,
                ':step_no' => 1,
                ':tool_name' => 'business_snapshot',
                ':tool_input_json' => $this->encodePayload(['queries' => $queries]),
                ':tool_result_json' => $this->encodePayload(['rows' => $rows, 'lowStockProducts' => $lowStockProducts, 'topSellingProducts' => $topSellingProducts]),
                ':status' => 'completed',
                ':duration_ms' => $duration,
                ':created_at' => $this->database->nowUtc(),
            ]
        );

        return [
            'rows' => $rows,
            'summary' => $summary,
            'lowStockProducts' => $lowStockProducts,
            'topSellingProducts' => $topSellingProducts,
        ];
    }

    private function executeSafeQuery(string $runId, string $toolId, string $sql, array $params = []): array
    {
        $normalized = trim($sql);
        if ($normalized === '') {
            throw new ApiException('Query cannot be empty.', 400);
        }

        if (preg_match('/^SELECT\b/i', $normalized) !== 1) {
            throw new ApiException('Only SELECT queries are allowed for safe database access.', 400);
        }

        if (preg_match('/;/', $normalized) === 1 || str_contains($normalized, '--') || str_contains($normalized, '/*')) {
            throw new ApiException('Only single-statement SELECT queries are allowed.', 400);
        }

        $startedAt = microtime(true);
        $row = $this->database->fetchOne($normalized, $params);
        $duration = (int) round((microtime(true) - $startedAt) * 1000);

        $runRow = $this->database->fetchOne('SELECT user_id FROM agent_runs WHERE id = :run_id LIMIT 1', [':run_id' => $runId]);
        $userId = (string) ($runRow['user_id'] ?? '');

        $this->database->execute(
            'INSERT INTO agent_db_query_audit (id, run_id, tool_call_id, user_id, sql_text, normalized_sql, row_count, duration_ms, safety_flags_json, created_at) VALUES (:id, :run_id, :tool_call_id, :user_id, :sql_text, :normalized_sql, :row_count, :duration_ms, :safety_flags_json, :created_at)',
            [
                ':id' => $this->uuid4(),
                ':run_id' => $runId,
                ':tool_call_id' => $toolId,
                ':user_id' => $userId,
                ':sql_text' => $normalized,
                ':normalized_sql' => $normalized,
                ':row_count' => $row === null ? 0 : 1,
                ':duration_ms' => $duration,
                ':safety_flags_json' => $this->encodePayload(['allow_select' => true, 'single_statement' => true]),
                ':created_at' => $this->database->nowUtc(),
            ]
        );

        return $row ?? [];
    }

    public function analyzeProfitTrendMetrics(array $currentPeriod, array $previousPeriod): array
    {
        $sales = (float) ($currentPeriod['sales'] ?? 0);
        $purchases = (float) ($currentPeriod['purchases'] ?? 0);
        $otherExpenses = (float) ($currentPeriod['otherExpenses'] ?? 0);
        $otherIncome = (float) ($currentPeriod['otherIncome'] ?? 0);
        $previousSales = (float) ($previousPeriod['sales'] ?? 0);
        $previousPurchases = (float) ($previousPeriod['purchases'] ?? 0);
        $previousOtherExpenses = (float) ($previousPeriod['otherExpenses'] ?? 0);
        $previousOtherIncome = (float) ($previousPeriod['otherIncome'] ?? 0);

        $currentNetProfit = $sales + $otherIncome - $purchases - $otherExpenses;
        $previousNetProfit = $previousSales + $previousOtherIncome - $previousPurchases - $previousOtherExpenses;
        $netProfitChange = $currentNetProfit - $previousNetProfit;
        $netProfitChangePercent = $previousNetProfit !== 0.0 ? ($netProfitChange / $previousNetProfit) * 100 : 0.0;

        $salesChange = $sales - $previousSales;
        $salesChangePercent = $previousSales !== 0.0 ? ($salesChange / $previousSales) * 100 : 0.0;
        $purchaseChange = $purchases - $previousPurchases;
        $expenseChange = $otherExpenses - $previousOtherExpenses;
        $incomeChange = $otherIncome - $previousOtherIncome;

        $likelyCauses = [];
        if ($salesChangePercent < -5.0) {
            $likelyCauses[] = 'Sales were noticeably lower than the prior period.';
        }
        if ($purchaseChange > 0) {
            $likelyCauses[] = 'Purchase costs increased, which compressed profit.';
        }
        if ($expenseChange > 0) {
            $likelyCauses[] = 'Other expenses rose, which reduced the margin.';
        }
        if ($incomeChange < 0) {
            $likelyCauses[] = 'Other income softened compared with the earlier period.';
        }
        if ($likelyCauses === []) {
            $likelyCauses[] = 'The main pressure does not appear to be from a single obvious spike; the trend is relatively flat.';
        }

        $summary = sprintf(
            'Current net profit is %.2f, compared with %.2f previously. Profit changed by %.2f (%.2f%%).',
            $currentNetProfit,
            $previousNetProfit,
            $netProfitChange,
            $netProfitChangePercent
        );

        return [
            'currentNetProfit' => round($currentNetProfit, 2),
            'previousNetProfit' => round($previousNetProfit, 2),
            'netProfitChange' => round($netProfitChange, 2),
            'netProfitChangePercent' => round($netProfitChangePercent, 2),
            'salesChange' => round($salesChange, 2),
            'salesChangePercent' => round($salesChangePercent, 2),
            'purchaseChange' => round($purchaseChange, 2),
            'expenseChange' => round($expenseChange, 2),
            'incomeChange' => round($incomeChange, 2),
            'likelyCauses' => $likelyCauses,
            'summary' => $summary,
        ];
    }

    private function isFinanceAnalysisRequest(string $message): bool
    {
        $messageLower = strtolower($message);
        return preg_match('/\b(profit|loss|sales|purchase|purchases|expense|expenses|income|revenue|cost|declin|lower|higher|trend|why)\b/', $messageLower) === 1;
    }

    private function detectAnalysisMode(string $message): string
    {
        $messageLower = strtolower($message);
        if (preg_match('/\b(profit|loss|income|expenses|revenue|margin|net profit|gross profit|cost|cash flow)\b/', $messageLower) === 1) {
            return 'finance';
        }

        if (preg_match('/\b(stock|restock|reorder|inventory|stockout|low stock|replenish|replenishment|available units)\b/', $messageLower) === 1) {
            return 'inventory';
        }

        if (preg_match('/\b(product|customer|order|transaction|report|trend|growth|decline|forecast|predict|should i|what should|why|which product)\b/', $messageLower) === 1) {
            return 'operations';
        }

        return 'general';
    }

    private function fetchTopSellingProducts(string $runId, string $toolId, int $limit = 5): array
    {
        $rows = $this->database->fetchAll(
            'SELECT items FROM orders WHERE deleted_at IS NULL AND status = :status ORDER BY order_date DESC LIMIT 250',
            [':status' => 'Completed']
        );

        $productMap = [];
        foreach ($rows as $row) {
            $items = json_decode((string) ($row['items'] ?? '[]'), true);
            if (!is_array($items)) {
                continue;
            }
            foreach ($items as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $productName = trim((string) ($item['productName'] ?? 'Unnamed Product'));
                $quantity = (float) ($item['quantity'] ?? 0);
                $revenue = (float) ($item['amount'] ?? 0);

                if ($productName === '') {
                    continue;
                }

                if (!isset($productMap[$productName])) {
                    $productMap[$productName] = ['productName' => $productName, 'quantity' => 0.0, 'revenue' => 0.0];
                }

                $productMap[$productName]['quantity'] += $quantity;
                $productMap[$productName]['revenue'] += $revenue;
            }
        }

        $productRows = array_values($productMap);
        usort($productRows, static function (array $left, array $right): int {
            if ((float) $right['quantity'] !== (float) $left['quantity']) {
                return (float) $right['quantity'] <=> (float) $left['quantity'];
            }
            if ((float) $right['revenue'] !== (float) $left['revenue']) {
                return (float) $right['revenue'] <=> (float) $left['revenue'];
            }
            return strcmp((string) ($left['productName'] ?? ''), (string) ($right['productName'] ?? ''));
        });

        return array_slice($productRows, 0, $limit);
    }

    private function runProfitAnalysisTool(string $runId, string $conversationId, array $settings): array
    {
        $toolId = $this->uuid4();
        $startedAt = microtime(true);
        $localTimezone = new \DateTimeZone($this->config->timezone());
        $utcTimezone = $this->utcTimezone();
        $now = new \DateTimeImmutable('now', $localTimezone);
        $currentStart = $now->modify('-30 days')->setTime(0, 0, 0);
        $currentEnd = $now->setTime(23, 59, 59);
        $previousStart = $currentStart->modify('-30 days');
        $previousEnd = $currentStart->modify('-1 second');

        $queries = [
            [
                'label' => 'sales',
                'sql' => "SELECT COALESCE(SUM(amount), 0) AS value FROM transactions WHERE deleted_at IS NULL AND type = 'Income' AND date >= :from AND date < :to",
                'params' => [':from' => $currentStart->setTimezone($utcTimezone)->format('Y-m-d H:i:s'), ':to' => $currentEnd->setTimezone($utcTimezone)->format('Y-m-d H:i:s')],
            ],
            [
                'label' => 'purchases',
                'sql' => "SELECT COALESCE(SUM(amount), 0) AS value FROM transactions WHERE deleted_at IS NULL AND type = 'Expense' AND category = 'expense_purchases' AND date >= :from AND date < :to",
                'params' => [':from' => $currentStart->setTimezone($utcTimezone)->format('Y-m-d H:i:s'), ':to' => $currentEnd->setTimezone($utcTimezone)->format('Y-m-d H:i:s')],
            ],
            [
                'label' => 'otherExpenses',
                'sql' => "SELECT COALESCE(SUM(amount), 0) AS value FROM transactions WHERE deleted_at IS NULL AND type = 'Expense' AND COALESCE(category, '') <> 'expense_purchases' AND date >= :from AND date < :to",
                'params' => [':from' => $currentStart->setTimezone($utcTimezone)->format('Y-m-d H:i:s'), ':to' => $currentEnd->setTimezone($utcTimezone)->format('Y-m-d H:i:s')],
            ],
            [
                'label' => 'otherIncome',
                'sql' => "SELECT COALESCE(SUM(amount), 0) AS value FROM transactions WHERE deleted_at IS NULL AND type = 'Income' AND COALESCE(reference_id, '') = '' AND date >= :from AND date < :to",
                'params' => [':from' => $currentStart->setTimezone($utcTimezone)->format('Y-m-d H:i:s'), ':to' => $currentEnd->setTimezone($utcTimezone)->format('Y-m-d H:i:s')],
            ],
        ];

        $currentPeriod = [];
        $previousPeriod = [];
        foreach ($queries as $index => $query) {
            $key = $query['label'];
            $row = $this->executeSafeQuery($runId, $toolId, $query['sql'], $query['params']);
            $value = (float) ($row['value'] ?? 0);
            $currentPeriod[$key] = $value;

            $previousQuery = [
                'label' => $key,
                'sql' => $query['sql'],
                'params' => [':from' => $previousStart->setTimezone($utcTimezone)->format('Y-m-d H:i:s'), ':to' => $previousEnd->setTimezone($utcTimezone)->format('Y-m-d H:i:s')],
            ];
            $previousRow = $this->executeSafeQuery($runId, $toolId, $previousQuery['sql'], $previousQuery['params']);
            $previousPeriod[$key] = (float) ($previousRow['value'] ?? 0);
        }

        $analysis = $this->analyzeProfitTrendMetrics($currentPeriod, $previousPeriod);
        $duration = (int) round((microtime(true) - $startedAt) * 1000);
        $this->database->execute(
            'INSERT INTO agent_tool_calls (id, run_id, step_no, tool_name, tool_input_json, tool_result_json, status, duration_ms, created_at) VALUES (:id, :run_id, :step_no, :tool_name, :tool_input_json, :tool_result_json, :status, :duration_ms, :created_at)',
            [
                ':id' => $toolId,
                ':run_id' => $runId,
                ':step_no' => 2,
                ':tool_name' => 'profit_analysis',
                ':tool_input_json' => $this->encodePayload(['currentStart' => $currentStart->format('Y-m-d'), 'previousStart' => $previousStart->format('Y-m-d')]),
                ':tool_result_json' => $this->encodePayload(['analysis' => $analysis]),
                ':status' => 'completed',
                ':duration_ms' => $duration,
                ':created_at' => $this->database->nowUtc(),
            ]
        );

        return [
            'analysis' => $analysis,
            'summary' => $analysis['summary'],
            'details' => [
                'sales' => $analysis['salesChange'] ?? 0,
                'expenses' => $analysis['expenseChange'] ?? 0,
                'profitChangePercent' => $analysis['netProfitChangePercent'] ?? 0,
            ],
        ];
    }

    private function composeFinanceAnswer(string $message, array $analysis): string
    {
        $causes = implode(' ', $analysis['likelyCauses'] ?? []);
        $direction = ((float) ($analysis['netProfitChangePercent'] ?? 0)) < 0 ? 'down' : 'up';
        return sprintf(
            'I compared the latest 30-day window with the prior 30-day window. Your net profit is %s by %.2f%%, and the main pressure appears to be %s The current snapshot shows sales change of %.2f and expense change of %.2f. %s',
            $direction,
            abs((float) ($analysis['netProfitChangePercent'] ?? 0)),
            strtolower((string) ($analysis['likelyCauses'][0] ?? 'the current trend')),
            (float) ($analysis['salesChange'] ?? 0),
            (float) ($analysis['expenseChange'] ?? 0),
            $analysis['summary'] ?? ''
        );
    }

    private function composeAnswer(string $message, array $toolSnapshot, array $plan, string $analysisMode): string
    {
        $summaryParts = array_map(static fn(array $row): string => $row['label'] . ' ' . $row['count'], $toolSnapshot['rows']);
        $base = $plan['lane'] === 'deterministic'
            ? 'I retrieved the requested business summary and found ' . implode(', ', $summaryParts) . '.'
            : 'I reviewed the current business snapshot and found ' . implode(', ', $summaryParts) . '.';

        $additional = [];
        if (!empty($toolSnapshot['lowStockProducts'])) {
            $additional[] = 'Low-stock products include ' . implode(', ', array_map(static fn(array $row): string => sprintf('%s (%s units)', $row['name'] ?? 'Unnamed Product', $row['stock']), $toolSnapshot['lowStockProducts'])) . '.';
        }
        if (!empty($toolSnapshot['topSellingProducts'])) {
            $additional[] = 'Recent top sellers include ' . implode(', ', array_map(static fn(array $row): string => sprintf('%s (%s sold)', $row['productName'], $row['quantity']), $toolSnapshot['topSellingProducts'])) . '.';
        }

        if ($analysisMode === 'inventory') {
            $additional[] = 'Based on current inventory levels, these products may need restocking soon.';
        } elseif ($analysisMode === 'operations') {
            $additional[] = 'This provides a view of orders, inventory health, and customer activity right now.';
        } else {
            $additional[] = 'I can also drill deeper into a specific product, customer, order, bill, or transaction.';
        }

        return trim($base . ' ' . implode(' ', $additional));
    }

    private function markRunCompleted(string $runId, string $answer, string $now): void
    {
        $this->database->execute(
            'UPDATE agent_runs SET status = :status, error_message = NULL, finished_at = :finished_at, updated_at = :updated_at WHERE id = :id',
            [
                ':status' => 'completed',
                ':finished_at' => $now,
                ':updated_at' => $now,
                ':id' => $runId,
            ]
        );
        $this->persistMessage($this->resolveConversationId($runId), $runId, 'assistant', $answer);
    }

    private function markRunFailed(string $runId, string $answer, string $now, string $errorMessage): void
    {
        $this->database->execute(
            'UPDATE agent_runs SET status = :status, error_message = :error_message, finished_at = :finished_at, updated_at = :updated_at WHERE id = :id',
            [
                ':status' => 'failed',
                ':error_message' => $errorMessage,
                ':finished_at' => $now,
                ':updated_at' => $now,
                ':id' => $runId,
            ]
        );
        $this->persistMessage($this->resolveConversationId($runId), $runId, 'assistant', $answer);
    }

    private function resolveConversationId(string $runId): string
    {
        $row = $this->database->fetchOne('SELECT conversation_id FROM agent_runs WHERE id = :id LIMIT 1', [':id' => $runId]);
        return (string) ($row['conversation_id'] ?? '');
    }

    private function buildRunSnapshot(string $runId, string $conversationId, string $streamToken, string $status, string $answer, array $events): array
    {
        return [
            'runId' => $runId,
            'conversationId' => $conversationId,
            'streamToken' => $streamToken,
            'status' => $status,
            'answer' => $answer,
            'events' => $events,
        ];
    }

    private function encodePayload(array $payload): string
    {
        return json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
    }

    private function decodePayload(string $payload): array
    {
        $decoded = json_decode($payload, true);
        return is_array($decoded) ? $decoded : [];
    }

    private static ?string $schemaCache = null;

    private function buildSchemaDescription(): string
    {
        if (self::$schemaCache !== null) {
            return self::$schemaCache;
        }

        try {
            $tables = $this->database->fetchAll(
                'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME ASC'
            );
        } catch (\Throwable) {
            return 'Schema introspection unavailable.';
        }

        $skipPattern = '/^(agent_|payment_webhook_logs|notification_receipts|service_subscription)/';
        $lines = [];

        foreach ($tables as $table) {
            $tableName = (string) ($table['TABLE_NAME'] ?? '');
            if ($tableName === '' || preg_match($skipPattern, $tableName) === 1) {
                continue;
            }

            try {
                $columns = $this->database->fetchAll(
                    'SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION ASC',
                    [':table' => $tableName]
                );
            } catch (\Throwable) {
                continue;
            }

            if (empty($columns)) {
                continue;
            }

            $colLines = [];
            foreach ($columns as $col) {
                $colName = (string) ($col['COLUMN_NAME'] ?? '');
                $colType = (string) ($col['COLUMN_TYPE'] ?? '');
                $key = (string) ($col['COLUMN_KEY'] ?? '');
                $tag = $key === 'PRI' ? ' [PK]' : ($key === 'MUL' ? ' [IDX]' : '');
                $colLines[] = '    ' . $colName . ' ' . $colType . $tag;
            }

            $lines[] = 'TABLE `' . $tableName . "`:\n" . implode("\n", $colLines);
        }

        self::$schemaCache = implode("\n\n", $lines);
        return self::$schemaCache;
    }

    /**
     * Detect simple factual questions and return a direct SQL query.
     * Returns null if the question requires LLM analysis.
     *
     * @return array{sql: string, label: string, description: string, format: string}|null
     */
    private function detectSimpleQuestion(string $message): ?array
    {
        $m = strtolower(trim($message));
        // Remove common filler words
        $m = preg_replace('/\b(please|can you|could you|tell me|i want to know|i need to know|show me|what is|what\'s|how many|how much|give me|let me know)\b/', '', $m);
        $m = preg_replace('/\s+/', ' ', trim($m));

        // Count patterns
        $countPatterns = [
            // Orders
            ['pattern' => '/\b(orders?|order count)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `orders` WHERE `deleted_at` IS NULL", 'label' => 'total orders', 'description' => 'Counting total orders.', 'format' => 'number'],
            // Customers
            ['pattern' => '/\b(customers?|customer count|clients?|client count)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `customers` WHERE `deleted_at` IS NULL", 'label' => 'total customers', 'description' => 'Counting total customers.', 'format' => 'number'],
            // Products
            ['pattern' => '/\b(products?|product count|items?|inventory count|stock count)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `products` WHERE `deleted_at` IS NULL", 'label' => 'total products', 'description' => 'Counting total products.', 'format' => 'number'],
            // Bills
            ['pattern' => '/\b(bills?|bill count|invoices?|invoice count)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `bills` WHERE `deleted_at` IS NULL", 'label' => 'total bills', 'description' => 'Counting total bills.', 'format' => 'number'],
            // Transactions
            ['pattern' => '/\b(transactions?|transaction count|payments?|payment count)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `transactions` WHERE `deleted_at` IS NULL", 'label' => 'total transactions', 'description' => 'Counting total transactions.', 'format' => 'number'],
            // Employees (users)
            ['pattern' => '/\b(employees?|employee count|staff|staff count|users?|user count|team\s+members?)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `users` WHERE `deleted_at` IS NULL AND COALESCE(`is_system`, 0) = 0", 'label' => 'total users', 'description' => 'Counting total users/staff.', 'format' => 'number'],
            // Vendors
            ['pattern' => '/\b(vendors?|vendor count|suppliers?|supplier count)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `vendors` WHERE `deleted_at` IS NULL", 'label' => 'total vendors', 'description' => 'Counting total vendors.', 'format' => 'number'],
        ];

        // Sum / amount patterns
        $sumPatterns = [
            // Total sales / revenue / income
            ['pattern' => '/\b(total\s+)?(sales?|revenue|income|earnings?)\b/', 'sql' => "SELECT COALESCE(SUM(`amount`), 0) AS result FROM `transactions` WHERE `deleted_at` IS NULL AND `type` = 'Income'", 'label' => 'total income', 'description' => 'Calculating total income.', 'format' => 'money'],
            // Total expenses
            ['pattern' => '/\b(total\s+)?(expenses?|expenditure|spending|costs?)\b/', 'sql' => "SELECT COALESCE(SUM(`amount`), 0) AS result FROM `transactions` WHERE `deleted_at` IS NULL AND `type` = 'Expense'", 'label' => 'total expenses', 'description' => 'Calculating total expenses.', 'format' => 'money'],
            // Total purchases
            ['pattern' => '/\b(total\s+)?(purchases?|purchase amount)\b/', 'sql' => "SELECT COALESCE(SUM(`amount`), 0) AS result FROM `transactions` WHERE `deleted_at` IS NULL AND `type` = 'Expense' AND `category` = 'expense_purchases'", 'label' => 'total purchases', 'description' => 'Calculating total purchases.', 'format' => 'money'],
            // Profit
            ['pattern' => '/\b(net\s+)?(profit|loss|earnings|net income)\b/', 'sql' => "SELECT COALESCE(SUM(CASE WHEN `type` = 'Income' THEN `amount` ELSE -`amount` END), 0) AS result FROM `transactions` WHERE `deleted_at` IS NULL", 'label' => 'net profit', 'description' => 'Calculating net profit (income minus expenses).', 'format' => 'money'],
            // Total order value
            ['pattern' => '/\b(total\s+)?(order\s+)?(value|amount|worth)\b.*\border/', 'sql' => "SELECT COALESCE(SUM(`total`), 0) AS result FROM `orders` WHERE `deleted_at` IS NULL", 'label' => 'total order value', 'description' => 'Calculating total order value.', 'format' => 'money'],
        ];

        // Status / listing patterns
        $statusPatterns = [
            // Pending orders
            ['pattern' => '/\b(pending|on hold|unprocessed)\s+(orders?)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `orders` WHERE `deleted_at` IS NULL AND `status` = 'On Hold'", 'label' => 'pending orders', 'description' => 'Counting pending orders.', 'format' => 'number'],
            // Processing orders
            ['pattern' => '/\b(processing)\s+(orders?)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `orders` WHERE `deleted_at` IS NULL AND `status` = 'Processing'", 'label' => 'processing orders', 'description' => 'Counting processing orders.', 'format' => 'number'],
            // Completed orders
            ['pattern' => '/\b(completed|delivered|done|finished)\s+(orders?)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `orders` WHERE `deleted_at` IS NULL AND `status` = 'Completed'", 'label' => 'completed orders', 'description' => 'Counting completed orders.', 'format' => 'number'],
            // Cancelled orders
            ['pattern' => '/\b(cancelled?|canceled?)\s+(orders?)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `orders` WHERE `deleted_at` IS NULL AND `status` = 'Cancelled'", 'label' => 'cancelled orders', 'description' => 'Counting cancelled orders.', 'format' => 'number'],
            // Low stock products
            ['pattern' => '/\b(low\s+stock|out\s+of\s+stock|stock\s+alert|reorder)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `products` WHERE `deleted_at` IS NULL AND `stock` <= 5", 'label' => 'low stock products', 'description' => 'Counting products with low stock (5 or fewer).', 'format' => 'number'],
            // Unpaid bills
            ['pattern' => '/\b(unpaid|pending|overdue)\s+(bills?|invoices?)\b/', 'sql' => "SELECT COUNT(*) AS result FROM `bills` WHERE `deleted_at` IS NULL AND `status` NOT IN ('Paid', 'Cancelled')", 'label' => 'unpaid bills', 'description' => 'Counting unpaid bills.', 'format' => 'number'],
        ];

        // Must contain a count/sum/question intent word
        $hasCountIntent = preg_match('/\b(how many|count|total|number|sum|amount|all|list|show|give|what|how much|revenue|income|expense|profit|sales?|orders?|customers?|products?|bills?|transactions?|employees?|vendors?|pending|completed|cancelled|unpaid|low stock)\b/', $m) === 1;

        if (!$hasCountIntent) {
            return null;
        }

        // Try all pattern groups
        foreach (array_merge($countPatterns, $sumPatterns, $statusPatterns) as $entry) {
            if (preg_match($entry['pattern'], $m) === 1) {
                return $entry;
            }
        }

        return null;
    }

    /**
     * Format a simple query result into a human-readable answer.
     */
    private function formatSimpleAnswer(string $label, mixed $value, string $format): string
    {
        if ($value === null) {
            return "I couldn't find any data for {$label}.";
        }

        if ($format === 'money') {
            $amount = number_format((float) $value, 2);
            return "Your **{$label}** is **BDT {$amount}**.";
        }

        $count = (int) $value;
        return "You have **{$count}** {$label}.";
    }

    /**
     * Convert technical error messages into user-friendly text.
     */
    private function humanizeError(string $error): string
    {
        $lower = strtolower($error);

        if (str_contains($lower, 'curl') || str_contains($lower, 'http request failed') || str_contains($lower, 'timeout')) {
            return 'The AI service is temporarily unreachable. Please try again in a moment.';
        }
        if (str_contains($lower, 'api key') || str_contains($lower, 'unauthorized') || str_contains($lower, '403')) {
            return 'The AI service authentication failed. Please contact support.';
        }
        if (str_contains($lower, '429') || str_contains($lower, 'rate limit') || str_contains($lower, 'quota')) {
            return 'The AI service is busy. Please wait a moment and try again.';
        }
        if (str_contains($lower, 'blocked') || str_contains($lower, 'safety')) {
            return 'The request was filtered by content safety. Please rephrase your question.';
        }
        if (str_contains($lower, 'no llm api key')) {
            return 'The AI service is not configured. Please set up an API key in agent settings.';
        }
        if (str_contains($lower, 'mysql') || str_contains($lower, 'sql') || str_contains($lower, 'database')) {
            return 'A database error occurred while processing your request. Please try again.';
        }
        if (str_contains($lower, 'memory') || str_contains($lower, 'out of memory')) {
            return 'The request was too large to process. Please try a more specific question.';
        }

        return 'An unexpected error occurred. Please try again.';
    }

    private function buildAgentSystemPrompt(string $schema, array $settings): string
    {
        $rowLimit = (int) ($settings['query_row_limit'] ?? 100);

        return 'You are Mame, the AI business assistant for MamePilot. You have database access to answer complex analytical questions about business data.' . "\n\n"
            . 'DATABASE SCHEMA:' . "\n" . $schema . "\n\n"
            . 'CRITICAL BEHAVIOR:' . "\n"
            . '1. SIMPLE QUESTIONS (greetings, yes/no, general knowledge): Respond with text directly. Do NOT call any function.' . "\n"
            . '2. DATA QUESTIONS: Use execute_sql_query, but be EFFICIENT. Use the FEWEST queries possible (1-2 for simple counts, 3 max for analysis).' . "\n"
            . '3. AFTER getting query results: IMMEDIATELY respond with your final text answer. Do NOT run additional queries unless absolutely necessary.' . "\n"
            . '4. NEVER run more than 3 queries total per question.' . "\n\n"
            . 'SQL RULES:' . "\n"
            . '- Only SELECT queries. Never write operations.' . "\n"
            . '- Use backtick-quoted identifiers.' . "\n"
            . '- Always include WHERE `deleted_at` IS NULL for soft-deleted tables.' . "\n"
            . '- Use LIMIT (max ' . $rowLimit . ' rows) and aggregation for large datasets.' . "\n"
            . '- Key JOINs: orders.customer_id->customers.id, bills.vendor_id->vendors.id, transactions.order_id->orders.id' . "\n"
            . '- orders.items is JSON with productName, quantity, amount fields.' . "\n"
            . '- Dates are UTC. Use `date` or `created_at` columns.' . "\n\n"
            . 'BUSINESS CONTEXT:' . "\n"
            . '- Currency: BDT/Taka (Bangladesh)' . "\n"
            . '- Order statuses: On Hold, Processing, Courier assigned, Picked, Completed, Cancelled, Returned' . "\n"
            . '- Transaction types: Income, Expense' . "\n"
            . '- Bill statuses: On Hold, Processing, Received, Paid, Cancelled' . "\n\n"
            . 'RESPONSE FORMAT: Use **bold** for key numbers. Use bullet points for lists. Be concise and actionable.';
    }

    // =====================================================================
    //  PIPELINE: Step 1 — Generate SQL from user question
    // =====================================================================

    private function buildSqlGenerationPrompt(string $schema, int $rowLimit, string $today): string
    {
        return 'You are a MySQL query generator. Given a user question, output ONE SQL SELECT query that answers it.' . "\n\n"
            . 'TODAY\'S DATE: ' . $today . "\n\n"
            . 'DATABASE SCHEMA:' . "\n" . $schema . "\n\n"
            . 'OUTPUT RULES (STRICT):' . "\n"
            . '- If the question is a greeting or does NOT need data, respond ONLY with: NO_QUERY_NEEDED' . "\n"
            . '- Otherwise, respond with ONLY the raw SQL query. NOTHING else.' . "\n"
            . '- NO explanation. NO markdown. NO code blocks. NO comments. NO prose.' . "\n"
            . '- The response must START with SELECT and contain ONLY valid SQL.' . "\n\n"
            . 'SQL RULES:' . "\n"
            . '- Only SELECT. Never INSERT/UPDATE/DELETE/DROP/ALTER.' . "\n"
            . '- Use backtick identifiers: `table`.`column`.' . "\n"
            . '- Always WHERE `deleted_at` IS NULL for soft-deleted tables.' . "\n"
            . '- LIMIT max ' . $rowLimit . '. Use COUNT/SUM/AVG/GROUP BY for aggregations.' . "\n"
            . '- JOINs: orders.customer_id->customers.id, bills.vendor_id->vendors.id, transactions.order_id->orders.id, transactions.bill_id->bills.id' . "\n"
            . '- orders.items is JSON (productName, quantity, amount).' . "\n"
            . '- Dates are UTC. Use `date` or `created_at` for filtering.' . "\n"
            . '- When user says "after July 7" without a year, use the most recent past date (e.g. if today is 2026-07-08, "after July 7" means 2026-07-07).' . "\n"
            . '- Currency: BDT/Taka.' . "\n"
            . '- Order statuses: On Hold, Processing, Courier assigned, Picked, Completed, Cancelled, Returned' . "\n"
            . '- Transaction types: Income, Expense. Bill statuses: On Hold, Processing, Received, Paid, Cancelled';
    }

    // =====================================================================
    //  PIPELINE: Step 2 — Synthesize answer from query results
    // =====================================================================

    private function buildSynthesisPrompt(string $originalQuestion, string $sql, array $queryResult, int $rowLimit): string
    {
        $rows = $queryResult['rows'] ?? [];
        $columns = $queryResult['columns'] ?? [];
        $rowCount = $queryResult['rowCount'] ?? 0;

        // Format the data for the LLM
        $dataPreview = '';
        if ($rowCount === 0) {
            $dataPreview = 'The query returned 0 rows (no data found).';
        } else {
            $previewRows = array_slice($rows, 0, 50);
            $dataPreview = "Query returned {$rowCount} row(s).\nColumns: " . implode(', ', $columns) . "\n\nData:\n";
            foreach ($previewRows as $i => $row) {
                $pairs = [];
                foreach ($row as $k => $v) {
                    $pairs[] = $k . '=' . (is_null($v) ? 'NULL' : (is_numeric($v) ? $v : '"' . $v . '"'));
                }
                $dataPreview .= ($i + 1) . '. ' . implode(', ', $pairs) . "\n";
            }
            if ($rowCount > 50) {
                $dataPreview .= "... and " . ($rowCount - 50) . " more rows.\n";
            }
        }

        return 'You are Mame, a friendly business assistant. Answer the user\'s question using the database results below.' . "\n\n"
            . 'USER QUESTION: ' . $originalQuestion . "\n\n"
            . 'QUERY RESULTS:' . "\n" . $dataPreview . "\n\n"
            . 'Write a natural, conversational answer. Example:' . "\n"
            . '- "You have **42** customers in total."' . "\n"
            . '- "There are **15** bills, with **8** still unpaid."' . "\n"
            . '- "Your total revenue is **BDT 1,25,000**."' . "\n\n"
            . 'Rules:' . "\n"
            . '- State the answer directly in a complete sentence' . "\n"
            . '- Use **bold** for key numbers' . "\n"
            . '- Use bullet points only for lists of items' . "\n"
            . '- Mention BDT for money values' . "\n"
            . '- If no data found, say "No data found" and suggest checking if records exist' . "\n"
            . '- Be brief: 1-3 sentences for counts/simple queries, more for analysis';
    }

    /**
     * Call Gemini WITHOUT function calling — plain text generation only.
     */
    private function callGeminiText(string $systemPrompt, array $history, string $userMessage, array $settings): array
    {
        $apiKey = trim((string) ($settings['google_api_key'] ?? ''));
        if ($apiKey === '') {
            $apiKey = trim((string) ($this->config->get('GEMINI_API_KEY') ?? ''));
        }
        if ($apiKey === '') {
            return ['error' => 'No LLM API key configured.'];
        }

        $model = trim((string) ($settings['mainModel'] ?? ''));
        if ($model === '') {
            $model = 'gemini-2.0-flash';
        }
        $endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';

        $contents = array_values($history);
        if ($userMessage !== '') {
            $contents[] = [
                'role' => 'user',
                'parts' => [['text' => $userMessage]],
            ];
        }

        $requestBody = [
            'systemInstruction' => [
                'parts' => [['text' => $systemPrompt]],
            ],
            'contents' => $contents,
            'generationConfig' => [
                'temperature' => 0.1,
                'topP' => 0.9,
                'candidateCount' => 1,
                'maxOutputTokens' => 2048,
            ],
        ];

        $headers = ['Content-Type' => 'application/json'];
        if (str_starts_with($apiKey, 'ya29.') || str_starts_with($apiKey, 'Bearer ')) {
            $cleanKey = preg_replace('/^Bearer\s+/i', '', $apiKey);
            $headers['Authorization'] = 'Bearer ' . $cleanKey;
        } else {
            $headers['x-goog-api-key'] = $apiKey;
        }

        try {
            $response = $this->httpJson('POST', $endpoint, $headers, $requestBody);
        } catch (\Throwable $ex) {
            return ['error' => 'LLM request failed: ' . $ex->getMessage()];
        }

        $json = $response['json'] ?? null;
        $status = (int) ($response['status'] ?? 0);

        if ($status !== 200) {
            $msg = 'LLM HTTP ' . $status;
            if (is_array($json) && isset($json['error']['message'])) {
                $msg .= ': ' . $json['error']['message'];
            }
            return ['error' => $msg];
        }

        if (!is_array($json)) {
            return ['error' => 'Invalid LLM response.'];
        }

        $candidate = $json['candidates'][0] ?? null;
        if ($candidate === null) {
            $blockReason = $json['promptFeedback']['blockReason'] ?? '';
            return ['error' => $blockReason !== '' ? 'Request blocked: ' . $blockReason : 'No candidates in response.'];
        }

        $content = $candidate['content'] ?? null;
        if ($content === null || !isset($content['parts'])) {
            return ['error' => 'No content in response.'];
        }

        $textParts = [];
        foreach ($content['parts'] as $part) {
            if (isset($part['text'])) {
                $textParts[] = $part['text'];
            }
        }

        $text = trim(implode('', $textParts));
        if ($text === '') {
            return ['error' => 'Empty response from LLM.'];
        }

        return ['text' => $text];
    }

    /**
     * Extract SQL from LLM response (handles markdown code blocks, comments, etc.)
     */
    private function extractSqlFromResponse(string $response): string
    {
        // Remove NO_QUERY_NEEDED marker
        if (stripos($response, 'NO_QUERY_NEEDED') !== false) {
            return '';
        }

        // Try to extract from markdown code block first (most reliable)
        if (preg_match('/```(?:sql)?\s*\n?(.*?)```/s', $response, $m)) {
            $sql = trim($m[1]);
            if (preg_match('/^SELECT\b/i', $sql)) {
                return trim($sql, "; \t\n\r\0\x0B");
            }
        }

        // Find all SELECT statements and pick the longest one (most likely the main query)
        if (preg_match_all('/(SELECT\b.+?)(?:\n\n|\n```|\z)/si', $response, $matches)) {
            $best = '';
            foreach ($matches[1] as $candidate) {
                $candidate = trim($candidate, "; \t\n\r\0\x0B");
                // Strip any trailing explanation lines (non-SQL lines)
                $lines = explode("\n", $candidate);
                $sqlLines = [];
                foreach ($lines as $line) {
                    $trimmedLine = trim($line);
                    if ($trimmedLine === '') break; // blank line = end of SQL
                    if (preg_match('/^(SELECT|FROM|WHERE|AND|OR|JOIN|LEFT|RIGHT|INNER|ON|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|INSERT|UPDATE|DELETE|SET|VALUES|CREATE|ALTER|DROP|WITH|AS|\(|\)|,|;|--|\*|\d)/i', $trimmedLine) === 0) break; // not a SQL line
                    $sqlLines[] = $line;
                }
                $sqlCandidate = trim(implode("\n", $sqlLines), "; \t\n\r\0\x0B");
                if (strlen($sqlCandidate) > strlen($best)) {
                    $best = $sqlCandidate;
                }
            }
            if ($best !== '' && preg_match('/^SELECT\b/i', $best)) {
                return $best;
            }
        }

        // Last resort: raw SELECT match
        if (preg_match('/(SELECT\b.+)/si', $response, $m)) {
            return trim($m[1], "; \t\n\r\0\x0B");
        }

        return '';
    }

    /**
     * Format raw query results as a fallback answer.
     */
    private function formatRawQueryResult(array $queryResult): string
    {
        $rows = $queryResult['rows'] ?? [];
        $rowCount = $queryResult['rowCount'] ?? 0;

        if ($rowCount === 0) {
            return 'No data found matching your question.';
        }

        // Single value (COUNT, SUM, etc.)
        if ($rowCount === 1 && count($rows[0] ?? []) === 1) {
            $value = array_values($rows[0])[0];
            return 'The result is: **' . $value . '**';
        }

        // Multiple rows
        $lines = [];
        foreach (array_slice($rows, 0, 20) as $row) {
            $parts = [];
            foreach ($row as $k => $v) {
                if ($v !== null && $v !== '') {
                    $parts[] = $k . ': ' . $v;
                }
            }
            $lines[] = '- ' . implode(', ', $parts);
        }

        $answer = implode("\n", $lines);
        if ($rowCount > 20) {
            $answer .= "\n... and " . ($rowCount - 20) . " more results.";
        }

        return $answer;
    }

    private function callGeminiAgent(string $systemPrompt, array $history, string $userMessage, array $settings, int $rowLimit): array
    {
        $apiKey = trim((string) ($settings['google_api_key'] ?? ''));
        if ($apiKey === '') {
            $apiKey = trim((string) ($this->config->get('GEMINI_API_KEY') ?? ''));
        }
        if ($apiKey === '') {
            return ['error' => 'No LLM API key configured. Set GEMINI_API_KEY in the backend .env file.'];
        }

        $model = trim((string) ($settings['mainModel'] ?? ''));
        if ($model === '') {
            $model = 'gemini-2.0-flash';
        }
        $endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';

        $contents = array_values($history);
        $contents[] = [
            'role' => 'user',
            'parts' => [['text' => $userMessage]],
        ];

        $requestBody = [
            'systemInstruction' => [
                'parts' => [['text' => $systemPrompt]],
            ],
            'contents' => $contents,
            'tools' => [
                [
                    'functionDeclarations' => [
                        [
                            'name' => 'execute_sql_query',
                            'description' => 'Execute a read-only SQL SELECT query against the business database. Use this to answer any question about orders, customers, products, transactions, bills, vendors, employees, payroll, wallet, accounts, or other business data. You can run multiple queries in sequence to gather all the data you need. Always use backtick-quoted identifiers. Include WHERE deleted_at IS NULL for soft-deleted tables.',
                            'parameters' => [
                                'type' => 'OBJECT',
                                'properties' => [
                                    'sql' => [
                                        'type' => 'STRING',
                                        'description' => 'A single SQL SELECT query. Use backtick-quoted identifiers. Include WHERE deleted_at IS NULL for soft-deleted tables. Use LIMIT to control result size.',
                                    ],
                                    'reasoning' => [
                                        'type' => 'STRING',
                                        'description' => 'Brief explanation of why you are running this query and what you expect to find.',
                                    ],
                                ],
                                'required' => ['sql', 'reasoning'],
                            ],
                        ],
                    ],
                ],
            ],
            'generationConfig' => [
                'temperature' => 0.1,
                'topP' => 0.9,
                'candidateCount' => 1,
                'maxOutputTokens' => 4096,
            ],
        ];

        $headers = ['Content-Type' => 'application/json'];
        if (str_starts_with($apiKey, 'ya29.') || str_starts_with($apiKey, 'Bearer ')) {
            $cleanKey = preg_replace('/^Bearer\s+/i', '', $apiKey);
            $headers['Authorization'] = 'Bearer ' . $cleanKey;
        } else {
            $headers['x-goog-api-key'] = $apiKey;
        }

        // Retry logic for transient failures (rate limits, server errors)
        $maxRetries = 1;
        $lastError = '';

        for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
            if ($attempt > 0) {
                usleep(500000); // 0.5s backoff
            }

            try {
                $response = $this->httpJson('POST', $endpoint, $headers, $requestBody);
            } catch (\Throwable $ex) {
                $lastError = 'LLM request failed: ' . $ex->getMessage();
                continue;
            }

            $json = $response['json'] ?? null;
            $status = (int) ($response['status'] ?? 0);

            // Success
            if ($status === 200) {
                return $this->parseGeminiAgentResponse($json);
            }

            // Retryable errors: rate limit (429), server errors (500, 502, 503)
            if (in_array($status, [429, 500, 502, 503], true) && $attempt < $maxRetries) {
                $lastError = 'LLM HTTP ' . $status;
                if (is_array($json) && isset($json['error']['message'])) {
                    $lastError .= ': ' . $json['error']['message'];
                }
                continue;
            }

            // Non-retryable error
            $msg = 'LLM HTTP ' . $status;
            if (is_array($json) && isset($json['error']['message'])) {
                $msg .= ': ' . $json['error']['message'];
            }
            return ['error' => $msg];
        }

        return ['error' => $lastError ?: 'LLM request failed after retries.'];
    }

    private function parseGeminiAgentResponse(mixed $json): array
    {
        if (!is_array($json)) {
            return ['error' => 'Invalid LLM response format.'];
        }

        $candidate = $json['candidates'][0] ?? null;
        if ($candidate === null) {
            $blockReason = $json['promptFeedback']['blockReason'] ?? '';
            if ($blockReason !== '') {
                return ['error' => 'Request was blocked: ' . $blockReason];
            }
            return ['error' => 'No candidates in LLM response.'];
        }

        $content = $candidate['content'] ?? null;
        if ($content === null || !isset($content['parts'])) {
            return ['error' => 'No content in LLM response.'];
        }

        $functionCalls = [];
        $textParts = [];

        foreach ($content['parts'] as $part) {
            if (isset($part['functionCall'])) {
                $functionCalls[] = $part['functionCall'];
            } elseif (isset($part['text'])) {
                $textParts[] = $part['text'];
            }
        }

        if (!empty($functionCalls)) {
            return ['functionCalls' => $functionCalls];
        }

        $text = trim(implode('', $textParts));
        if ($text !== '') {
            return ['text' => $text];
        }

        return ['error' => 'Empty response from LLM.'];
    }

    private function executeAgentQuery(string $runId, string $toolId, string $sql, int $rowLimit): array
    {
        $normalized = trim($sql);
        if ($normalized === '') {
            return ['rows' => [], 'columns' => [], 'rowCount' => 0, 'error' => 'Empty query.'];
        }

        if (preg_match('/^SELECT\b/i', $normalized) !== 1) {
            return ['rows' => [], 'columns' => [], 'rowCount' => 0, 'error' => 'Only SELECT queries are allowed.'];
        }

        $normalizedRTrimmed = rtrim($normalized, '; ');
        if (str_contains($normalizedRTrimmed, ';')) {
            return ['rows' => [], 'columns' => [], 'rowCount' => 0, 'error' => 'Only single-statement queries are allowed.'];
        }

        if (str_contains($normalized, '--') || str_contains($normalized, '/*')) {
            return ['rows' => [], 'columns' => [], 'rowCount' => 0, 'error' => 'Comments are not allowed in queries.'];
        }

        $forbidden = '/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|SET\s|LOAD|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i';
        if (preg_match($forbidden, $normalized) === 1) {
            return ['rows' => [], 'columns' => [], 'rowCount' => 0, 'error' => 'Write operations are not allowed.'];
        }

        if (preg_match('/\bLIMIT\b/i', $normalized) === 0) {
            $normalized .= ' LIMIT ' . $rowLimit;
        }

        $startedAt = microtime(true);
        try {
            $rows = $this->database->fetchAll($normalized);
        } catch (\Throwable $ex) {
            return ['rows' => [], 'columns' => [], 'rowCount' => 0, 'error' => 'Query error: ' . $ex->getMessage()];
        }
        $duration = (int) round((microtime(true) - $startedAt) * 1000);

        $columns = [];
        if (!empty($rows)) {
            $columns = array_keys($rows[0]);
        }

        $runRow = $this->database->fetchOne('SELECT user_id FROM agent_runs WHERE id = :run_id LIMIT 1', [':run_id' => $runId]);
        $userId = (string) ($runRow['user_id'] ?? '');

        try {
            $this->database->execute(
                'INSERT INTO agent_db_query_audit (id, run_id, tool_call_id, user_id, sql_text, normalized_sql, row_count, duration_ms, safety_flags_json, created_at) VALUES (:id, :run_id, :tool_call_id, :user_id, :sql_text, :normalized_sql, :row_count, :duration_ms, :safety_flags_json, :created_at)',
                [
                    ':id' => $this->uuid4(),
                    ':run_id' => $runId,
                    ':tool_call_id' => $toolId,
                    ':user_id' => $userId,
                    ':sql_text' => $normalized,
                    ':normalized_sql' => $normalized,
                    ':row_count' => count($rows),
                    ':duration_ms' => $duration,
                    ':safety_flags_json' => $this->encodePayload(['allow_select' => true, 'single_statement' => true]),
                    ':created_at' => $this->database->nowUtc(),
                ]
            );
        } catch (\Throwable) {
        }

        try {
            $this->database->execute(
                'INSERT INTO agent_tool_calls (id, run_id, step_no, tool_name, tool_input_json, tool_result_json, status, duration_ms, created_at) VALUES (:id, :run_id, :step_no, :tool_name, :tool_input_json, :tool_result_json, :status, :duration_ms, :created_at)',
                [
                    ':id' => $toolId,
                    ':run_id' => $runId,
                    ':step_no' => 1,
                    ':tool_name' => 'execute_sql_query',
                    ':tool_input_json' => $this->encodePayload(['sql' => $normalized]),
                    ':tool_result_json' => $this->encodePayload(['rowCount' => count($rows), 'columns' => $columns]),
                    ':status' => 'completed',
                    ':duration_ms' => $duration,
                    ':created_at' => $this->database->nowUtc(),
                ]
            );
        } catch (\Throwable) {
        }

        return [
            'rows' => $rows,
            'columns' => $columns,
            'rowCount' => count($rows),
            'durationMs' => $duration,
            'error' => null,
        ];
    }

    private function httpJson(string $method, string $url, array $headers = [], ?array $jsonBody = null): array
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
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
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
