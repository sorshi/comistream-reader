<?php

/**
 * Comistream Reader - Music Metadata Helpers
 *
 * MP4 / M4A コンテナから楽曲情報と埋め込みカバーを読み取ります。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @requires    PHP 8.3 or later
 */

/**
 * MP4 / M4A ファイルからタイトルとアーティストを取得する。
 *
 * atom のサイズを使って必要な位置へシークするため、大きな mdat をメモリへ
 * 読み込まず、ファイル末尾に moov がある構造も扱えるルン。
 */
function readMP4MetadataFromFile($path)
{
    $metadata = ['title' => '', 'artist' => ''];
    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        return $metadata;
    }

    $stat = fstat($handle);
    $fileSize = is_array($stat) && isset($stat['size']) ? (int)$stat['size'] : 0;
    if ($fileSize > 0) {
        scanMP4MetadataRange($handle, 0, $fileSize, 0, $metadata);
    }

    fclose($handle);
    return $metadata;
}

/**
 * MP4 / M4A ファイルから埋め込みカバーを取得する。
 */
function extractMP4CoverFromFile($path)
{
    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        return null;
    }

    $stat = fstat($handle);
    $fileSize = is_array($stat) && isset($stat['size']) ? (int)$stat['size'] : 0;
    $cover = $fileSize > 0 ? findMP4CoverInRange($handle, 0, $fileSize, 0) : null;

    fclose($handle);
    return $cover;
}

/**
 * 指定範囲に並ぶ atom を走査してメタデータを集める。
 */
function scanMP4MetadataRange($handle, $start, $end, $depth, &$metadata)
{
    if ($depth > 8 || $start < 0 || $end <= $start) {
        return;
    }

    $containers = [
        'moov' => true,
        'trak' => true,
        'mdia' => true,
        'udta' => true,
        'meta' => true,
        'ilst' => true,
    ];
    $offset = $start;

    while ($offset + 8 <= $end) {
        $atom = readMP4AtomHeader($handle, $offset, $end);
        if ($atom === null) {
            return;
        }

        if ($atom['type'] === "\xA9" . 'nam' || $atom['type'] === "\xA9" . 'ART' || $atom['type'] === 'aART') {
            $value = readMP4TextItem($handle, $atom);
            if ($value !== '') {
                if ($atom['type'] === "\xA9" . 'nam') {
                    $metadata['title'] = $value;
                } elseif ($atom['type'] === "\xA9" . 'ART' || $metadata['artist'] === '') {
                    // 曲アーティストをアルバムアーティストより優先するルン。
                    $metadata['artist'] = $value;
                }
            }
        } elseif (isset($containers[$atom['type']])) {
            $childStart = $atom['data_offset'];
            if ($atom['type'] === 'meta') {
                $childStart += 4; // FullBox の version / flags
            }
            if ($childStart < $atom['end']) {
                scanMP4MetadataRange($handle, $childStart, $atom['end'], $depth + 1, $metadata);
            }
        }

        $offset = $atom['end'];
    }
}

/**
 * 指定範囲から最初の covr atom を探す。
 */
function findMP4CoverInRange($handle, $start, $end, $depth)
{
    if ($depth > 8 || $start < 0 || $end <= $start) {
        return null;
    }

    $containers = [
        'moov' => true,
        'trak' => true,
        'mdia' => true,
        'udta' => true,
        'meta' => true,
        'ilst' => true,
    ];
    $offset = $start;

    while ($offset + 8 <= $end) {
        $atom = readMP4AtomHeader($handle, $offset, $end);
        if ($atom === null) {
            return null;
        }

        if ($atom['type'] === 'covr') {
            return readMP4CoverItem($handle, $atom);
        }

        if (isset($containers[$atom['type']])) {
            $childStart = $atom['data_offset'];
            if ($atom['type'] === 'meta') {
                $childStart += 4; // FullBox の version / flags
            }
            if ($childStart < $atom['end']) {
                $cover = findMP4CoverInRange($handle, $childStart, $atom['end'], $depth + 1);
                if ($cover !== null) {
                    return $cover;
                }
            }
        }

        $offset = $atom['end'];
    }

    return null;
}

/**
 * atom ヘッダーを読み、ファイル内の範囲を検証する。
 */
function readMP4AtomHeader($handle, $offset, $limit)
{
    $header = readMP4Bytes($handle, $offset, 8);
    if ($header === null) {
        return null;
    }

    $sizeParts = unpack('Nsize', substr($header, 0, 4));
    $size = (int)$sizeParts['size'];
    $type = substr($header, 4, 4);
    $headerSize = 8;

    if ($size === 1) {
        $extended = readMP4Bytes($handle, $offset + 8, 8);
        if ($extended === null) {
            return null;
        }
        $parts = unpack('Nhigh/Nlow', $extended);
        if ($parts['high'] > 0x7fffffff) {
            return null;
        }
        $size = (int)($parts['high'] * 4294967296 + $parts['low']);
        $headerSize = 16;
    } elseif ($size === 0) {
        $size = $limit - $offset;
    }

    if ($size < $headerSize || $size > $limit - $offset) {
        return null;
    }

    return [
        'type' => $type,
        'offset' => $offset,
        'size' => $size,
        'data_offset' => $offset + $headerSize,
        'end' => $offset + $size,
    ];
}

/**
 * メタデータ項目内の data atom を文字列として読む。
 */
function readMP4TextItem($handle, $item)
{
    $payload = readMP4DataPayload($handle, $item, 1048576);
    if ($payload === null || $payload['data'] === '') {
        return '';
    }

    $text = $payload['data'];
    if ($payload['type'] === 2) {
        $converted = @iconv('UTF-16BE', 'UTF-8//IGNORE', $text);
        $text = $converted === false ? '' : $converted;
    } elseif (@preg_match('//u', $text) !== 1) {
        $converted = @iconv('UTF-8', 'UTF-8//IGNORE', $text);
        $text = $converted === false ? '' : $converted;
    }

    return trim($text, "\0 \t\r\n");
}

/**
 * covr 項目内の data atom を画像として読む。
 */
function readMP4CoverItem($handle, $item)
{
    $payload = readMP4DataPayload($handle, $item, 33554432);
    if ($payload === null || strlen($payload['data']) < 4) {
        return null;
    }

    $data = $payload['data'];
    if (substr($data, 0, 8) === "\x89PNG\r\n\x1a\n" || $payload['type'] === 14) {
        return ['mime' => 'image/png', 'data' => $data];
    }
    if (substr($data, 0, 3) === "\xff\xd8\xff" || $payload['type'] === 13) {
        return ['mime' => 'image/jpeg', 'data' => $data];
    }

    return null;
}

/**
 * メタデータ項目の直下から data atom の内容を取得する。
 */
function readMP4DataPayload($handle, $item, $maxBytes)
{
    $offset = $item['data_offset'];
    while ($offset + 8 <= $item['end']) {
        $atom = readMP4AtomHeader($handle, $offset, $item['end']);
        if ($atom === null) {
            return null;
        }

        if ($atom['type'] === 'data') {
            // data atom は type indicator と locale indicator を各4バイト持つルン。
            $dataHeader = readMP4Bytes($handle, $atom['data_offset'], 8);
            if ($dataHeader === null) {
                return null;
            }
            $typeParts = unpack('Ntype', substr($dataHeader, 0, 4));
            $payloadOffset = $atom['data_offset'] + 8;
            $payloadLength = $atom['end'] - $payloadOffset;
            if ($payloadLength < 0 || $payloadLength > $maxBytes) {
                return null;
            }
            $data = readMP4Bytes($handle, $payloadOffset, $payloadLength);
            if ($data === null) {
                return null;
            }
            return [
                'type' => ((int)$typeParts['type']) & 0x00ffffff,
                'data' => $data,
            ];
        }

        $offset = $atom['end'];
    }

    return null;
}

/**
 * 指定位置から必要な長さを読み切る。
 */
function readMP4Bytes($handle, $offset, $length)
{
    if ($offset < 0 || $length < 0 || fseek($handle, $offset, SEEK_SET) !== 0) {
        return null;
    }
    if ($length === 0) {
        return '';
    }

    $data = '';
    while (strlen($data) < $length && !feof($handle)) {
        $chunk = fread($handle, $length - strlen($data));
        if ($chunk === false || $chunk === '') {
            break;
        }
        $data .= $chunk;
    }

    return strlen($data) === $length ? $data : null;
}
