<?php

/**
 * Comistream Reader - Music Lyrics Helpers
 *
 * 音源に含まれる歌詞と、同じフォルダの歌詞ファイルを読み取ります。
 * 外部サービスへの接続はこのファイルでは行わず、ローカルの内容だけを扱います。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @requires    PHP 8.3 or later
 */

/**
 * 歌詞パーサーのバージョンを返します。
 */
function musicLyricsParserVersion(): string
{
    return '1';
}

/**
 * 歌詞本文とサイドカーの読み込み上限（バイト）を返します。
 */
function musicLyricsMaxBytes(): int
{
    return 1048576;
}

/**
 * ID3タグ全体の読み込み上限（バイト）を返します。
 */
function musicLyricsMaxID3TagBytes(): int
{
    return 16777216;
}

/**
 * 音楽歌詞処理のログを既存の writelog へ渡します。
 */
function musicLyricsLog(string $level, string $message): void
{
    if (function_exists('writelog')) {
        writelog($level . ' ' . $message, 'MusicPlayer');
    }
}

/**
 * UTF-8、BOM付きUTF-16の歌詞を正規化します。
 * 文字コードが曖昧なデータは自動推定せず、候補から外します。
 */
function decodeMusicLyricsText(string $raw): ?string
{
    if (strlen($raw) > musicLyricsMaxBytes()) {
        musicLyricsLog('WARNING', 'decodeMusicLyricsText() lyrics data exceeded the size limit');
        return null;
    }

    if (strncmp($raw, "\xEF\xBB\xBF", 3) === 0) {
        $raw = substr($raw, 3);
    } elseif (strncmp($raw, "\xFF\xFE", 2) === 0) {
        if (!function_exists('iconv')) {
            musicLyricsLog('WARNING', 'decodeMusicLyricsText() iconv is unavailable for UTF-16LE lyrics');
            return null;
        }
        $converted = @iconv('UTF-16LE', 'UTF-8', substr($raw, 2));
        if ($converted === false) {
            musicLyricsLog('WARNING', 'decodeMusicLyricsText() invalid UTF-16LE lyrics');
            return null;
        }
        $raw = $converted;
    } elseif (strncmp($raw, "\xFE\xFF", 2) === 0) {
        if (!function_exists('iconv')) {
            musicLyricsLog('WARNING', 'decodeMusicLyricsText() iconv is unavailable for UTF-16BE lyrics');
            return null;
        }
        $converted = @iconv('UTF-16BE', 'UTF-8', substr($raw, 2));
        if ($converted === false) {
            musicLyricsLog('WARNING', 'decodeMusicLyricsText() invalid UTF-16BE lyrics');
            return null;
        }
        $raw = $converted;
    }

    if (@preg_match('//u', $raw) !== 1) {
        musicLyricsLog('WARNING', 'decodeMusicLyricsText() lyrics are not valid UTF-8');
        return null;
    }

    $raw = str_replace("\0", '', $raw);
    $raw = preg_replace('/\r\n?/', "\n", $raw) ?? $raw;
    $raw = trim($raw, " \t\n\r\0\x0B");
    if ($raw === '' || strlen($raw) > musicLyricsMaxBytes()) {
        return null;
    }

    return $raw;
}

/**
 * 通常歌詞を内部形式へ変換します。
 */
function buildPlainMusicLyrics(string $text): ?array
{
    $text = trim($text, " \t\n\r\0\x0B");
    if ($text === '') {
        return null;
    }
    if (substr_count($text, "\n") + 1 > 10000) {
        musicLyricsLog('WARNING', 'buildPlainMusicLyrics() lyrics line count exceeded the limit');
        return null;
    }

    return [
        'format' => 'plain',
        'text' => $text,
        'lines' => [],
    ];
}

/**
 * LRCの時刻をミリ秒へ変換します。
 */
function parseMusicLyricsTimestamp(array $match): int
{
    $minutes = (int)$match[1];
    $seconds = (int)$match[2];
    $fraction = isset($match[3]) ? (string)$match[3] : '';
    if ($fraction === '') {
        $fractionMs = 0;
    } elseif (strlen($fraction) === 1) {
        $fractionMs = (int)$fraction * 100;
    } elseif (strlen($fraction) === 2) {
        $fractionMs = (int)$fraction * 10;
    } else {
        $fractionMs = (int)substr($fraction, 0, 3);
    }

    return $minutes * 60000 + $seconds * 1000 + $fractionMs;
}

/**
 * LRCのメタデータタグを歌詞本文から取り除きます。
 */
function stripMusicLyricsMetadataTags(string $line): string
{
    return preg_replace(
        '/\[(?:ar|ti|al|by|re|ve|length|offset)\s*:[^\]]*\]/i',
        '',
        $line
    ) ?? $line;
}

/**
 * LRCを解析します。複数時刻タグ、空行、offsetを扱います。
 */
function parseMusicLyricsLRC(string $text): ?array
{
    $entries = [];
    $nonTimedLines = [];
    $offsetMs = 0;
    $offsetSeen = false;
    $order = 0;

    foreach (explode("\n", $text) as $line) {
        if (!$offsetSeen && preg_match('/\[offset\s*:\s*([+-]?\d+)\]/i', $line, $offsetMatch) === 1) {
            $offsetMs = (int)$offsetMatch[1];
            $offsetSeen = true;
        }

        preg_match_all(
            '/\[(\d{1,3}):([0-5]\d)(?:[\.:](\d{1,3}))?\]/',
            $line,
            $timestampMatches,
            PREG_SET_ORDER
        );

        if ($timestampMatches !== []) {
            $lineText = preg_replace(
                '/\[(?:\d{1,3}):(?:[0-5]\d)(?:[\.:]\d{1,3})?\]/',
                '',
                $line
            ) ?? $line;
            $lineText = trim(stripMusicLyricsMetadataTags($lineText));
            foreach ($timestampMatches as $timestampMatch) {
                $entries[] = [
                    'timeMs' => parseMusicLyricsTimestamp($timestampMatch),
                    'text' => $lineText,
                    'order' => $order++,
                ];
            }
            continue;
        }

        $lineWithoutMetadata = trim(stripMusicLyricsMetadataTags($line));
        if ($lineWithoutMetadata !== '') {
            $nonTimedLines[] = $lineWithoutMetadata;
        }
    }

    if ($entries !== []) {
        $hasVisibleText = false;
        foreach ($entries as $entry) {
            if (trim($entry['text']) !== '') {
                $hasVisibleText = true;
                break;
            }
        }
        if (!$hasVisibleText || count($entries) > 10000) {
            if (count($entries) > 10000) {
                musicLyricsLog('WARNING', 'parseMusicLyricsLRC() line count exceeded the limit');
            }
            return null;
        }

        foreach ($entries as &$entry) {
            $entry['timeMs'] += $offsetMs;
        }
        unset($entry);

        // 同時刻の行は元の順序を保ったまま並べ替えるルン。
        usort($entries, static function (array $left, array $right): int {
            return $left['timeMs'] <=> $right['timeMs']
                ?: $left['order'] <=> $right['order'];
        });

        $lines = [];
        foreach ($entries as $entry) {
            $lines[] = [
                'timeMs' => (int)$entry['timeMs'],
                'text' => $entry['text'],
            ];
        }

        return [
            'format' => 'lrc',
            'text' => implode("\n", array_column($lines, 'text')),
            'lines' => $lines,
        ];
    }

    if ($nonTimedLines === []) {
        return null;
    }

    return buildPlainMusicLyrics(implode("\n", $nonTimedLines));
}

/**
 * 文字列をLRCまたは通常歌詞として正規化します。
 */
function normalizeMusicLyrics(string $raw, string $formatHint = 'auto'): ?array
{
    $text = decodeMusicLyricsText($raw);
    if ($text === null) {
        return null;
    }

    $looksLikeLRC = preg_match('/\[\d{1,3}:[0-5]\d(?:[\.:]\d{1,3})?\]/', $text) === 1;
    if ($formatHint === 'lrc' || $looksLikeLRC) {
        $parsed = parseMusicLyricsLRC($text);
        if ($parsed !== null) {
            return $parsed;
        }

        // 時刻らしいタグを含む壊れたLRCは、タグをそのまま表示せず候補から外すルン。
        if ($formatHint === 'lrc' || $looksLikeLRC) {
            return null;
        }
    }

    return buildPlainMusicLyrics($text);
}

/**
 * 同じ優先度の候補から同期歌詞を優先して選びます。
 */
function selectPreferredMusicLyrics(array $candidates): ?array
{
    $first = null;
    foreach ($candidates as $candidate) {
        if (!is_array($candidate) || !isset($candidate['format'])) {
            continue;
        }
        if ($first === null) {
            $first = $candidate;
        }
        if ($candidate['format'] === 'lrc') {
            return $candidate;
        }
    }
    return $first;
}

/**
 * ファイルから指定バイト数を読み切ります。
 */
function readMusicLyricsBytes($handle, int $length): ?string
{
    if (!is_resource($handle) || $length < 0 || $length > 33554432) {
        return null;
    }
    if ($length === 0) {
        return '';
    }

    $data = '';
    while (strlen($data) < $length) {
        $chunk = fread($handle, min(1048576, $length - strlen($data)));
        if ($chunk === false || $chunk === '') {
            return null;
        }
        $data .= $chunk;
    }
    return $data;
}

/**
 * ID3のsyncsafe整数を読みます。
 */
function readMusicLyricsSyncsafe(string $bytes, int $offset = 0): ?int
{
    if ($offset < 0 || $offset + 4 > strlen($bytes)) {
        return null;
    }

    $value = 0;
    for ($index = 0; $index < 4; $index++) {
        $byte = ord($bytes[$offset + $index]);
        if (($byte & 0x80) !== 0) {
            return null;
        }
        $value = ($value << 7) | $byte;
    }
    return $value;
}

/**
 * ID3のunsynchronisationで挿入されたゼロを取り除きます。
 */
function removeMusicLyricsID3Unsynchronisation(string $bytes): string
{
    $result = '';
    $length = strlen($bytes);
    for ($index = 0; $index < $length; $index++) {
        $result .= $bytes[$index];
        if ($bytes[$index] === "\xFF" && $index + 1 < $length && $bytes[$index + 1] === "\0"
            && ($index + 2 >= $length || $bytes[$index + 2] === "\0" || (ord($bytes[$index + 2]) & 0xE0) === 0xE0)) {
            $index++;
        }
    }
    return $result;
}

/**
 * ID3テキストをUTF-8へ変換します。
 */
function decodeMusicLyricsID3Text(string $bytes, int $encoding, ?string $utf16Encoding = null): ?string
{
    if (!function_exists('iconv')) {
        musicLyricsLog('WARNING', 'decodeMusicLyricsID3Text() iconv is unavailable');
        return null;
    }
    if ($encoding === 0) {
        $converted = @iconv('ISO-8859-1', 'UTF-8', $bytes);
    } elseif ($encoding === 1) {
        if (strncmp($bytes, "\xFF\xFE", 2) === 0) {
            $utf16Encoding = 'UTF-16LE';
            $bytes = substr($bytes, 2);
        } elseif (strncmp($bytes, "\xFE\xFF", 2) === 0) {
            $utf16Encoding = 'UTF-16BE';
            $bytes = substr($bytes, 2);
        }
        $converted = @iconv($utf16Encoding ?? 'UTF-16', 'UTF-8', $bytes);
    } elseif ($encoding === 2) {
        $converted = @iconv('UTF-16BE', 'UTF-8', $bytes);
    } elseif ($encoding === 3) {
        $converted = @iconv('UTF-8', 'UTF-8', $bytes);
    } else {
        return null;
    }

    if ($converted === false) {
        return null;
    }
    return decodeMusicLyricsText($converted);
}

/**
 * USLTフレームを解析します。
 */
function parseMusicLyricsUSLT(string $payload, bool $unsynchronised = false): ?array
{
    if ($unsynchronised) {
        $payload = removeMusicLyricsID3Unsynchronisation($payload);
    }
    if (strlen($payload) < 5) {
        return null;
    }

    $encoding = ord($payload[0]);
    if ($encoding < 0 || $encoding > 3) {
        return null;
    }
    $language = substr($payload, 1, 3);
    $descriptorStart = 4;
    $descriptorEnd = false;

    if ($encoding === 1 || $encoding === 2) {
        for ($index = $descriptorStart; $index + 1 < strlen($payload); $index += 2) {
            if ($payload[$index] === "\0" && $payload[$index + 1] === "\0") {
                $descriptorEnd = $index;
                break;
            }
        }
        $terminatorLength = 2;
    } else {
        $descriptorEnd = strpos($payload, "\0", $descriptorStart);
        $terminatorLength = 1;
    }

    if ($descriptorEnd === false) {
        return null;
    }

    $descriptorBytes = substr($payload, $descriptorStart, $descriptorEnd - $descriptorStart);
    $lyricsBytes = substr($payload, $descriptorEnd + $terminatorLength);
    $utf16Encoding = null;
    if ($encoding === 1) {
        if (strncmp($descriptorBytes, "\xFF\xFE", 2) === 0) {
            $utf16Encoding = 'UTF-16LE';
        } elseif (strncmp($descriptorBytes, "\xFE\xFF", 2) === 0) {
            $utf16Encoding = 'UTF-16BE';
        }
    }
    $descriptorIsEmpty = $descriptorBytes === ''
        || ($encoding === 1 && ($descriptorBytes === "\xFF\xFE" || $descriptorBytes === "\xFE\xFF"));
    $descriptor = $descriptorIsEmpty ? '' : decodeMusicLyricsID3Text($descriptorBytes, $encoding, $utf16Encoding);
    $lyrics = decodeMusicLyricsID3Text($lyricsBytes, $encoding, $utf16Encoding);
    if ($descriptor === null || $lyrics === null || trim($lyrics) === '') {
        return null;
    }

    return [
        'language' => $language,
        'descriptor' => $descriptor,
        'text' => $lyrics,
    ];
}

/**
 * MP3のID3v2 USLTフレームを候補として読みます。
 */
function readMP3EmbeddedLyrics(string $path): array
{
    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        musicLyricsLog('WARNING', 'readMP3EmbeddedLyrics() failed to open MP3');
        return [];
    }

    try {
        $header = readMusicLyricsBytes($handle, 10);
        if ($header === null || substr($header, 0, 3) !== 'ID3') {
            return [];
        }

        $version = ord($header[3]);
        $flags = ord($header[5]);
        if ($version < 3 || $version > 4) {
            musicLyricsLog('WARNING', 'readMP3EmbeddedLyrics() unsupported ID3 version');
            return [];
        }
        $tagSize = readMusicLyricsSyncsafe($header, 6);
        if ($tagSize === null || $tagSize > musicLyricsMaxID3TagBytes()) {
            musicLyricsLog('WARNING', 'readMP3EmbeddedLyrics() invalid or oversized ID3 tag');
            return [];
        }
        $tag = readMusicLyricsBytes($handle, $tagSize);
        if ($tag === null) {
            musicLyricsLog('WARNING', 'readMP3EmbeddedLyrics() truncated ID3 tag');
            return [];
        }

        // v2.3のタグ全体unsynchronisationはフレーム境界を読む前に戻すルン。
        if ($version === 3 && ($flags & 0x80) !== 0) {
            $tag = removeMusicLyricsID3Unsynchronisation($tag);
        }
        // v2.4のヘッダーサイズはfooterを含まないため、読み込んだ全体を走査するルン。
        $frameEnd = strlen($tag);
        $offset = 0;

        if (($flags & 0x40) !== 0) {
            if ($offset + 4 > $frameEnd) {
                return [];
            }
            if ($version >= 4) {
                // v2.4はサイズフィールド自身を含む（最小6バイト）ルン。
                $extendedSize = readMusicLyricsSyncsafe($tag, $offset);
                $extendedEnd = $extendedSize === null ? null : $offset + $extendedSize;
                $validExtendedHeader = $extendedSize !== null && $extendedSize >= 6
                    && $extendedEnd <= $frameEnd;
            } else {
                // v2.3はサイズフィールド自身を含まないルン。
                $extendedSize = unpack('Nsize', substr($tag, $offset, 4))['size'] ?? null;
                $extendedEnd = $extendedSize === null ? null : $offset + 4 + $extendedSize;
                $validExtendedHeader = $extendedSize !== null && $extendedSize >= 6
                    && $extendedEnd <= $frameEnd;
            }
            if (!$validExtendedHeader || $extendedEnd === null) {
                musicLyricsLog('WARNING', 'readMP3EmbeddedLyrics() invalid ID3 extended header');
                return [];
            }
            $offset = $extendedEnd;
        }

        $candidates = [];
        while ($offset + 10 <= $frameEnd) {
            $frameId = substr($tag, $offset, 4);
            if ($frameId === "\0\0\0\0") {
                break;
            }
            if (preg_match('/^[A-Z0-9]{4}$/D', $frameId) !== 1) {
                musicLyricsLog('WARNING', 'readMP3EmbeddedLyrics() invalid ID3 frame id');
                break;
            }

            $frameSize = $version >= 4
                ? readMusicLyricsSyncsafe($tag, $offset + 4)
                : (unpack('Nsize', substr($tag, $offset + 4, 4))['size'] ?? null);
            if ($frameSize === null || $frameSize > $frameEnd - $offset - 10) {
                musicLyricsLog('WARNING', 'readMP3EmbeddedLyrics() invalid ID3 frame size');
                break;
            }

            $formatFlags = ord($tag[$offset + 9]);
            $unsupportedFormatFlags = $version >= 4
                ? (($formatFlags & 0xFC) !== 0)
                : (($formatFlags & 0xE0) !== 0);
            if ($frameId === 'USLT' && !$unsupportedFormatFlags && $frameSize > 0) {
                $payload = substr($tag, $offset + 10, $frameSize);
                if ($version >= 4 && ($formatFlags & 0x01) !== 0) {
                    if (strlen($payload) < 4 || readMusicLyricsSyncsafe($payload) === null) {
                        $offset += 10 + $frameSize;
                        continue;
                    }
                    $payload = substr($payload, 4);
                }
                $unsynchronised = $version >= 4
                    && ((($flags & 0x80) !== 0) || (($formatFlags & 0x02) !== 0));
                $parsed = parseMusicLyricsUSLT($payload, $unsynchronised);
                if ($parsed !== null) {
                    $candidates[] = $parsed['text'];
                }
            }
            $offset += 10 + $frameSize;
        }

        return $candidates;
    } finally {
        fclose($handle);
    }
}

/**
 * FLAC Vorbis Commentブロックの長さを読みます。
 */
function readMusicLyricsUInt32LE(string $data, int &$offset): ?int
{
    if ($offset < 0 || $offset + 4 > strlen($data)) {
        return null;
    }
    $value = unpack('Vvalue', substr($data, $offset, 4));
    $offset += 4;
    return isset($value['value']) ? (int)$value['value'] : null;
}

/**
 * FLACのVorbis Commentから歌詞候補を取り出します。
 */
function parseMusicLyricsVorbisComment(string $data): array
{
    $offset = 0;
    $vendorLength = readMusicLyricsUInt32LE($data, $offset);
    if ($vendorLength === null || $vendorLength > strlen($data) - $offset) {
        return [];
    }
    $offset += $vendorLength;
    $commentCount = readMusicLyricsUInt32LE($data, $offset);
    if ($commentCount === null || $commentCount > 10000) {
        return [];
    }

    $candidates = [
        'SYNCEDLYRICS' => [],
        'LYRICS' => [],
        'UNSYNCEDLYRICS' => [],
    ];
    for ($index = 0; $index < $commentCount; $index++) {
        $length = readMusicLyricsUInt32LE($data, $offset);
        if ($length === null || $length > strlen($data) - $offset) {
            return [];
        }
        $comment = substr($data, $offset, $length);
        $offset += $length;
        $separator = strpos($comment, '=');
        if ($separator === false) {
            continue;
        }
        $key = strtoupper(substr($comment, 0, $separator));
        if (isset($candidates[$key])) {
            $candidates[$key][] = substr($comment, $separator + 1);
        }
    }

    return array_merge(
        $candidates['SYNCEDLYRICS'],
        $candidates['LYRICS'],
        $candidates['UNSYNCEDLYRICS']
    );
}

/**
 * FLACのVorbis Commentから歌詞候補を読みます。
 */
function readFLACEmbeddedLyrics(string $path): array
{
    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        musicLyricsLog('WARNING', 'readFLACEmbeddedLyrics() failed to open FLAC');
        return [];
    }

    try {
        if (readMusicLyricsBytes($handle, 4) !== 'fLaC') {
            return [];
        }
        $candidates = [];
        do {
            $blockHeader = readMusicLyricsBytes($handle, 4);
            if ($blockHeader === null) {
                musicLyricsLog('WARNING', 'readFLACEmbeddedLyrics() truncated metadata block header');
                return [];
            }
            $isLast = (ord($blockHeader[0]) & 0x80) !== 0;
            $blockType = ord($blockHeader[0]) & 0x7F;
            $blockSize = (ord($blockHeader[1]) << 16)
                | (ord($blockHeader[2]) << 8)
                | ord($blockHeader[3]);

            if ($blockType === 4) {
                if ($blockSize > musicLyricsMaxID3TagBytes()) {
                    musicLyricsLog('WARNING', 'readFLACEmbeddedLyrics() Vorbis Comment block exceeded the size limit');
                    return [];
                }
                $block = readMusicLyricsBytes($handle, $blockSize);
                if ($block === null) {
                    musicLyricsLog('WARNING', 'readFLACEmbeddedLyrics() truncated Vorbis Comment block');
                    return [];
                }
                $candidates = array_merge($candidates, parseMusicLyricsVorbisComment($block));
            } elseif ($blockSize > 0 && fseek($handle, $blockSize, SEEK_CUR) !== 0) {
                musicLyricsLog('WARNING', 'readFLACEmbeddedLyrics() failed to skip metadata block');
                return [];
            }
        } while (!$isLast);

        return $candidates;
    } finally {
        fclose($handle);
    }
}

/**
 * 埋め込み歌詞をフォーマット候補へ変換します。
 */
function readEmbeddedMusicLyrics(string $path, string $extension): ?array
{
    $rawCandidates = [];
    if (in_array($extension, ['m4a', 'mp4', 'aac'], true)) {
        if (function_exists('readMP4LyricsFromFile')) {
            $embedded = readMP4LyricsFromFile($path);
            if ($embedded !== '') {
                $rawCandidates[] = $embedded;
            }
        }
    } elseif ($extension === 'mp3') {
        $rawCandidates = readMP3EmbeddedLyrics($path);
    } elseif ($extension === 'flac') {
        $rawCandidates = readFLACEmbeddedLyrics($path);
    }

    $candidates = [];
    foreach ($rawCandidates as $raw) {
        if (!is_string($raw)) {
            continue;
        }
        $normalised = normalizeMusicLyrics($raw);
        if ($normalised !== null) {
            $candidates[] = $normalised;
        }
    }
    return selectPreferredMusicLyrics($candidates);
}

/**
 * 同じフォルダの歌詞ファイルを順番に読みます。
 */
function readSidecarMusicLyrics(array $sidecars): ?array
{
    foreach ($sidecars as $sidecar) {
        if (!is_array($sidecar) || !isset($sidecar['path'], $sidecar['format'])) {
            continue;
        }
        $path = (string)$sidecar['path'];
        $size = @filesize($path);
        if ($size === false || $size > musicLyricsMaxBytes()) {
            musicLyricsLog('WARNING', 'readSidecarMusicLyrics() sidecar exceeded the size limit');
            continue;
        }
        $raw = @file_get_contents($path);
        if ($raw === false) {
            musicLyricsLog('WARNING', 'readSidecarMusicLyrics() failed to read sidecar');
            continue;
        }
        $normalised = normalizeMusicLyrics($raw, (string)$sidecar['format']);
        if ($normalised !== null) {
            return $normalised;
        }
    }
    return null;
}

/**
 * 埋め込み、LRC、TXTの順でローカル歌詞を解決します。
 */
function resolveLocalMusicLyrics(string $path, string $extension, array $sidecars): array
{
    $embedded = readEmbeddedMusicLyrics($path, $extension);
    if ($embedded !== null) {
        return [
            'status' => 'ok',
            'source' => 'embedded',
            'provider' => null,
            'attribution' => null,
            'format' => $embedded['format'],
            'text' => $embedded['text'],
            'lines' => $embedded['lines'],
        ];
    }

    $sidecar = readSidecarMusicLyrics($sidecars);
    if ($sidecar !== null) {
        return [
            'status' => 'ok',
            'source' => 'sidecar',
            'provider' => null,
            'attribution' => null,
            'format' => $sidecar['format'],
            'text' => $sidecar['text'],
            'lines' => $sidecar['lines'],
        ];
    }

    return [
        'status' => 'none',
        'source' => null,
        'provider' => null,
        'attribution' => null,
        'format' => null,
        'text' => '',
        'lines' => [],
    ];
}

/**
 * 歌詞キャッシュのロックファイルを開きます。
 */
function openMusicLyricsCacheLock(string $toolDirectory, string $cacheKey)
{
    if ($toolDirectory === '' || preg_match('/^[a-f0-9]{64}$/', $cacheKey) !== 1) {
        return false;
    }
    $entryName = 'music-lyrics-' . $cacheKey;
    if (function_exists('openMusicCacheEntryLock')) {
        return openMusicCacheEntryLock($toolDirectory, $entryName);
    }
    $lockDirectory = rtrim($toolDirectory, DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'runtime'
        . DIRECTORY_SEPARATOR . 'music';
    if (!is_dir($lockDirectory) && !@mkdir($lockDirectory, 0775, true) && !is_dir($lockDirectory)) {
        musicLyricsLog('WARNING', 'openMusicLyricsCacheLock() failed to create runtime directory');
        return false;
    }
    $lock = @fopen(
        $lockDirectory . DIRECTORY_SEPARATOR . 'music-cache-' . substr($cacheKey, 0, 2) . '.lock',
        'c'
    );
    if ($lock === false) {
        musicLyricsLog('WARNING', 'openMusicLyricsCacheLock() failed to open lock file');
    }
    return $lock;
}

/**
 * キャッシュJSONを読みます。ロック競合時はキャッシュミスとして扱います。
 */
function readMusicLyricsCache(
    string $cacheDirectory,
    string $toolDirectory,
    string $cacheKey,
    string $sourceVersion
): ?array {
    if (preg_match('/^[a-f0-9]{64}$/', $cacheKey) !== 1) {
        return null;
    }
    $lock = openMusicLyricsCacheLock($toolDirectory, $cacheKey);
    if ($lock === false || !@flock($lock, LOCK_SH | LOCK_NB)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        musicLyricsLog('NOTICE', 'readMusicLyricsCache() cache lock is busy');
        return null;
    }

    try {
        $entryDirectory = rtrim($cacheDirectory, DIRECTORY_SEPARATOR)
            . DIRECTORY_SEPARATOR . 'music-lyrics-' . $cacheKey;
        $manifestPath = $entryDirectory . DIRECTORY_SEPARATOR . 'manifest.json';
        $lyricsPath = $entryDirectory . DIRECTORY_SEPARATOR . 'lyrics.json';
        $accessPath = $entryDirectory . DIRECTORY_SEPARATOR . 'access';
        if (!is_dir($entryDirectory) || is_link($entryDirectory)
            || !is_file($manifestPath) || is_link($manifestPath)
            || !is_file($lyricsPath) || is_link($lyricsPath)
            || is_link($accessPath)) {
            return null;
        }
        $manifestSize = @filesize($manifestPath);
        $lyricsSize = @filesize($lyricsPath);
        if ($manifestSize === false || $lyricsSize === false || $manifestSize > 65536 || $lyricsSize > 4194304) {
            musicLyricsLog('WARNING', 'readMusicLyricsCache() cache file size is invalid');
            return null;
        }
        $manifest = json_decode((string)@file_get_contents($manifestPath), true);
        $lyrics = json_decode((string)@file_get_contents($lyricsPath), true);
        if (!is_array($manifest) || !is_array($lyrics) || !isset($lyrics['status'], $lyrics['text'], $lyrics['lines'])) {
            musicLyricsLog('WARNING', 'readMusicLyricsCache() cache JSON was invalid');
            return null;
        }
        if (($manifest['parserVersion'] ?? '') !== musicLyricsParserVersion()
            || ($manifest['sourceVersion'] ?? '') !== $sourceVersion) {
            musicLyricsLog('DEBUG', 'readMusicLyricsCache() cache manifest did not match the source');
            return null;
        }

        // atimeが無効でも利用時刻を明示できるようにするルン。
        writeMusicLyricsCacheFile($accessPath, (string)time());
        return $lyrics;
    } finally {
        @flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/**
 * キャッシュJSONを同じディレクトリ内で完成させてから置き換えます。
 */
function writeMusicLyricsCache(
    string $cacheDirectory,
    string $toolDirectory,
    string $cacheKey,
    string $sourceVersion,
    array $manifest,
    array $lyrics
): bool {
    if (preg_match('/^[a-f0-9]{64}$/', $cacheKey) !== 1) {
        return false;
    }
    if (!is_dir($cacheDirectory) && !@mkdir($cacheDirectory, 0775, true) && !is_dir($cacheDirectory)) {
        musicLyricsLog('WARNING', 'writeMusicLyricsCache() failed to create cache directory');
        return false;
    }

    $lock = openMusicLyricsCacheLock($toolDirectory, $cacheKey);
    if ($lock === false || !@flock($lock, LOCK_EX | LOCK_NB)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        musicLyricsLog('NOTICE', 'writeMusicLyricsCache() cache lock is busy');
        return false;
    }

    try {
        $entryDirectory = rtrim($cacheDirectory, DIRECTORY_SEPARATOR)
            . DIRECTORY_SEPARATOR . 'music-lyrics-' . $cacheKey;
        if (is_link($entryDirectory)
            || (!is_dir($entryDirectory) && !@mkdir($entryDirectory, 0775, true) && !is_dir($entryDirectory))) {
            musicLyricsLog('WARNING', 'writeMusicLyricsCache() failed to create cache entry');
            return false;
        }

        $manifest['parserVersion'] = musicLyricsParserVersion();
        $manifest['sourceVersion'] = $sourceVersion;
        $manifestJson = json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        $lyricsJson = json_encode($lyrics, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($manifestJson === false || $lyricsJson === false) {
            musicLyricsLog('WARNING', 'writeMusicLyricsCache() failed to encode JSON');
            return false;
        }

        if (!writeMusicLyricsCacheFile($entryDirectory . DIRECTORY_SEPARATOR . 'manifest.json', $manifestJson)
            || !writeMusicLyricsCacheFile($entryDirectory . DIRECTORY_SEPARATOR . 'lyrics.json', $lyricsJson)) {
            musicLyricsLog('WARNING', 'writeMusicLyricsCache() failed to replace cache JSON');
            return false;
        }
        return writeMusicLyricsCacheFile($entryDirectory . DIRECTORY_SEPARATOR . 'access', (string)time());
    } finally {
        @flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/**
 * キャッシュファイルを一時ファイル経由で置き換えます。
 */
function writeMusicLyricsCacheFile(string $path, string $contents): bool
{
    $directory = dirname($path);
    $temporary = @tempnam($directory, '.lyrics-');
    if ($temporary === false) {
        return false;
    }
    $written = @file_put_contents($temporary, $contents, LOCK_EX);
    if ($written === false || $written !== strlen($contents) || !@rename($temporary, $path)) {
        @unlink($temporary);
        return false;
    }
    return true;
}
