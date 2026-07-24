<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

/** Provider-neutral request/response conversion for agent model turns. */
final class AgentModelProtocol
{
    /**
     * @param array<int, array<string, mixed>> $messages
     * @param array<int, array<string, mixed>> $tools
     * @return array{endpoint:string,headers:array<string,string>,body:array<string,mixed>,operation:string}
     */
    public static function buildRequest(
        string $provider,
        array $config,
        string $systemPrompt,
        array $messages,
        array $tools,
        array $options = []
    ): array {
        $provider = strtolower(trim($provider));
        $maxTokens = max(64, min(65536, (int) ($options['maxTokens'] ?? $config['defaultOutputTokens'] ?? 4096)));
        $temperature = max(0.0, min(2.0, (float) ($options['temperature'] ?? 0.1)));

        if ($provider === 'google') {
            $body = [
                'systemInstruction' => ['parts' => [['text' => $systemPrompt]]],
                'contents' => self::googleMessages($messages),
                'generationConfig' => [
                    'temperature' => $temperature,
                    'maxOutputTokens' => $maxTokens,
                ],
            ];
            if ($tools !== []) {
                $body['tools'] = [[
                    'functionDeclarations' => array_map(static fn(array $tool): array => [
                        'name' => (string) $tool['name'],
                        'description' => (string) ($tool['description'] ?? ''),
                        'parameters' => self::googleSchema(is_array($tool['inputSchema'] ?? null) ? $tool['inputSchema'] : ['type' => 'object']),
                    ], $tools),
                ]];
            }
            return [
                'endpoint' => rtrim((string) $config['baseUrl'], '/') . '/v1beta/models/' . rawurlencode((string) $config['model']) . ':generateContent',
                'headers' => ['x-goog-api-key' => (string) $config['apiKey']],
                'body' => $body,
                'operation' => 'Google agent turn',
            ];
        }

        if ($provider === 'anthropic') {
            $body = [
                'model' => (string) $config['model'],
                'system' => $systemPrompt,
                'messages' => self::anthropicMessages($messages),
                'max_tokens' => $maxTokens,
                'temperature' => $temperature,
            ];
            if ($tools !== []) {
                $body['tools'] = array_map(static fn(array $tool): array => [
                    'name' => (string) $tool['name'],
                    'description' => (string) ($tool['description'] ?? ''),
                    'input_schema' => is_array($tool['inputSchema'] ?? null) ? $tool['inputSchema'] : ['type' => 'object'],
                ], $tools);
            }
            return [
                'endpoint' => rtrim((string) $config['baseUrl'], '/') . '/v1/messages',
                'headers' => [
                    'x-api-key' => (string) $config['apiKey'],
                    'anthropic-version' => (string) ($config['anthropicVersion'] ?? '2023-06-01'),
                ],
                'body' => $body,
                'operation' => 'Anthropic agent turn',
            ];
        }

        if (!in_array($provider, ['openai', 'openrouter', 'groq', 'deepseek'], true)) {
            throw new RuntimeException('Unsupported agent provider.');
        }

        $body = [
            'model' => (string) $config['model'],
            'messages' => array_merge(
                [['role' => 'system', 'content' => $systemPrompt]],
                self::openAiMessages($messages)
            ),
        ];
        if ($provider === 'openai') {
            $body['max_completion_tokens'] = $maxTokens;
        } else {
            $body['max_tokens'] = $maxTokens;
            $body['temperature'] = $temperature;
        }
        if ($tools !== []) {
            $body['tools'] = array_map(static fn(array $tool): array => [
                'type' => 'function',
                'function' => [
                    'name' => (string) $tool['name'],
                    'description' => (string) ($tool['description'] ?? ''),
                    'parameters' => is_array($tool['inputSchema'] ?? null) ? $tool['inputSchema'] : ['type' => 'object'],
                ],
            ], $tools);
            $body['tool_choice'] = 'auto';
        }

        return [
            'endpoint' => rtrim((string) $config['baseUrl'], '/') . '/chat/completions',
            'headers' => self::openAiHeaders($provider, $config),
            'body' => $body,
            'operation' => ucfirst($provider) . ' agent turn',
        ];
    }

    /**
     * @return array{text?:string,toolCalls:array<int,array{id:string,name:string,arguments:array<string,mixed>,thoughtSignature?:string}>,finishReason:string,usage?:array<string,int>,providerRequestId?:string}
     */
    public static function parseResponse(string $provider, array $json, array $headers = []): array
    {
        $provider = strtolower(trim($provider));
        if ($provider === 'google') {
            $candidate = $json['candidates'][0] ?? null;
            if (!is_array($candidate)) {
                $reason = trim((string) ($json['promptFeedback']['blockReason'] ?? ''));
                throw new RuntimeException($reason !== '' ? 'Model request was blocked: ' . $reason : 'Google returned no candidate.');
            }
            $text = [];
            $calls = [];
            $responseId = trim((string) ($json['responseId'] ?? self::header($headers, 'x-request-id')));
            if ($responseId === '') $responseId = bin2hex(random_bytes(12));
            foreach (($candidate['content']['parts'] ?? []) as $index => $part) {
                if (!is_array($part)) continue;
                if (isset($part['text'])) $text[] = (string) $part['text'];
                if (is_array($part['functionCall'] ?? null)) {
                    $call = $part['functionCall'];
                    $name = trim((string) ($call['name'] ?? ''));
                    $normalizedCall = [
                        'id' => trim((string) ($call['id'] ?? '')) ?: 'google-' . substr(hash('sha256', $responseId), 0, 16) . '-' . $index,
                        'name' => $name,
                        'arguments' => self::arguments($call['args'] ?? []),
                    ];
                    $thoughtSignature = trim((string) ($part['thoughtSignature'] ?? $call['thoughtSignature'] ?? ''));
                    if ($thoughtSignature !== '') $normalizedCall['thoughtSignature'] = $thoughtSignature;
                    $calls[] = $normalizedCall;
                }
            }
            return self::finishTurn(
                implode('', $text),
                $calls,
                (string) ($candidate['finishReason'] ?? 'unknown'),
                [
                    'inputTokens' => (int) ($json['usageMetadata']['promptTokenCount'] ?? 0),
                    'outputTokens' => (int) ($json['usageMetadata']['candidatesTokenCount'] ?? 0),
                ],
                $responseId
            );
        }

        if ($provider === 'anthropic') {
            $text = [];
            $calls = [];
            foreach (($json['content'] ?? []) as $part) {
                if (!is_array($part)) continue;
                if (($part['type'] ?? '') === 'text') $text[] = (string) ($part['text'] ?? '');
                if (($part['type'] ?? '') === 'tool_use') {
                    $calls[] = [
                        'id' => trim((string) ($part['id'] ?? '')),
                        'name' => trim((string) ($part['name'] ?? '')),
                        'arguments' => self::arguments($part['input'] ?? []),
                    ];
                }
            }
            return self::finishTurn(
                implode('', $text),
                $calls,
                (string) ($json['stop_reason'] ?? 'unknown'),
                [
                    'inputTokens' => (int) ($json['usage']['input_tokens'] ?? 0),
                    'outputTokens' => (int) ($json['usage']['output_tokens'] ?? 0),
                ],
                (string) ($json['id'] ?? self::header($headers, 'request-id'))
            );
        }

        $choice = $json['choices'][0] ?? null;
        if (!is_array($choice)) {
            throw new RuntimeException('The model returned no completion choice.');
        }
        $message = is_array($choice['message'] ?? null) ? $choice['message'] : [];
        $content = $message['content'] ?? '';
        if (is_array($content)) {
            $content = implode('', array_map(static fn($part): string => is_array($part) ? (string) ($part['text'] ?? '') : '', $content));
        }
        $calls = [];
        foreach (($message['tool_calls'] ?? []) as $call) {
            if (!is_array($call)) continue;
            $function = is_array($call['function'] ?? null) ? $call['function'] : [];
            $calls[] = [
                'id' => trim((string) ($call['id'] ?? '')),
                'name' => trim((string) ($function['name'] ?? '')),
                'arguments' => self::arguments($function['arguments'] ?? []),
            ];
        }
        return self::finishTurn(
            (string) $content,
            $calls,
            (string) ($choice['finish_reason'] ?? 'unknown'),
            [
                'inputTokens' => (int) ($json['usage']['prompt_tokens'] ?? 0),
                'outputTokens' => (int) ($json['usage']['completion_tokens'] ?? 0),
            ],
            (string) ($json['id'] ?? self::header($headers, 'x-request-id'))
        );
    }

    private static function arguments(mixed $value): array
    {
        if (is_array($value)) {
            if ($value !== [] && array_is_list($value)) throw new RuntimeException('Model tool arguments must be an object.');
            return $value;
        }
        if (!is_string($value) || trim($value) === '') return [];
        try {
            $decoded = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable $exception) {
            throw new RuntimeException('Malformed JSON in model tool arguments: ' . $exception->getMessage());
        }
        if (!is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) throw new RuntimeException('Model tool arguments must decode to an object.');
        return $decoded;
    }

    private static function finishTurn(string $text, array $calls, string $finishReason, array $usage, string $requestId): array
    {
        $seen = [];
        foreach ($calls as $call) {
            $id = trim((string) ($call['id'] ?? ''));
            $name = trim((string) ($call['name'] ?? ''));
            if ($id === '' || $name === '') throw new RuntimeException('Model returned a tool call without an id or name.');
            if (isset($seen[$id])) throw new RuntimeException('Model returned duplicate tool call ids.');
            $seen[$id] = true;
        }
        $trimmed = trim($text);
        if ($trimmed === '' && $calls === []) throw new RuntimeException('The selected LLM returned an empty response.');
        $turn = ['toolCalls' => array_values($calls), 'finishReason' => $finishReason];
        if ($trimmed !== '') $turn['text'] = $trimmed;
        if (($usage['inputTokens'] ?? 0) > 0 || ($usage['outputTokens'] ?? 0) > 0) $turn['usage'] = $usage;
        if (trim($requestId) !== '') $turn['providerRequestId'] = trim($requestId);
        return $turn;
    }

    private static function openAiMessages(array $messages): array
    {
        $result = [];
        foreach ($messages as $message) {
            if (!is_array($message)) continue;
            $role = (string) ($message['role'] ?? 'user');
            if ($role === 'tool') {
                $result[] = [
                    'role' => 'tool',
                    'tool_call_id' => (string) ($message['toolCallId'] ?? ''),
                    'content' => self::messageContent($message['content'] ?? ''),
                ];
                continue;
            }
            $entry = ['role' => $role === 'assistant' ? 'assistant' : 'user', 'content' => self::messageContent($message['content'] ?? '')];
            if ($entry['role'] === 'assistant' && is_array($message['toolCalls'] ?? null) && $message['toolCalls'] !== []) {
                $entry['tool_calls'] = array_map(static fn(array $call): array => [
                    'id' => (string) ($call['id'] ?? ''),
                    'type' => 'function',
                    'function' => [
                        'name' => (string) ($call['name'] ?? ''),
                        'arguments' => json_encode($call['arguments'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
                    ],
                ], $message['toolCalls']);
            }
            $result[] = $entry;
        }
        return $result;
    }

    private static function anthropicMessages(array $messages): array
    {
        $result = [];
        $pendingToolResults = [];
        $flush = static function () use (&$result, &$pendingToolResults): void {
            if ($pendingToolResults !== []) {
                $result[] = ['role' => 'user', 'content' => $pendingToolResults];
                $pendingToolResults = [];
            }
        };
        foreach ($messages as $message) {
            if (!is_array($message)) continue;
            $role = (string) ($message['role'] ?? 'user');
            if ($role === 'tool') {
                $pendingToolResults[] = [
                    'type' => 'tool_result',
                    'tool_use_id' => (string) ($message['toolCallId'] ?? ''),
                    'content' => self::messageContent($message['content'] ?? ''),
                ];
                continue;
            }
            $flush();
            if ($role === 'assistant') {
                $content = [];
                $text = self::messageContent($message['content'] ?? '');
                if ($text !== '') $content[] = ['type' => 'text', 'text' => $text];
                foreach (($message['toolCalls'] ?? []) as $call) {
                    if (!is_array($call)) continue;
                    $content[] = [
                        'type' => 'tool_use',
                        'id' => (string) ($call['id'] ?? ''),
                        'name' => (string) ($call['name'] ?? ''),
                        'input' => is_array($call['arguments'] ?? null) ? $call['arguments'] : [],
                    ];
                }
                if ($content !== []) $result[] = ['role' => 'assistant', 'content' => $content];
            } else {
                $content = self::messageContent($message['content'] ?? '');
                if ($content !== '') $result[] = ['role' => 'user', 'content' => $content];
            }
        }
        $flush();
        return $result;
    }

    private static function googleMessages(array $messages): array
    {
        $result = [];
        $pendingToolResponses = [];
        $flush = static function () use (&$result, &$pendingToolResponses): void {
            if ($pendingToolResponses !== []) {
                $result[] = ['role' => 'user', 'parts' => $pendingToolResponses];
                $pendingToolResponses = [];
            }
        };
        foreach ($messages as $message) {
            if (!is_array($message)) continue;
            $role = (string) ($message['role'] ?? 'user');
            if ($role === 'tool') {
                $decoded = json_decode(self::messageContent($message['content'] ?? ''), true);
                $pendingToolResponses[] = [
                    'functionResponse' => [
                        'id' => (string) ($message['toolCallId'] ?? ''),
                        'name' => (string) ($message['name'] ?? ''),
                        'response' => is_array($decoded) ? $decoded : ['result' => self::messageContent($message['content'] ?? '')],
                    ],
                ];
                continue;
            }
            $flush();
            $parts = [];
            $content = self::messageContent($message['content'] ?? '');
            if ($content !== '') $parts[] = ['text' => $content];
            if ($role === 'assistant') {
                foreach (($message['toolCalls'] ?? []) as $call) {
                    if (!is_array($call)) continue;
                    $functionCallPart = ['functionCall' => [
                        'id' => (string) ($call['id'] ?? ''),
                        'name' => (string) ($call['name'] ?? ''),
                        'args' => is_array($call['arguments'] ?? null) ? $call['arguments'] : [],
                    ]];
                    $thoughtSignature = trim((string) ($call['thoughtSignature'] ?? ''));
                    if ($thoughtSignature !== '') $functionCallPart['thoughtSignature'] = $thoughtSignature;
                    $parts[] = $functionCallPart;
                }
            }
            if ($parts !== []) $result[] = ['role' => $role === 'assistant' ? 'model' : 'user', 'parts' => $parts];
        }
        $flush();
        return $result;
    }

    private static function googleSchema(array $schema): array
    {
        // Gemini accepts its Schema/OpenAPI subset rather than arbitrary JSON
        // Schema. Keep server-side validation strict, but only send keywords
        // the Google API understands.
        $allowed = [
            'type', 'format', 'title', 'description', 'nullable', 'enum',
            'maxItems', 'minItems', 'properties', 'required', 'minProperties',
            'maxProperties', 'minLength', 'maxLength', 'pattern', 'example',
            'anyOf', 'propertyOrdering', 'default', 'items', 'minimum', 'maximum',
        ];
        $result = array_intersect_key($schema, array_fill_keys($allowed, true));
        if (isset($result['type'])) $result['type'] = strtoupper((string) $result['type']);
        if (is_array($result['properties'] ?? null)) {
            $properties = [];
            foreach ($result['properties'] as $name => $child) {
                if (is_array($child)) $properties[(string) $name] = self::googleSchema($child);
            }
            // PHP encodes an empty array as [], but Gemini requires the
            // `properties` field to be a JSON map when it is present.
            $result['properties'] = $properties === [] ? (object) [] : $properties;
        }
        if (is_array($result['items'] ?? null)) $result['items'] = self::googleSchema($result['items']);
        if (is_array($result['anyOf'] ?? null)) {
            $result['anyOf'] = array_values(array_map(
                static fn($child): array => self::googleSchema(is_array($child) ? $child : []),
                $result['anyOf']
            ));
        }
        if (($result['required'] ?? null) === []) unset($result['required']);
        return $result;
    }

    private static function openAiHeaders(string $provider, array $config): array
    {
        $headers = ['Authorization' => 'Bearer ' . (string) $config['apiKey']];
        if ($provider === 'openai') {
            if (trim((string) ($config['organization'] ?? '')) !== '') $headers['OpenAI-Organization'] = (string) $config['organization'];
            if (trim((string) ($config['project'] ?? '')) !== '') $headers['OpenAI-Project'] = (string) $config['project'];
        }
        if ($provider === 'openrouter') {
            if (trim((string) ($config['siteUrl'] ?? '')) !== '') $headers['HTTP-Referer'] = (string) $config['siteUrl'];
            if (trim((string) ($config['appName'] ?? '')) !== '') $headers['X-Title'] = (string) $config['appName'];
        }
        return $headers;
    }

    private static function messageContent(mixed $content): string
    {
        if (is_string($content)) return $content;
        return json_encode($content, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
    }

    private static function header(array $headers, string $name): string
    {
        foreach ($headers as $key => $value) {
            if (strtolower((string) $key) === strtolower($name)) return trim((string) $value);
        }
        return '';
    }
}
