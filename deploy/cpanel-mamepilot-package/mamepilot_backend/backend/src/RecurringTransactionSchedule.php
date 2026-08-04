<?php

declare(strict_types=1);

namespace App;

use DateTimeImmutable;
use DateTimeZone;
use RuntimeException;

final class RecurringTransactionSchedule
{
    public static function nextOccurrence(string $currentAt, string $interval, string $anchorAt): string
    {
        $timezone = new DateTimeZone('UTC');
        $current = new DateTimeImmutable($currentAt, $timezone);
        $anchor = new DateTimeImmutable($anchorAt, $timezone);
        $interval = strtolower(trim($interval));

        if ($interval === 'daily') {
            return $current->modify('+1 day')->format('Y-m-d H:i:s');
        }
        if ($interval === 'weekly') {
            return $current->modify('+1 week')->format('Y-m-d H:i:s');
        }
        if ($interval === 'monthly') {
            $first = $current->modify('first day of next month');
            $day = min((int) $anchor->format('j'), (int) $first->format('t'));
            return $first
                ->setDate((int) $first->format('Y'), (int) $first->format('n'), $day)
                ->setTime((int) $anchor->format('H'), (int) $anchor->format('i'), (int) $anchor->format('s'))
                ->format('Y-m-d H:i:s');
        }
        if ($interval === 'yearly') {
            $year = (int) $current->format('Y') + 1;
            $month = (int) $anchor->format('n');
            $first = new DateTimeImmutable(sprintf('%04d-%02d-01 00:00:00', $year, $month), $timezone);
            $day = min((int) $anchor->format('j'), (int) $first->format('t'));
            return $first
                ->setDate($year, $month, $day)
                ->setTime((int) $anchor->format('H'), (int) $anchor->format('i'), (int) $anchor->format('s'))
                ->format('Y-m-d H:i:s');
        }

        throw new RuntimeException('A valid recurring interval is required.');
    }
}
