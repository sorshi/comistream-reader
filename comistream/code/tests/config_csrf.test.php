<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

if (($argv[1] ?? '') === '--invalid-post') {
    session_id('config-test-' . bin2hex(random_bytes(8)));
    session_start();
    $_SESSION['is_admin'] = true;
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = ['md5cmd' => 'must-not-write'];
    register_shutdown_function(static function () {
        echo '\nstatus:' . http_response_code();
        session_destroy();
    });
    system_config(new class {
        public function prepare($query) { throw new RuntimeException('Database write occurred.'); }
    });
    throw new RuntimeException('Invalid POST returned normally.');
}

session_id('config-test-' . bin2hex(random_bytes(8)));
session_start();
try {
    $token = ensureConfigCsrfToken();
    if ($token !== ensureConfigCsrfToken() || !validateConfigCsrfToken($token)) {
        throw new RuntimeException('Valid stable token rejected.');
    }
    foreach ([null, '', [], str_repeat('0', 64), $token . 'x'] as $invalid) {
        if (validateConfigCsrfToken($invalid)) throw new RuntimeException('Invalid token accepted.');
    }
    session_write_close();
    if (ensureConfigCsrfToken() !== $token) throw new RuntimeException('Closed request lost token.');
} finally {
    session_destroy();
}
$output = shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --invalid-post');
if (!str_contains((string)$output, 'status:403') || str_contains((string)$output, 'Database write occurred')) {
    throw new RuntimeException('Invalid POST was not rejected before side effects.');
}
echo "config_csrf.test.php: OK\n";
