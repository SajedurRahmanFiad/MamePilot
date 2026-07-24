<?php

declare(strict_types=1);

namespace App;

final class AgentLanguagePolicy
{
    public const ENGLISH = 'english';
    public const BENGALI = 'bengali';

    public static function preferredFor(string $message): string
    {
        if (preg_match('/[\x{0980}-\x{09FF}]/u', $message) === 1) {
            return self::BENGALI;
        }

        $normalized = self::normalizedIntent($message);
        if ($normalized === '') {
            return self::ENGLISH;
        }

        $tokens = preg_split('/\s+/', $normalized) ?: [];
        $banglishTokens = [
            'oi', 'ami', 'amar', 'amake', 'apni', 'apnar', 'tumi', 'tumar', 'tomar',
            'ki', 'keno', 'koi', 'kothay', 'kivabe', 'kemne', 'kemon', 'acho', 'achen',
            'ache', 'ase', 'nai', 'na', 'hobe', 'holo', 'hoise', 'korbo', 'koro', 'koren',
            'dao', 'den', 'dekhao', 'dekhaw', 'bolo', 'bolen', 'chai', 'lagbe', 'bhai',
            'apu', 'accha', 'achha', 'salam', 'assalamu', 'walaikum', 'dhonnobad',
        ];

        foreach ($tokens as $token) {
            if (in_array($token, $banglishTokens, true)) {
                return self::BENGALI;
            }
        }

        return self::ENGLISH;
    }

    /**
     * Resolve tiny conversational intents without asking a provider to guess
     * the language or disclose its own identity.
     *
     * @return array{route: string, answer: string, question: string, domains: array<int, string>}|null
     */
    public static function directDecision(string $message): ?array
    {
        $intent = self::normalizedIntent($message);
        $language = self::preferredFor($message);
        $greetings = [
            'hi', 'hello', 'hey', 'hi mame', 'hello mame', 'hey mame',
            'good morning', 'good afternoon', 'good evening',
            'oi', 'salam', 'assalamu alaikum', 'assalamualaikum',
            'হাই', 'হ্যালো', 'সালাম', 'আসসালামু আলাইকুম',
        ];
        $identityQuestions = [
            'who are you', 'what are you', 'what is your name', 'whats your name',
            'tell me about yourself', 'who is mame',
            'tumi ke', 'apni ke', 'tomar nam ki', 'apnar nam ki',
            'তুমি কে', 'আপনি কে', 'তোমার নাম কী', 'আপনার নাম কী',
        ];

        if (in_array($intent, $greetings, true)) {
            return self::decision($language === self::BENGALI
                ? 'হ্যালো! আমি মেম, MamePilot-এর অভ্যন্তরীণ ব্যবসায়িক সহকারী। কীভাবে সাহায্য করতে পারি?'
                : "Hello! I’m Mame, MamePilot’s internal business assistant. How can I help you?");
        }

        if (in_array($intent, $identityQuestions, true)) {
            return self::decision($language === self::BENGALI
                ? 'আমি মেম, MamePilot-এর অভ্যন্তরীণ ব্যবসায়িক সহকারী। আমি আপনার অনুমতি অনুযায়ী ব্যবসার তথ্য বিশ্লেষণ ও কাজ প্রস্তুত করতে সাহায্য করি।'
                : 'I’m Mame, MamePilot’s internal business assistant. I help analyze your business data and prepare actions within your permissions.');
        }

        return null;
    }

    public static function instruction(string $language): string
    {
        return $language === self::BENGALI
            ? 'Respond to the user in natural Bengali. Bengali script is required; use English only for unavoidable product names or business references.'
            : 'Respond to the user in natural English.';
    }

    public static function isAllowedPublicOutput(string $text, ?string $preferredLanguage = null): bool
    {
        $value = trim($text);
        if ($value === '') {
            return false;
        }

        preg_match_all('/\p{L}/u', $value, $matches);
        foreach (($matches[0] ?? []) as $letter) {
            if (preg_match('/^[A-Za-z]$/', $letter) === 1) {
                continue;
            }
            if (preg_match('/^[\x{0980}-\x{09FF}]$/u', $letter) === 1) {
                continue;
            }
            return false;
        }

        if ($preferredLanguage === self::BENGALI && preg_match('/[\x{0980}-\x{09FF}]/u', $value) !== 1) {
            return false;
        }

        return preg_match('/\b(?:ola|como\s+posso|ajudar|voce|hoje|obrigad[oa]|bom\s+dia|boa\s+tarde|bonjour|comment\s+puis|hola|como\s+puedo|gracias)\b/i', $value) !== 1;
    }

    public static function fallback(string $preferredLanguage): string
    {
        return $preferredLanguage === self::BENGALI
            ? 'দুঃখিত, আমি এখন একটি নিরাপদ বাংলা উত্তর প্রস্তুত করতে পারিনি। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'I could not prepare a safe English response. Please try again.';
    }

    /** @return array{route: string, answer: string, question: string, domains: array<int, string>} */
    private static function decision(string $answer): array
    {
        return ['route' => 'direct', 'answer' => $answer, 'question' => '', 'domains' => []];
    }

    private static function normalizedIntent(string $message): string
    {
        $value = mb_strtolower(trim($message));
        $value = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $value) ?: $value;
        return trim(preg_replace('/\s+/', ' ', $value) ?: $value);
    }
}
