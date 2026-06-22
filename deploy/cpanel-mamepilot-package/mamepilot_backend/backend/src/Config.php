<?php

declare(strict_types=1);

namespace App;

final class Config
{
    /** @var array<string, string> */
    private array $values;

    public function __construct(array $values)
    {
        $this->values = $values;
    }

    public static function load(string $projectRoot): self
    {
        $candidateFiles = [
            $projectRoot . DIRECTORY_SEPARATOR . '.env',
            $projectRoot . DIRECTORY_SEPARATOR . '.env.local',
            $projectRoot . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . '.env',
            $projectRoot . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . '.env.local',
        ];

        $values = [];

        foreach ($candidateFiles as $file) {
            if (!is_file($file)) {
                continue;
            }

            foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                $trimmed = trim($line);
                if ($trimmed === '' || str_starts_with($trimmed, '#')) {
                    continue;
                }

                $separator = strpos($trimmed, '=');
                if ($separator === false) {
                    continue;
                }

                $key = trim(substr($trimmed, 0, $separator));
                $value = trim(substr($trimmed, $separator + 1));
                $values[$key] = trim($value, "\"'");
            }
        }

        foreach ($_ENV as $key => $value) {
            if (is_string($value)) {
                $values[$key] = $value;
            }
        }

        foreach ($_SERVER as $key => $value) {
            if (is_string($value) && !isset($values[$key])) {
                $values[$key] = $value;
            }
        }

        return new self($values);
    }

    public function get(string $key, ?string $default = null): ?string
    {
        return $this->values[$key] ?? $default;
    }

    public function require(string $key): string
    {
        $value = $this->get($key);
        if ($value === null || $value === '') {
            throw new \RuntimeException("Missing required config value: {$key}");
        }

        return $value;
    }

    public function timezone(): string
    {
        return $this->get('APP_TIMEZONE', 'Asia/Dhaka') ?? 'Asia/Dhaka';
    }
}
