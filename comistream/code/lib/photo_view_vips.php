<?php

// SPDX-License-Identifier: AGPL-3.0-only
if (PHP_SAPI !== 'cli' || $argc !== 3) exit(1);

require_once dirname(__DIR__) . '/comistream_lib.php';

if (!isVipsAvailable()) exit(1);
try {
    $width = (int)$argv[2];
    $image = \Jcupitt\Vips\Image::thumbnail($argv[1], $width, ['height' => $width, 'size' => 'down']);
    echo $image->writeToBuffer('.webp', ['Q' => 80, 'strip' => true]);
} catch (Throwable $error) {
    exit(1);
}
