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
        $this->dispatchBackgroundWorker($runId);

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

        $settings = $this->loadAgentSettings();
        $conversationId = (string) ($run['conversation_id'] ?? '');
        $message = $this->fetchLatestUserMessage($runId);
        $now = $this->database->nowUtc();

        if (empty($settings['enabled'] ?? false)) {
            $answer = 'Mame AI is currently disabled in agent settings.';
            $this->appendEvent($runId, 'completed', ['answer' => $answer], $this->nextSequenceNumber($runId));
            $this->markRunCompleted($runId, $answer, $now);
            return $this->buildRunSnapshot($runId, $conversationId, (string) ($run['stream_token'] ?? ''), 'completed', $answer, []);
        }

        try {
            $plan = $this->buildExecutionPlan($settings, $message);
            $this->appendEvent($runId, 'lane_selected', [
                'lane' => $plan['lane'],
                'provider' => $plan['provider'],
                'model' => $plan['model'],
            ], $this->nextSequenceNumber($runId));
            $analysisMode = $this->detectAnalysisMode($message);
            $reasoningPlan = $this->buildReasoningPlan($settings, $message);
            $this->appendEvent($runId, 'reasoning_plan', [
                'mode' => $reasoningPlan['mode'],
                'steps' => $reasoningPlan['steps'],
                'followUpSuggestions' => $reasoningPlan['followUpSuggestions'] ?? [],
            ], $this->nextSequenceNumber($runId));
            $this->appendEvent($runId, 'thought', ['summary' => $analysisMode === 'finance' ? 'Analyzing financial performance and trend drivers.' : 'Reviewing business operations, inventory, and recent activity.'], $this->nextSequenceNumber($runId));

            if ($analysisMode === 'finance') {
                $this->appendEvent($runId, 'step_started', ['stepId' => 'inspect_metrics', 'name' => 'Inspect recent income and expense metrics'], $this->nextSequenceNumber($runId));
                $toolSnapshot = $this->runProfitAnalysisTool($runId, $conversationId, $settings);
                $this->appendEvent($runId, 'tool_result', ['summary' => $toolSnapshot['summary'], 'toolName' => 'profit_analysis', 'details' => $toolSnapshot['details'] ?? []], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'step_completed', ['stepId' => 'inspect_metrics', 'name' => 'Inspect recent income and expense metrics'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'step_started', ['stepId' => 'compare_periods', 'name' => 'Compare current and prior periods'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'critic', ['summary' => 'Checking whether the conclusion is consistent with the recent trend and business context.'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'step_completed', ['stepId' => 'compare_periods', 'name' => 'Compare current and prior periods'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'step_started', ['stepId' => 'explain_cause', 'name' => 'Explain likely causes of the trend'], $this->nextSequenceNumber($runId));
                $answer = $this->composeFinanceAnswer($message, $toolSnapshot['analysis']);
                $this->appendEvent($runId, 'synthesis', ['summary' => 'Synthesizing the findings into a concise explanation.'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'step_completed', ['stepId' => 'explain_cause', 'name' => 'Explain likely causes of the trend'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'follow_up_suggestions', ['suggestions' => $reasoningPlan['followUpSuggestions'] ?? []], $this->nextSequenceNumber($runId));
            } else {
                $this->appendEvent($runId, 'step_started', ['stepId' => 'inspect_context', 'name' => 'Inspect the current business context'], $this->nextSequenceNumber($runId));
                $toolSnapshot = $this->runBusinessSnapshotTool($runId, $conversationId, $settings);
                $this->appendEvent($runId, 'tool_result', ['summary' => $toolSnapshot['summary'], 'toolName' => 'business_snapshot', 'details' => ['lowStockProducts' => $toolSnapshot['lowStockProducts'], 'topSellingProducts' => $toolSnapshot['topSellingProducts']]], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'step_completed', ['stepId' => 'inspect_context', 'name' => 'Inspect the current business context'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'step_started', ['stepId' => 'evaluate_findings', 'name' => 'Evaluate the findings and relevance to your question'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'critic', ['summary' => 'Checking whether the insights match your question and business context.'], $this->nextSequenceNumber($runId));
                $answer = $this->composeAnswer($message, $toolSnapshot, $plan, $analysisMode);
                $this->appendEvent($runId, 'synthesis', ['summary' => 'Synthesizing the business context into a focused response.'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'step_completed', ['stepId' => 'evaluate_findings', 'name' => 'Evaluate the findings and relevance to your question'], $this->nextSequenceNumber($runId));
                $this->appendEvent($runId, 'follow_up_suggestions', ['suggestions' => $reasoningPlan['followUpSuggestions'] ?? []], $this->nextSequenceNumber($runId));
            }

            $this->appendEvent($runId, 'completed', ['answer' => $answer], $this->nextSequenceNumber($runId));
            $this->markRunCompleted($runId, $answer, $now);

            return $this->buildRunSnapshot($runId, $conversationId, (string) ($run['stream_token'] ?? ''), 'completed', $answer, []);
        } catch (	hrowable $ex) {
            $errorAnswer = 'I could not complete the analysis. Please try again.';
            $this->appendEvent($runId, 'failed', ['error' => $ex->getMessage(), 'answer' => $errorAnswer], $this->nextSequenceNumber($runId));
            $this->appendEvent($runId, 'completed', ['answer' => $errorAnswer], $this->nextSequenceNumber($runId));
            $this->markRunFailed($runId, $errorAnswer, $now, $ex->getMessage());
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
            'mainModel' => (string) ($row['anthropic_model'] ?? $row['openai_model'] ?? $row['google_model'] ?? $row['groq_model'] ?? ''),
            'groq' => ['model' => (string) ($row['groq_model'] ?? '')],
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
}
