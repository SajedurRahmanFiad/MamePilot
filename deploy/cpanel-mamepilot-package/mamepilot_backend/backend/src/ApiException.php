<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class ApiException extends RuntimeException
{
    private int $httpStatus;
    private string $errorCode;
    /**
     * @var array<string, mixed>
     */
    private array $extra;

    /**
     * @param array<string, mixed> $extra
     */
    public function __construct(string $message, int $httpStatus = 400, string $errorCode = 'API_ERROR', array $extra = [])
    {
        parent::__construct($message);
        $this->httpStatus = $httpStatus;
        $this->errorCode = trim($errorCode) !== '' ? trim($errorCode) : 'API_ERROR';
        $this->extra = $extra;
    }

    public function httpStatus(): int
    {
        return $this->httpStatus;
    }

    public function errorCode(): string
    {
        return $this->errorCode;
    }

    /**
     * @return array<string, mixed>
     */
    public function extra(): array
    {
        return $this->extra;
    }
}
