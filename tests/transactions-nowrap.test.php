<?php

declare(strict_types=1);

$source = (string) file_get_contents(dirname(__DIR__) . '/pages/Transactions.tsx');

if (!str_contains($source, '<table className="w-full text-left whitespace-nowrap">')) {
    throw new RuntimeException('The Transactions table does not prevent cell content from wrapping.');
}
if (str_contains($source, 'Category <br')) {
    throw new RuntimeException('The Transactions header still forces a line break.');
}

echo "Transactions table no-wrap check passed.\n";
