<?php

require_once __DIR__ . '/../lib/lib_image_quality.php';

$validCases = [
    [0, 0],
    [75, 75],
    [100, 100],
    ['0', 0],
    ['75', 75],
    ['100', 100],
];

foreach ($validCases as [$input, $expected]) {
    if (normalizeImageQuality($input) !== $expected) {
        throw new RuntimeException('Valid quality value was not preserved');
    }
}

$invalidCases = [
    -1,
    101,
    '101',
    '75; touch /tmp/comistream-quality-pwned',
    '75 && id',
    '75.5',
    '',
    null,
    [],
];

foreach ($invalidCases as $input) {
    if (normalizeImageQuality($input) !== 75) {
        throw new RuntimeException('Invalid quality value was not replaced by the default');
    }
}

echo "Image quality validation OK\n";
