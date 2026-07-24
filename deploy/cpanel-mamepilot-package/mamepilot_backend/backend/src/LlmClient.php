<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class LlmClient
{
    private const PROVIDERS = ['google', 'openai', 'openrouter', 'groq', 'anthropic', 'deepseek'];
    private const FEATURES = [
        'information_extraction',
        'mame_ai',
        'mame_ai_fast',
        'mame_ai_reasoning',
        'mame_ai_multimodal',
        'business_growth',
    ];

    public function __construct(
        private Database $database,
        private Config $config,
    ) {
    }

    public static function providers(): array
    {
        return self::PROVIDERS;
    }

    public static function features(): array
    {
        return self::FEATURES;
    }

    public static function defaultBaseUrl(string $provider): string
    {
        return match ($provider) {
            'google' => 'https://generativelanguage.googleapis.com',
            'openai' => 'https://api.openai.com/v1',
            'openrouter' => 'https://openrouter.ai/api/v1',
            'groq' => 'https://api.groq.com/openai/v1',
            'anthropic' => 'https://api.anthropic.com',
            'deepseek' => 'https://api.deepseek.com',
            default => '',
        };
    }

    public function configurationForFeature(string $feature): array
    {
        if (!in_array($feature, self::FEATURES, true)) {
            throw new RuntimeException('Unknown LLM feature assignment.');
        }
        if (!$this->tableExists('llm_configurations') || !$this->tableExists('llm_feature_assignments')) {
            throw new RuntimeException('LLM settings are not installed. Run the latest database update first.');
        }

        $row = $this->database->fetchOne(
            'SELECT c.*
             FROM llm_feature_assignments a
             INNER JOIN llm_configurations c ON c.id = a.configuration_id
             WHERE a.feature_key = :feature AND c.enabled = 1
             LIMIT 1',
            [':feature' => $feature]
        );
        if ($row === null && in_array($feature, ['mame_ai_fast', 'mame_ai_reasoning', 'mame_ai_multimodal'], true)) {
            $row = $this->database->fetchOne(
                'SELECT c.*
                 FROM llm_feature_assignments a
                 INNER JOIN llm_configurations c ON c.id = a.configuration_id
                 WHERE a.feature_key = :feature AND c.enabled = 1
                 LIMIT 1',
                [':feature' => 'mame_ai']
            );
        }
        if ($row === null) {
            throw new RuntimeException('No enabled LLM model is assigned to ' . $this->featureLabel($feature) . '. Configure it in Developer Settings > LLMs.');
        }

        return $this->mapConfiguration($row);
    }

    public function generateForFeature(
        string $feature,
        string $systemPrompt,
        string $userMessage,
        array $history = [],
        array $options = []
    ): string {
        return $this->generate($this->configurationForFeature($feature), $systemPrompt, $userMessage, $history, $options);
    }

    public function generate(
        array $configuration,
        string $systemPrompt,
        string $userMessage,
        array $history = [],
        array $options = []
    ): string {
        $config = $this->normalizeConfiguration($configuration);
        if ($config['apiKey'] === '') {
            throw new RuntimeException('The selected LLM configuration does not have an API key.');
        }
        if ($config['model'] === '') {
            throw new RuntimeException('The selected LLM configuration does not have a model.');
        }

        return match ($config['provider']) {
            'google' => $this->generateGoogle($config, $systemPrompt, $userMessage, $history, $options),
            'anthropic' => $this->generateAnthropic($config, $systemPrompt, $userMessage, $history, $options),
            'openai', 'openrouter', 'groq', 'deepseek' => $this->generateOpenAiCompatible($config, $systemPrompt, $userMessage, $history, $options),
            default => throw new RuntimeException('Unsupported LLM provider.'),
        };
    }

    /**
     * @param array<int, array<string, mixed>> $messages
     * @param array<int, array<string, mixed>> $tools
     * @return array<string, mixed>
     */
    public function agentTurnForFeature(
        string $feature,
        string $systemPrompt,
        array $messages,
        array $tools = [],
        array $options = []
    ): array {
        $configuration = $this->configurationForFeature($feature);
        if ($feature === 'mame_ai_reasoning' && empty($configuration['supportsToolCalling'])) {
            throw new RuntimeException('The assigned Mame AI reasoning profile does not support tool calling.');
        }
        return $this->agentTurn($configuration, $systemPrompt, $messages, $tools, $options);
    }

    /**
     * @param array<int, array<string, mixed>> $messages
     * @param array<int, array<string, mixed>> $tools
     * @return array<string, mixed>
     */
    public function agentTurn(
        array $configuration,
        string $systemPrompt,
        array $messages,
        array $tools = [],
        array $options = []
    ): array {
        $config = $this->normalizeConfiguration($configuration);
        if ($config['apiKey'] === '' || $config['model'] === '') {
            throw new RuntimeException('The selected LLM profile is missing its API key or model.');
        }
        if ($tools !== [] && empty($config['supportsToolCalling'])) {
            throw new RuntimeException('The selected LLM profile is not marked as supporting tool calls.');
        }

        $request = AgentModelProtocol::buildRequest(
            $config['provider'],
            $config,
            $systemPrompt,
            $messages,
            $tools,
            $options
        );
        $startedAt = microtime(true);
        $response = $this->httpJson('POST', $request['endpoint'], $request['headers'], $request['body']);
        $durationMs = (int) round((microtime(true) - $startedAt) * 1000);
        $this->assertSuccess($response, (string) $request['operation']);
        $turn = AgentModelProtocol::parseResponse($config['provider'], $response['json'] ?? [], $response['headers'] ?? []);
        $turn['durationMs'] = $durationMs;
        $turn['profileId'] = $config['id'];
        $turn['profileLabel'] = $config['label'];
        $turn['provider'] = $config['provider'];
        $turn['model'] = $config['model'];
        return $turn;
    }

    /**
     * Generate using optional image/audio inputs. Text-only providers keep the
     * same API contract and simply receive a compact media description.
     * @param array<int, array{type:string,url?:string,mimeType?:string,base64?:string}> $media
     */
    public function generateMultimodal(
        array $configuration,
        string $systemPrompt,
        string $userMessage,
        array $history = [],
        array $media = [],
        array $options = []
    ): string {
        $config = $this->normalizeConfiguration($configuration);
        if ($media === []) {
            return $this->generate($config, $systemPrompt, $userMessage, $history, $options);
        }

        return match ($config['provider']) {
            'google' => $this->generateGoogleMultimodal($config, $systemPrompt, $userMessage, $history, $media, $options),
            'anthropic' => $this->generateAnthropicMultimodal($config, $systemPrompt, $userMessage, $history, $media, $options),
            'openai', 'openrouter', 'groq', 'deepseek' => $this->generateOpenAiCompatibleMultimodal($config, $systemPrompt, $userMessage, $history, $media, $options),
            default => $this->generate($config, $systemPrompt, $userMessage, $history, $options),
        };
    }

    public function discoverModels(array $configuration): array
    {
        $config = $this->normalizeConfiguration($configuration);
        if ($config['apiKey'] === '') {
            throw new RuntimeException('Enter an API key before loading models.');
        }

        if ($config['provider'] === 'google') {
            $endpoint = rtrim($config['baseUrl'], '/') . '/v1beta/models?pageSize=1000';
            $response = $this->httpJson('GET', $endpoint, ['x-goog-api-key' => $config['apiKey']]);
            $this->assertSuccess($response, 'Google model lookup');
            $models = [];
            foreach (($response['json']['models'] ?? []) as $model) {
                if (!is_array($model)) continue;
                $methods = is_array($model['supportedGenerationMethods'] ?? null) ? $model['supportedGenerationMethods'] : [];
                if ($methods !== [] && !in_array('generateContent', $methods, true)) continue;
                $id = preg_replace('#^models/#', '', trim((string) ($model['name'] ?? '')));
                if ($id !== '') $models[] = $id;
            }
            return $this->uniqueSorted($models);
        }

        if ($config['provider'] === 'anthropic') {
            $endpoint = rtrim($config['baseUrl'], '/') . '/v1/models?limit=1000';
            $response = $this->httpJson('GET', $endpoint, [
                'x-api-key' => $config['apiKey'],
                'anthropic-version' => $config['anthropicVersion'],
            ]);
            $this->assertSuccess($response, 'Anthropic model lookup');
            return $this->modelIds($response['json']['data'] ?? []);
        }

        $endpoint = rtrim($config['baseUrl'], '/') . '/models';
        $response = $this->httpJson('GET', $endpoint, $this->openAiHeaders($config));
        $this->assertSuccess($response, ucfirst($config['provider']) . ' model lookup');
        return $this->modelIds($response['json']['data'] ?? []);
    }

    public function mapConfiguration(array $row): array
    {
        return $this->normalizeConfiguration([
            'id' => (string) ($row['id'] ?? ''),
            'label' => (string) ($row['label'] ?? ''),
            'provider' => (string) ($row['provider'] ?? ''),
            'enabled' => !empty($row['enabled'] ?? false),
            'baseUrl' => (string) ($row['base_url'] ?? ''),
            'apiKey' => (string) ($row['api_key'] ?? ''),
            'model' => (string) ($row['model'] ?? ''),
            'organization' => (string) ($row['organization'] ?? ''),
            'project' => (string) ($row['project'] ?? ''),
            'siteUrl' => (string) ($row['site_url'] ?? ''),
            'appName' => (string) ($row['app_name'] ?? ''),
            'anthropicVersion' => (string) ($row['anthropic_version'] ?? ''),
            'supportsToolCalling' => !empty($row['supports_tool_calling']),
            'supportsStructuredOutput' => !empty($row['supports_structured_output']),
            'supportsVision' => !empty($row['supports_vision']),
            'supportsAudio' => !empty($row['supports_audio']),
            'contextWindowTokens' => (int) ($row['context_window_tokens'] ?? 32768),
            'defaultOutputTokens' => (int) ($row['default_output_tokens'] ?? 4096),
        ]);
    }

    public function mapMultimodalConfiguration(array $row): array
    {
        $config = $this->mapConfiguration($row);
        $config['systemPrompt'] = (string) ($row['system_prompt'] ?? '');
        $config['temperature'] = (float) ($row['temperature'] ?? 0.1);
        $config['maxTokens'] = max(64, min(16384, (int) ($row['max_tokens'] ?? 4096)));
        $config['supportsVision'] = !empty($row['supports_vision']);
        $config['supportsAudio'] = !empty($row['supports_audio']);
        return $config;
    }

    public function normalizeConfiguration(array $config): array
    {
        $provider = strtolower(trim((string) ($config['provider'] ?? '')));
        if (!in_array($provider, self::PROVIDERS, true)) {
            throw new RuntimeException('Choose a supported LLM provider.');
        }

        $baseUrl = rtrim(trim((string) ($config['baseUrl'] ?? $config['base_url'] ?? '')), '/');
        if ($baseUrl === '') $baseUrl = self::defaultBaseUrl($provider);
        if (!preg_match('#^https://#i', $baseUrl) && !preg_match('#^http://(?:localhost|127\.0\.0\.1)(?::\d+)?(?:/|$)#i', $baseUrl)) {
            throw new RuntimeException('LLM base URLs must use HTTPS (localhost HTTP is allowed for development).');
        }

        return [
            'id' => trim((string) ($config['id'] ?? '')),
            'label' => trim((string) ($config['label'] ?? '')),
            'provider' => $provider,
            'enabled' => !array_key_exists('enabled', $config) || !empty($config['enabled']),
            'baseUrl' => $baseUrl,
            'apiKey' => trim((string) ($config['apiKey'] ?? $config['api_key'] ?? '')),
            'model' => trim((string) ($config['model'] ?? '')),
            'organization' => trim((string) ($config['organization'] ?? '')),
            'project' => trim((string) ($config['project'] ?? '')),
            'siteUrl' => trim((string) ($config['siteUrl'] ?? $config['site_url'] ?? '')),
            'appName' => trim((string) ($config['appName'] ?? $config['app_name'] ?? '')),
            'anthropicVersion' => trim((string) ($config['anthropicVersion'] ?? $config['anthropic_version'] ?? '')) ?: '2023-06-01',
            'supportsToolCalling' => !empty($config['supportsToolCalling'] ?? $config['supports_tool_calling'] ?? false),
            'supportsStructuredOutput' => !empty($config['supportsStructuredOutput'] ?? $config['supports_structured_output'] ?? false),
            'supportsVision' => !empty($config['supportsVision'] ?? $config['supports_vision'] ?? false),
            'supportsAudio' => !empty($config['supportsAudio'] ?? $config['supports_audio'] ?? false),
            'contextWindowTokens' => max(1024, min(2000000, (int) ($config['contextWindowTokens'] ?? $config['context_window_tokens'] ?? 32768))),
            'defaultOutputTokens' => max(64, min(65536, (int) ($config['defaultOutputTokens'] ?? $config['default_output_tokens'] ?? 4096))),
        ];
    }

    private function generateOpenAiCompatible(array $config, string $systemPrompt, string $userMessage, array $history, array $options): string
    {
        $messages = [['role' => 'system', 'content' => $systemPrompt]];
        foreach ($history as $item) {
            if (!is_array($item)) continue;
            $role = ($item['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
            $content = trim((string) ($item['content'] ?? ''));
            if ($content !== '') $messages[] = ['role' => $role, 'content' => $content];
        }
        if (trim($userMessage) !== '') $messages[] = ['role' => 'user', 'content' => $userMessage];

        $body = ['model' => $config['model'], 'messages' => $messages];
        $maxTokens = max(64, min(16384, (int) ($options['maxTokens'] ?? 4096)));
        if ($config['provider'] === 'openai') {
            $body['max_completion_tokens'] = $maxTokens;
        } else {
            $body['max_tokens'] = $maxTokens;
            $body['temperature'] = (float) ($options['temperature'] ?? 0.1);
        }

        $response = $this->httpJson(
            'POST',
            rtrim($config['baseUrl'], '/') . '/chat/completions',
            $this->openAiHeaders($config),
            $body
        );
        $this->assertSuccess($response, ucfirst($config['provider']) . ' generation');
        $content = $response['json']['choices'][0]['message']['content'] ?? '';
        if (is_array($content)) {
            $content = implode('', array_map(static fn($part): string => is_array($part) ? (string) ($part['text'] ?? '') : '', $content));
        }
        $text = trim((string) $content);
        if ($text === '') throw new RuntimeException('The selected LLM returned an empty response.');
        return $text;
    }

    private function generateOpenAiCompatibleMultimodal(array $config, string $systemPrompt, string $userMessage, array $history, array $media, array $options): string
    {
        $messages = [['role' => 'system', 'content' => $systemPrompt]];
        foreach ($history as $item) {
            if (!is_array($item)) continue;
            $role = ($item['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
            $content = trim((string) ($item['content'] ?? ''));
            if ($content !== '') $messages[] = ['role' => $role, 'content' => $content];
        }
        $content = [['type' => 'text', 'text' => $userMessage]];
        foreach ($media as $item) {
            $type = strtolower(trim((string) ($item['type'] ?? '')));
            $url = trim((string) ($item['url'] ?? ''));
            $base64 = trim((string) ($item['base64'] ?? ''));
            $mime = trim((string) ($item['mimeType'] ?? 'application/octet-stream'));
            if ($type === 'image' && ($url !== '' || $base64 !== '')) {
                $content[] = ['type' => 'image_url', 'image_url' => ['url' => $base64 !== '' ? 'data:' . $mime . ';base64,' . $base64 : $url]];
            } elseif ($type === 'audio' && $base64 !== '') {
                $content[] = ['type' => 'input_audio', 'input_audio' => ['data' => $base64, 'format' => preg_replace('/^audio\//', '', $mime) ?: 'wav']];
            } elseif ($url !== '') {
                $content[] = ['type' => 'text', 'text' => 'Media attachment (' . $type . '): ' . $url];
            }
        }
        $messages[] = ['role' => 'user', 'content' => $content];
        $body = ['model' => $config['model'], 'messages' => $messages];
        $maxTokens = max(64, min(16384, (int) ($options['maxTokens'] ?? 4096)));
        if ($config['provider'] === 'openai') $body['max_completion_tokens'] = $maxTokens;
        else { $body['max_tokens'] = $maxTokens; $body['temperature'] = (float) ($options['temperature'] ?? 0.1); }
        $response = $this->httpJson('POST', rtrim($config['baseUrl'], '/') . '/chat/completions', $this->openAiHeaders($config), $body);
        $this->assertSuccess($response, ucfirst($config['provider']) . ' multimodal generation');
        $content = $response['json']['choices'][0]['message']['content'] ?? '';
        if (is_array($content)) $content = implode('', array_map(static fn($part): string => is_array($part) ? (string) ($part['text'] ?? '') : '', $content));
        $text = trim((string) $content);
        if ($text === '') throw new RuntimeException('The selected LLM returned an empty response.');
        return $text;
    }

    private function generateAnthropicMultimodal(array $config, string $systemPrompt, string $userMessage, array $history, array $media, array $options): string
    {
        $messages = [];
        foreach ($history as $item) {
            if (!is_array($item)) continue;
            $role = ($item['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
            $content = trim((string) ($item['content'] ?? ''));
            if ($content !== '') $messages[] = ['role' => $role, 'content' => $content];
        }
        $content = [['type' => 'text', 'text' => $userMessage]];
        foreach ($media as $item) {
            $type = strtolower(trim((string) ($item['type'] ?? '')));
            $url = trim((string) ($item['url'] ?? ''));
            $base64 = trim((string) ($item['base64'] ?? ''));
            $mime = trim((string) ($item['mimeType'] ?? 'application/octet-stream'));
            if ($type === 'image' && $base64 !== '') $content[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $mime, 'data' => $base64]];
            elseif ($url !== '') $content[] = ['type' => 'text', 'text' => 'Media attachment (' . $type . '): ' . $url];
        }
        $messages[] = ['role' => 'user', 'content' => $content];
        $response = $this->httpJson('POST', rtrim($config['baseUrl'], '/') . '/v1/messages', ['x-api-key' => $config['apiKey'], 'anthropic-version' => $config['anthropicVersion']], [
            'model' => $config['model'], 'system' => $systemPrompt, 'messages' => $messages,
            'max_tokens' => max(64, min(16384, (int) ($options['maxTokens'] ?? 4096))), 'temperature' => (float) ($options['temperature'] ?? 0.1),
        ]);
        $this->assertSuccess($response, 'Anthropic multimodal generation');
        $parts = [];
        foreach (($response['json']['content'] ?? []) as $part) if (is_array($part) && ($part['type'] ?? '') === 'text') $parts[] = (string) ($part['text'] ?? '');
        $text = trim(implode('', $parts));
        if ($text === '') throw new RuntimeException('The selected LLM returned an empty response.');
        return $text;
    }

    private function generateGoogleMultimodal(array $config, string $systemPrompt, string $userMessage, array $history, array $media, array $options): string
    {
        $contents = [];
        foreach ($history as $item) {
            if (!is_array($item)) continue;
            $content = trim((string) ($item['content'] ?? ''));
            if ($content !== '') $contents[] = ['role' => ($item['role'] ?? '') === 'assistant' ? 'model' : 'user', 'parts' => [['text' => $content]]];
        }
        $parts = [['text' => $userMessage]];
        foreach ($media as $item) {
            $base64 = trim((string) ($item['base64'] ?? ''));
            $mime = trim((string) ($item['mimeType'] ?? 'application/octet-stream'));
            $url = trim((string) ($item['url'] ?? ''));
            if ($base64 !== '') $parts[] = ['inline_data' => ['mime_type' => $mime, 'data' => $base64]];
            elseif ($url !== '') $parts[] = ['text' => 'Media attachment (' . ($item['type'] ?? 'file') . '): ' . $url];
        }
        $contents[] = ['role' => 'user', 'parts' => $parts];
        $endpoint = rtrim($config['baseUrl'], '/') . '/v1beta/models/' . rawurlencode($config['model']) . ':generateContent';
        $response = $this->httpJson('POST', $endpoint, ['x-goog-api-key' => $config['apiKey']], ['systemInstruction' => ['parts' => [['text' => $systemPrompt]]], 'contents' => $contents, 'generationConfig' => ['temperature' => (float) ($options['temperature'] ?? 0.1), 'maxOutputTokens' => max(64, min(16384, (int) ($options['maxTokens'] ?? 4096)))] ]);
        $this->assertSuccess($response, 'Google multimodal generation');
        $parts = $response['json']['candidates'][0]['content']['parts'] ?? [];
        $text = trim(implode('', array_map(static fn($part): string => is_array($part) ? (string) ($part['text'] ?? '') : '', $parts)));
        if ($text === '') throw new RuntimeException('The selected LLM returned an empty response.');
        return $text;
    }

    private function generateAnthropic(array $config, string $systemPrompt, string $userMessage, array $history, array $options): string
    {
        $messages = [];
        foreach ($history as $item) {
            if (!is_array($item)) continue;
            $role = ($item['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
            $content = trim((string) ($item['content'] ?? ''));
            if ($content !== '') $messages[] = ['role' => $role, 'content' => $content];
        }
        if (trim($userMessage) !== '') $messages[] = ['role' => 'user', 'content' => $userMessage];

        $response = $this->httpJson('POST', rtrim($config['baseUrl'], '/') . '/v1/messages', [
            'x-api-key' => $config['apiKey'],
            'anthropic-version' => $config['anthropicVersion'],
        ], [
            'model' => $config['model'],
            'system' => $systemPrompt,
            'messages' => $messages,
            'max_tokens' => max(64, min(16384, (int) ($options['maxTokens'] ?? 4096))),
            'temperature' => (float) ($options['temperature'] ?? 0.1),
        ]);
        $this->assertSuccess($response, 'Anthropic generation');
        $parts = [];
        foreach (($response['json']['content'] ?? []) as $part) {
            if (is_array($part) && ($part['type'] ?? '') === 'text') $parts[] = (string) ($part['text'] ?? '');
        }
        $text = trim(implode('', $parts));
        if ($text === '') throw new RuntimeException('The selected LLM returned an empty response.');
        return $text;
    }

    private function generateGoogle(array $config, string $systemPrompt, string $userMessage, array $history, array $options): string
    {
        $contents = [];
        foreach ($history as $item) {
            if (!is_array($item)) continue;
            $content = trim((string) ($item['content'] ?? ''));
            if ($content === '') continue;
            $contents[] = [
                'role' => ($item['role'] ?? '') === 'assistant' ? 'model' : 'user',
                'parts' => [['text' => $content]],
            ];
        }
        if (trim($userMessage) !== '') $contents[] = ['role' => 'user', 'parts' => [['text' => $userMessage]]];

        $endpoint = rtrim($config['baseUrl'], '/') . '/v1beta/models/' . rawurlencode($config['model']) . ':generateContent';
        $response = $this->httpJson('POST', $endpoint, ['x-goog-api-key' => $config['apiKey']], [
            'systemInstruction' => ['parts' => [['text' => $systemPrompt]]],
            'contents' => $contents,
            'generationConfig' => [
                'temperature' => (float) ($options['temperature'] ?? 0.1),
                'maxOutputTokens' => max(64, min(16384, (int) ($options['maxTokens'] ?? 4096))),
            ],
        ]);
        $this->assertSuccess($response, 'Google generation');
        $parts = $response['json']['candidates'][0]['content']['parts'] ?? [];
        $text = trim(implode('', array_map(static fn($part): string => is_array($part) ? (string) ($part['text'] ?? '') : '', $parts)));
        if ($text === '') throw new RuntimeException('The selected LLM returned an empty response.');
        return $text;
    }

    private function openAiHeaders(array $config): array
    {
        $headers = ['Authorization' => 'Bearer ' . $config['apiKey']];
        if ($config['provider'] === 'openai') {
            if ($config['organization'] !== '') $headers['OpenAI-Organization'] = $config['organization'];
            if ($config['project'] !== '') $headers['OpenAI-Project'] = $config['project'];
        }
        if ($config['provider'] === 'openrouter') {
            if ($config['siteUrl'] !== '') $headers['HTTP-Referer'] = $config['siteUrl'];
            if ($config['appName'] !== '') $headers['X-Title'] = $config['appName'];
        }
        return $headers;
    }

    private function assertSuccess(array $response, string $operation): void
    {
        $status = (int) ($response['status'] ?? 0);
        if ($status >= 200 && $status < 300) return;
        $message = $response['json']['error']['message'] ?? $response['json']['error'] ?? $response['body'] ?? 'Unknown provider error.';
        if (is_array($message)) $message = json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        throw new RuntimeException($operation . ' failed (HTTP ' . $status . '): ' . mb_substr(trim((string) $message), 0, 500));
    }

    private function modelIds($rows): array
    {
        if (!is_array($rows)) return [];
        $ids = [];
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            $id = trim((string) ($row['id'] ?? $row['name'] ?? ''));
            if ($id !== '') $ids[] = $id;
        }
        return $this->uniqueSorted($ids);
    }

    private function uniqueSorted(array $values): array
    {
        $values = array_values(array_unique(array_filter(array_map('strval', $values), static fn(string $value): bool => $value !== '')));
        natcasesort($values);
        return array_values($values);
    }

    private function featureLabel(string $feature): string
    {
        return match ($feature) {
            'information_extraction' => 'Information extraction',
            'mame_ai' => 'Mame AI',
            'mame_ai_fast' => 'Mame AI fast routing',
            'mame_ai_reasoning' => 'Mame AI reasoning',
            'mame_ai_multimodal' => 'Mame AI multimodal',
            'business_growth' => 'Grow Your Business',
            default => $feature,
        };
    }

    private function tableExists(string $table): bool
    {
        $row = $this->database->fetchOne(
            'SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
            [':table' => $table]
        );
        return (int) ($row['count'] ?? 0) > 0;
    }

    private function httpJson(string $method, string $url, array $headers, ?array $jsonBody = null): array
    {
        if (!function_exists('curl_init')) throw new RuntimeException('The PHP cURL extension is required for LLM connections.');
        $handle = curl_init($url);
        if ($handle === false) throw new RuntimeException('Could not initialize the LLM request.');

        $headerList = ['Accept: application/json'];
        foreach ($headers as $name => $value) $headerList[] = $name . ': ' . $value;
        $body = $jsonBody === null ? null : json_encode($jsonBody, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if ($body !== null) $headerList[] = 'Content-Type: application/json';

        $responseHeaders = [];
        curl_setopt_array($handle, [
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headerList,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 90,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$responseHeaders): int {
                $length = strlen($line);
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $responseHeaders[trim($parts[0])] = trim($parts[1]);
                }
                return $length;
            },
        ]);
        if ($body !== null) curl_setopt($handle, CURLOPT_POSTFIELDS, $body);

        $responseBody = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $error = curl_error($handle);
        curl_close($handle);
        if ($responseBody === false) throw new RuntimeException('LLM request failed: ' . $error);
        $json = json_decode($responseBody, true);
        return ['status' => $status, 'body' => $responseBody, 'json' => is_array($json) ? $json : [], 'headers' => $responseHeaders];
    }
}
