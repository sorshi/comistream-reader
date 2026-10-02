<?php

declare(strict_types=1);

if (($argv[1] ?? '') === '--hash-worker') {
    echo hash($argv[2] ?? 'md5', file_get_contents('php://stdin')) . "  -\n";
    exit;
}

require_once dirname(__DIR__) . '/comistream_lib.php';

foreach (['md5', 'sha256'] as $algorithm) {
    $md5cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__)
        . ' --hash-worker ' . escapeshellarg($algorithm);
    foreach (['book.zip', '日本語 + book.zip', '$(printf injected).zip', '`printf injected`.zip', 'a"b\'c.zip', 'back\\slash.zip', '-n.zip'] as $name) {
        if (basefilename2hash($name) !== hash($algorithm, $name)) {
            throw new RuntimeException('Filename hashing did not preserve literal input: ' . $name);
        }
    }
}

if (basefilename2hash('') !== '') {
    throw new RuntimeException('Empty filename behavior changed.');
}

echo "filename_hash.test.php: OK\n";
