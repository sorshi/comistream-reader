<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/lib_reader_input.php';

$cases = [
    ['FULL', 'cmp', true, 'FULL'],
    ['comp', 'raw', false, 'comp'],
    ['', 'raw', true, 'FULL'],
    ['', 'cmp', false, 'comp'],
    ['', 'compressed', false, 'comp'],
    ['', null, true, 'comp'],
    ['', null, false, 'FULL'],
    ['', 'invalid', true, 'comp'],
    ['', null, null, 'FULL'],
    ['invalid', 'invalid', 'true', 'FULL'],
    [[], [], [], 'FULL'],
];
foreach ($cases as [$requestedSize, $rawMode, $packetSave, $expected]) {
    if (resolveReaderSizeMode($requestedSize, $rawMode, $packetSave) !== $expected) {
        throw new RuntimeException('Reader size mode precedence or fallback is incorrect.');
    }
}
echo "reader_size_mode.test.php: OK\n";
